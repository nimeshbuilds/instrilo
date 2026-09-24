import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { projectSpec, projectRoot, readDocument, readTextDocument, hashText } from './project-ops.js';
import { safeChild } from './workbench.js';
import { assertBuildCurrent, assertBuildContentCurrent } from './execution.js';
import { withGenerationLock } from './regeneration.js';
import { deploymentPlatform } from './deployment-platforms.js';
import { containerEngineInvocation } from './container-engines.js';
import type { ProjectSpec } from './types.js';

type Engine = 'docker' | 'podman';
type Resource = { kind: 'container' | 'image' | 'network'; id?: string; name: string; removed: boolean };
type Check = { name: string; passed: boolean; detail: string };
type Invocation = { executable: string; args: string[]; identity?: string };
export interface DeploymentTestReport {
  kind: 'deployment-test-report'; id: string; status: 'passed' | 'failed' | 'cancelled';
  engine: Engine; target: string; architecture: string; language: string; framework: string;
  startedAt: string; finishedAt?: string; checks: Check[]; mocks: string[]; unverified: string[];
  resources: Resource[]; cleanup: { complete: boolean; errors: string[] }; error?: string;
  reportPath: string; summary: string; projectHash: string; keep: boolean; engineIdentity?: string;
}
const LABEL = 'io.instrilo.deployment-test', OWNER = 'io.instrilo.project';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MARKER = 'INSTRILO_DEPLOYMENT_MOCK_OK';
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const prefix = (id: string) => 'instrilo-dt-' + id.replaceAll('-', '');
const reportDir = (root: string, id: string) => { if (!UUID.test(id)) throw new Error('Use a deployment test run UUID.'); return safeChild(root, '.instrilo/deployment-tests/' + id); };
const mocks = [
  'Model replies use a deterministic local OpenAI-compatible fixture; the selected framework executes unchanged.',
  'Model credentials and HTTP tool credentials are replaced with test-only environment values; tool URLs point to the local fixture.',
  'JWT projects use an ephemeral test RSA signing key, issuer, audience and local JWKS; the production identity provider is not contacted.',
  'Runtime containers share an isolated internal network. No host ports, cloud credentials, host directories or Docker socket are mounted.',
];
const unverified = [
  'Cloud IAM, workload identities, remote secret managers, registry permissions, quotas, regions, billing and deployment control planes.',
  'Real provider availability, subscription entitlement, model quality, latency under load and production TLS/network policies.',
  'Production tool semantics and approval workflows: tool URLs are replaced but the deterministic model does not call tools.',
  'Cloud-managed health probes and outer IAM authentication. Local probes validate only the generated HTTP service contract.',
  'Dependency lock reproducibility and shared engine build cache. Downloads may occur during the reviewed image build; shared caches are never pruned.',
];
function engineValue(value?: string): Engine { if (value && !['docker', 'podman'].includes(value)) throw new Error('Choose docker or podman.'); return (value ?? 'docker') as Engine; }
function commandEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TMPDIR', 'TMP', 'TEMP', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_API_VERSION', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'CONTAINERS_CONF', 'CONTAINERS_STORAGE_CONF', 'CONTAINERS_REGISTRIES_CONF', 'STORAGE_DRIVER', 'STORAGE_OPTS', 'PODMAN_CONNECTIONS_CONF', 'CONTAINER_HOST', 'SSH_AUTH_SOCK']) if (process.env[key]) env[key] = process.env[key];
  return env;
}
class CommandError extends Error { constructor(message: string, readonly output: string, readonly code: number | null = null) { super(message); } }
async function command(invocation: Invocation, args: string[], options: { signal?: AbortSignal; timeout?: number; cwd?: string } = {}): Promise<string> {
  if (options.signal?.aborted) throw new Error('Deployment test cancelled.');
  return new Promise((resolveResult, reject) => {
    const child = spawn(invocation.executable, [...invocation.args, ...args], { shell: false, cwd: options.cwd, env: commandEnv(), detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errorOutput = '', bytes = 0, failure: Error | undefined, settled = false;
    const kill = () => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const abort = () => { failure = new Error('Deployment test cancelled.'); kill(); };
    const timer = setTimeout(() => { failure = new Error('Container command timed out; inspect engine availability or architecture emulation.'); kill(); }, options.timeout ?? 30_000);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const collect = (chunk: Buffer, stdout: boolean) => { bytes += chunk.length; if (bytes > 4_000_000) { failure = new Error('Container command exceeded its 4 MB output limit.'); kill(); } else if (stdout) output = (output + chunk.toString()).slice(-32_000); else errorOutput = (errorOutput + chunk.toString()).slice(-32_000); };
    child.stdout.on('data', chunk => collect(chunk, true)); child.stderr.on('data', chunk => collect(chunk, false));
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); error ? reject(error) : resolveResult(output.trim()); };
    child.on('error', () => finish(new Error('Cannot start the container engine. Run instrilo deployment engine status first.')));
    child.on('close', code => finish(failure ?? (code === 0 ? undefined : new CommandError(`Container ${args[0]} command failed (exit ${code}). Check the retained checkpoint and engine installation.`, output + errorOutput, code))));
  });
}
function expectedName(id: string, kind: Resource['kind'], name: string) { const p = prefix(id); return kind === 'image' ? name === p + ':test' : kind === 'network' ? name === p + '-network' : [p + '-fixture', p + '-agent'].includes(name); }
function objectId(value: any, kind: Resource['kind']): string {
  const id = value?.Id ?? value?.ID ?? value?.id;
  if (typeof id !== 'string' || !(kind === 'image' ? /^(sha256:)?[a-f0-9]{64}$/ : /^[a-f0-9]{64}$/).test(id)) throw new Error('Container engine returned an unsupported resource ID.');
  return id;
}
async function inspectResource(inv: Invocation, resource: Resource, report: DeploymentTestReport, signal?: AbortSignal): Promise<any | null> {
  if (!expectedName(report.id, resource.kind, resource.name)) throw new Error('Refusing a resource name outside this test run.');
  if (resource.id && !(resource.kind === 'image' ? /^(sha256:)?[a-f0-9]{64}$/ : /^[a-f0-9]{64}$/).test(resource.id)) throw new Error('Refusing an invalid recorded resource ID.');
  let text: string;
  try { text = await command(inv, [resource.kind, 'inspect', resource.id ?? resource.name], { signal }); }
  catch (error) {
    // Only a resource-specific absence establishes that cleanup is already done.
    // Socket/transport failures can also say "no such file" or "not found".
    if (error instanceof CommandError && /(?:^|\n)(?:error(?: response from daemon)?:\s*)?no such (?:container|image|network|object)(?:\s|:|$)/i.test(error.output)) return null;
    throw error;
  }
  const items = JSON.parse(text); const item = Array.isArray(items) ? items[0] : items;
  const labels = item?.Config?.Labels ?? item?.Labels ?? item?.labels ?? {};
  if (labels[LABEL] !== report.id || labels[OWNER] !== report.projectHash) throw new Error('Resource ownership labels do not match this test; it was not removed.');
  const id = objectId(item, resource.kind);
  if (resource.id && id !== resource.id) throw new Error('Resource ID changed; it was not removed.');
  resource.id = id; return item;
}
async function cleanupResources(inv: Invocation, report: DeploymentTestReport, signal?: AbortSignal) {
  const errors: string[] = [];
  for (const resource of [...report.resources].reverse()) {
    if (resource.removed) continue;
    try {
      const current = await containerEngineInvocation(report.engine, { signal });
      if (!report.engineIdentity || current.identity !== report.engineIdentity) throw new Error('Container engine endpoint identity changed; restore the original context before cleanup.');
      const item = await inspectResource(inv, resource, report, signal);
      if (item) {
        const immediatelyBeforeRemoval = await containerEngineInvocation(report.engine, { signal });
        if (immediatelyBeforeRemoval.identity !== report.engineIdentity) throw new Error('Container engine endpoint identity changed immediately before removal; no deletion was attempted.');
        await command(inv, resource.kind === 'container' ? ['container', 'rm', '--force', resource.id!] : [resource.kind, 'rm', resource.id!], { signal });
      }
      resource.removed = true;
    } catch (error) { errors.push(`${resource.kind} ${resource.name}: ${error instanceof Error ? error.message : 'Cleanup failed.'}`); }
  }
  report.cleanup = { complete: report.resources.every(r => r.removed), errors };
}
async function persist(root: string, report: DeploymentTestReport) {
  const dir = reportDir(root, report.id);
  const lines = [`# Deployment test ${report.id}`, '', `Status: **${report.status}**`, '', report.summary, '', `Target: ${report.target}; required architecture: ${report.architecture}; framework: ${report.framework}; language: ${report.language}; engine: ${report.engine}.`, '', '## Checkpoints', '', ...report.checks.map(check => `- ${check.passed ? 'PASS' : 'FAIL'} — ${check.name}: ${check.detail}`), '', '## Mocked dependencies', '', ...report.mocks.map(x => '- ' + x), '', '## Not verified', '', ...report.unverified.map(x => '- ' + x), '', '## Cleanup', '', report.cleanup.complete ? 'Every recorded run-owned resource was removed.' : 'Some resources remain; inspect report.json and run the explicit cleanup command.', ...report.cleanup.errors.map(x => '- ' + x), '', `Cleanup preview: instrilo deployment cleanup ${report.id} .`, `Cleanup execution: instrilo deployment cleanup ${report.id} . --execute`, '', ...(report.error ? ['## Failure', '', report.error, ''] : [])];
  await writeFile(safeChild(dir, 'report.json'), json(report), { mode: 0o600 });
  await writeFile(safeChild(dir, 'report.md'), lines.join('\n'), { mode: 0o600 });
}
async function verifiedSources(root: string, spec: ProjectSpec) {
  const directory = safeChild(root, 'generated');
  await assertBuildCurrent(spec, directory);
  return withGenerationLock(directory, async () => {
    await assertBuildContentCurrent(spec, directory);
    const lock = await readDocument(safeChild(directory, 'build-lock.json'));
    if (!lock.generatedFiles || typeof lock.generatedFiles !== 'object' || !lock.generatedFiles.Dockerfile) throw new Error('This build has no container artifact. Select docker or a supported cloud target, then rebuild.');
    const files: Record<string, string> = Object.create(null); let size = 0;
    const entries = Object.entries(lock.generatedFiles);
    if (entries.length > 2000) throw new Error('Deployment build exceeds 2000 tracked files.');
    for (const [path, expected] of entries) {
      const content = await readTextDocument(safeChild(directory, path), 5_000_000); size += Buffer.byteLength(content);
      if (size > 20_000_000) throw new Error('Deployment build exceeds 20 MB.');
      if (hashText(content) !== expected) throw new Error(`Generated artifact ${path} changed after generation. Rebuild and review its changes before deployment testing.`);
      files[path] = content;
    }
    return files;
  });
}
export async function deploymentTest(project: string, options: { engine?: Engine; execute?: boolean; keep?: boolean; signal?: AbortSignal; onProgress?: (message: string) => void } = {}) {
  const { root, spec } = await projectSpec(project), engine = engineValue(options.engine), platform = deploymentPlatform(spec.delivery.target);
  if (spec.delivery.target === 'local') throw new Error('Local projects do not generate a Dockerfile. Select the docker or cloud deployment target, then rebuild.');
  // The preview is read-only: generation locks and engine discovery occur only on execute.
  const plan = { kind: 'deployment-test-plan' as const, execute: false as const, engine, target: platform.target, architecture: platform.architecture, prerequisites: ['A current generated build with a reviewed Dockerfile.', 'A running local Docker or Podman engine; remote contexts are not supported.', 'Support for the target image architecture, using a matching host or configured engine emulation.', 'Network access for base-image and package downloads during the build, sufficient disk space, and at least 2 GiB container memory.'], cloudPrerequisitesNotRequiredForThisTest: platform.prerequisites, mocks, limitations: unverified, steps: ['Verify the current generated build and copy only fingerprinted artifacts into a private test context.', 'Build the generated Dockerfile for the target architecture, downloading base images and dependencies as needed.', 'Start a local fixture and the unchanged generated server on an isolated internal network.', 'Probe image architecture, /ping, authentication, invocation and malformed input; save JSON and Markdown evidence.', options.keep ? 'Retain exact run-owned resources for inspection; use explicit cleanup when finished.' : 'Remove exact run-owned containers, image and network; retain reports.'], next: 'Repeat with --execute to build and run this reviewed local test. No cloud deployment occurs.' };
  if (!options.execute) return plan;
  const id = randomUUID(), dir = reportDir(root, id), context = safeChild(dir, 'context');
  const report: DeploymentTestReport = { kind: 'deployment-test-report', id, status: 'failed', engine, target: platform.target, architecture: platform.architecture, language: spec.language, framework: spec.framework, startedAt: new Date().toISOString(), checks: [], mocks: [...mocks], unverified: [...unverified], resources: [], cleanup: { complete: true, errors: [] }, reportPath: join(dir, 'report.md'), summary: 'Local container verification has not completed.', projectHash: hashText(resolve(root)), keep: options.keep === true };
  await mkdir(dir, { recursive: true, mode: 0o700 }); await persist(root, report);
  let invocation: Invocation | undefined, checkpoint = 'Verify generated build';
  const mark = (name: string, detail: string) => { report.checks.push({ name, passed: true, detail }); try { options.onProgress?.(name); } catch { /* Progress consumers do not control cleanup. */ } };
  try {
    options.signal?.throwIfAborted();
    const files = await verifiedSources(root, spec); mark(checkpoint, 'Every copied artifact matches its generation fingerprint; source project is unchanged.');
    checkpoint = 'Container engine availability'; invocation = await containerEngineInvocation(engine, { signal: options.signal });
    report.engineIdentity = invocation.identity;
    await command(invocation, ['info'], { signal: options.signal }); mark(checkpoint, 'The selected local engine answered its info command.');
    await mkdir(context, { recursive: true, mode: 0o700 });
    for (const [path, content] of Object.entries(files)) { const dest = safeChild(context, path); await mkdir(dirname(dest), { recursive: true, mode: 0o700 }); await writeFile(dest, content, { mode: 0o600 }); }
    const testSpec = JSON.parse(files['agent-spec.json']);
    for (const key of Object.keys(testSpec.connections)) testSpec.connections[key] = { kind: 'gateway', model: 'instrilo-test-fixture', baseUrl: 'http://127.0.0.1:18080/v1', auth: { type: 'api-key', env: 'INSTRILO_TEST_MODEL_KEY' }, timeoutMs: 15_000 };
    for (const [index, tool] of testSpec.agent.tools.entries()) { tool.url = 'http://127.0.0.1:18080/tools/' + index; if (tool.authEnv) tool.authEnv = 'INSTRILO_TEST_TOOL_KEY'; }
    const identity = await fixtureIdentity(testSpec);
    await writeFile(safeChild(context, 'agent-spec.json'), json(testSpec), { mode: 0o600 });
    const py = spec.language === 'python', extension = py ? 'py' : 'mjs';
    await writeFile(safeChild(context, 'instrilo-test-fixture.' + extension), py ? pythonFixture : jsFixture, { mode: 0o600 });
    await writeFile(safeChild(context, 'instrilo-test-driver.' + extension), py ? pythonDriver : jsDriver, { mode: 0o600 });
    await writeFile(safeChild(context, 'instrilo-test-data.json'), json(identity), { mode: 0o600 });
    // The original build stages and CMD remain intact; only test fixtures are copied into the final image.
    await writeFile(safeChild(context, 'Dockerfile'), files.Dockerfile + '\nCOPY instrilo-test-* /app/\n', { mode: 0o600 });
    const labels = ['--label', LABEL + '=' + id, '--label', OWNER + '=' + report.projectHash];
    const network: Resource = { kind: 'network', name: prefix(id) + '-network', removed: false };
    const image: Resource = { kind: 'image', name: prefix(id) + ':test', removed: false };
    // Record intent before spawning; cleanup can discover a resource by its exact name if an interrupted command never returned its ID.
    checkpoint = 'Target image build'; report.resources.push(image); await persist(root, report);
    await command(invocation, ['build', '--platform', platform.architecture === 'host' ? 'linux/' + (process.arch === 'arm64' ? 'arm64' : 'amd64') : platform.architecture, ...labels, '--tag', image.name, '--file', join(context, 'Dockerfile'), context], { signal: options.signal, timeout: 600_000 });
    const inspected = await inspectResource(invocation, image, report, options.signal); if (!inspected) throw new Error('Built image could not be inspected.');
    const actual = (inspected.Os ?? inspected.OS ?? inspected.os) + '/' + (inspected.Architecture ?? inspected.architecture);
    const expected = platform.architecture === 'host' ? 'linux/' + (process.arch === 'arm64' ? 'arm64' : 'amd64') : platform.architecture;
    if (actual !== expected) throw new Error(`Image architecture ${actual} differs from required ${expected}. Enable engine emulation or use a matching machine.`);
    mark(checkpoint, `Generated Dockerfile built successfully; image inspection confirms ${actual}.`);
    checkpoint = 'Isolated test network'; report.resources.push(network); await persist(root, report);
    await command(invocation, ['network', 'create', '--internal', ...labels, network.name], { signal: options.signal });
    if (!await inspectResource(invocation, network, report, options.signal)) throw new Error('Test network could not be inspected.');
    mark(checkpoint, 'Internal network created with no published host ports.');
    const fixture: Resource = { kind: 'container', name: prefix(id) + '-fixture', removed: false };
    const agent: Resource = { kind: 'container', name: prefix(id) + '-agent', removed: false };
    const isolation = ['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '2g'];
    checkpoint = 'Local prerequisite fixtures'; report.resources.push(fixture); await persist(root, report);
    await command(invocation, ['run', '--detach', '--name', fixture.name, '--network', network.name, ...isolation, ...labels, '--entrypoint', py ? 'python' : 'node', image.name, '/app/instrilo-test-fixture.' + extension], { signal: options.signal });
    if (!await inspectResource(invocation, fixture, report, options.signal)) throw new Error('Fixture container could not be inspected.');
    mark(checkpoint, 'Deterministic model/tool/JWKS fixture started without cloud credentials.');
    checkpoint = 'Generated server startup'; report.resources.push(agent); await persist(root, report);
    await command(invocation, ['run', '--detach', '--name', agent.name, '--network', 'container:' + fixture.id, ...isolation, ...labels, '--env', 'INSTRILO_TEST_MODEL_KEY=instrilo-mock-only', '--env', 'INSTRILO_TEST_TOOL_KEY=instrilo-mock-only', '--env', 'OTEL_SDK_DISABLED=true', '--env', 'CREWAI_TELEMETRY_OPT_OUT=true', '--env', 'DO_NOT_TRACK=1', image.name], { signal: options.signal });
    if (!await inspectResource(invocation, agent, report, options.signal)) throw new Error('Agent container could not be inspected.');
    mark(checkpoint, 'Generated Dockerfile CMD launched with its selected framework and test-only configuration.');
    checkpoint = 'HTTP contract probes';
    const raw = await command(invocation, ['exec', agent.id!, py ? 'python' : 'node', '/app/instrilo-test-driver.' + extension], { signal: options.signal, timeout: 90_000 });
    const result = JSON.parse(raw);
    if (!Array.isArray(result.checks) || result.checks.length < 5 || result.checks.length > 20 || !result.checks.every((c: any) => typeof c.name === 'string' && c.name.length < 100 && typeof c.passed === 'boolean' && typeof c.detail === 'string' && c.detail.length < 1000)) throw new Error('Probe runner returned an invalid report.');
    report.checks.push(...result.checks);
    if (result.checks.some((check: Check) => !check.passed)) throw new Error('One or more generated HTTP service contract checks failed.');
    report.status = 'passed'; report.summary = 'Local container contract checks passed with mocked dependencies. Cloud deployment and live model quality remain unverified.';
  } catch (error) {
    report.status = options.signal?.aborted ? 'cancelled' : 'failed';
    report.error = error instanceof Error ? error.message : 'Deployment test failed.';
    report.checks.push({ name: checkpoint, passed: false, detail: report.error });
    report.summary = report.status === 'cancelled' ? 'Local deployment test was cancelled; inspect cleanup results.' : 'Local deployment test failed; inspect the failed checkpoint and prerequisites.';
  } finally {
    if (invocation && !options.keep) await cleanupResources(invocation, report);
    else report.cleanup.complete = report.resources.every(r => r.removed);
    if (!options.keep) await rm(safeChild(dir, 'context'), { recursive: true, force: true });
    if (!report.cleanup.complete && !options.keep) { report.status = 'failed'; report.summary += ' Cleanup is incomplete; run explicit cleanup after resolving the reported engine error.'; }
    report.finishedAt = new Date().toISOString(); await persist(root, report);
  }
  return report;
}
export async function deploymentTestReports(project: string) {
  const root = projectRoot(project), parent = safeChild(root, '.instrilo/deployment-tests');
  let entries; try { entries = await readdir(parent, { withFileTypes: true }); } catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
  if (entries.length > 2000) throw new Error('Report inventory exceeds 2000 runs; archive old reports first.');
  const reports: DeploymentTestReport[] = [];
  for (const entry of entries) if (entry.isDirectory() && UUID.test(entry.name)) reports.push(await readReport(root, entry.name));
  return reports.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
async function readReport(root: string, id: string): Promise<DeploymentTestReport> {
  const report = await readDocument(safeChild(reportDir(root, id), 'report.json'), 2_000_000);
  if (report.kind !== 'deployment-test-report' || report.id !== id || report.projectHash !== hashText(resolve(root)) || !['docker', 'podman'].includes(report.engine) || !Array.isArray(report.resources) || report.resources.length > 4 || report.resources.some((r: Resource) => !['container', 'image', 'network'].includes(r.kind) || !expectedName(id, r.kind, r.name))) throw new Error('Deployment report identity or resource inventory is invalid.');
  return report;
}
export async function deploymentTestCleanup(project: string, runId: string, options: { execute?: boolean; signal?: AbortSignal } = {}) {
  const root = projectRoot(project), report = await readReport(root, runId);
  const plan = { kind: 'deployment-cleanup-plan', execute: false, id: runId, engine: report.engine, resources: report.resources.filter(r => !r.removed), preserves: ['JSON and Markdown test reports', 'Shared engine, provider CLIs, other projects, downloaded base images and shared build cache'], next: 'Repeat with --execute to verify ownership labels and remove only these recorded resources.' };
  if (!options.execute) return plan;
  if (report.resources.every(resource => resource.removed)) {
    report.cleanup = { complete: true, errors: [] };
    await rm(safeChild(reportDir(root, runId), 'context'), { recursive: true, force: true });
    await persist(root, report);
    return { kind: 'deployment-cleanup-result', execute: true, id: runId, ...report.cleanup, resources: report.resources, reportPath: report.reportPath };
  }
  const invocation = await containerEngineInvocation(report.engine, { signal: options.signal });
  if (!report.engineIdentity || invocation.identity !== report.engineIdentity) throw new Error('Container engine endpoint identity changed or is missing. Restore the original local context before cleanup; no resources were changed.');
  await cleanupResources(invocation, report, options.signal);
  if (report.cleanup.complete) await rm(safeChild(reportDir(root, runId), 'context'), { recursive: true, force: true });
  await persist(root, report);
  return { kind: 'deployment-cleanup-result', execute: true, id: runId, ...report.cleanup, resources: report.resources, reportPath: report.reportPath };
}
async function fixtureIdentity(spec: any) {
  const { publicKey, privateKey } = await generateKeyPair('RS256'); const jwk = { ...await exportJWK(publicKey), kid: 'instrilo-test-key', alg: 'RS256', use: 'sig' };
  const jwt = spec.security.inbound.mode === 'jwt', issuer = 'http://127.0.0.1:18080/issuer', audience = 'instrilo-deployment-test';
  if (jwt) spec.security.inbound = { mode: 'jwt', issuer, audience, jwksUrl: 'http://127.0.0.1:18080/jwks', algorithms: ['RS256'] };
  const claims: any = { scope: spec.security.requiredScopes.join(' '), agent_approvals: [] }; if (spec.security.tenantClaim) claims[spec.security.tenantClaim] = 'instrilo-test-tenant';
  const token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject('instrilo-test-user').setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const expired = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject('instrilo-test-user').setIssuer(issuer).setAudience(audience).setExpirationTime(1).sign(privateKey);
  const noScope = await new SignJWT({ ...claims, scope: '' }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject('instrilo-test-user').setIssuer(issuer).setAudience(audience).setExpirationTime('1h').sign(privateKey);
  return { jwks: { keys: [jwk] }, token, expired, noScope, jwt, requiredScopes: spec.security.requiredScopes, marker: MARKER };
}

const jsFixture = `import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const data=JSON.parse(readFileSync('/app/instrilo-test-data.json','utf8')); let calls=0;
createServer(async(req,res)=>{let size=0; for await(const chunk of req){size+=chunk.length;if(size>2000000){res.writeHead(413);res.end();return;}}
let value;if(req.url==='/jwks')value=data.jwks;else if(req.url==='/stats')value={modelCalls:calls};else if(req.url==='/v1/chat/completions'){calls++;value={id:'chatcmpl-instrilo-test',object:'chat.completion',created:Math.floor(Date.now()/1000),model:'instrilo-test-fixture',choices:[{index:0,message:{role:'assistant',content:data.marker},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};}else if(req.url?.startsWith('/tools/'))value={mock:true,result:'test-only'};else{res.writeHead(404);res.end('{}');return;}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));}).listen(18080,'127.0.0.1');\n`;
const jsDriver = `import {readFileSync} from 'node:fs';
const data=JSON.parse(readFileSync('/app/instrilo-test-data.json','utf8')),checks=[];
const add=(name,passed,detail)=>checks.push({name,passed,detail});
async function request(path,body,token,contentType='application/json'){try{const res=await fetch('http://127.0.0.1:8080'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':contentType,...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return{status:res.status,body:await res.json()};}catch{return{status:0,body:{}};}}
let healthy;for(let i=0;i<90;i++){healthy=await request('/ping');if(healthy.status===200)break;await new Promise(r=>setTimeout(r,500));}
add('Health endpoint',healthy?.status===200&&healthy.body.status==='Healthy','GET /ping must return 200 and Healthy.');
add('Unknown route',(await request('/missing')).status===404,'Unknown route must return 404.');
const input={input:'Return the deterministic test fixture response.'};
if(data.jwt){add('Missing bearer token',(await request('/invocations',input)).status===401,'No token must be rejected.');add('Invalid signature',(await request('/invocations',input,'invalid.test.token')).status===401,'Invalid token must be rejected.');add('Expired token',(await request('/invocations',input,data.expired)).status===401,'Expired test JWT must be rejected.');if(data.requiredScopes.length)add('Required scopes',[401,403].includes((await request('/invocations',input,data.noScope)).status),'JWT lacking required scopes must be rejected.');}
const valid=await request('/invocations',input,data.token);add('Selected framework invocation',valid.status===200&&valid.body.output===data.marker,'Authenticated POST /invocations must execute the selected framework and return the mock marker.');
add('Untrusted permissions in body',[400,422].includes((await request('/invocations',{...input,scopes:['admin']},data.token)).status),'Request-body scopes must be rejected.');
add('Content type boundary',(await request('/invocations',input,data.token,'text/plain')).status===415,'Non-JSON requests must be rejected.');
let stats;try{stats=await(await fetch('http://127.0.0.1:18080/stats')).json();}catch{stats={};}add('Local model fixture used',Number(stats.modelCalls)>0,'At least one model request reached the local fixture.');
console.log(JSON.stringify({checks}));\n`;
const pythonFixture = `import json,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
data=json.load(open('/app/instrilo-test-data.json'));calls=0
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):self.do_GET()
 def do_GET(self):
  global calls
  length=int(self.headers.get('content-length','0'))
  if length>2000000:self.send_response(413);self.end_headers();return
  if length:self.rfile.read(length)
  if self.path=='/jwks':value=data['jwks']
  elif self.path=='/stats':value={'modelCalls':calls}
  elif self.path=='/v1/chat/completions':
   calls+=1;value={'id':'chatcmpl-instrilo-test','object':'chat.completion','created':int(time.time()),'model':'instrilo-test-fixture','choices':[{'index':0,'message':{'role':'assistant','content':data['marker']},'finish_reason':'stop'}],'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2}}
  elif self.path.startswith('/tools/'):value={'mock':True,'result':'test-only'}
  else:self.send_response(404);self.end_headers();self.wfile.write(b'{}');return
  self.send_response(200);self.send_header('content-type','application/json');self.end_headers();self.wfile.write(json.dumps(value).encode())
ThreadingHTTPServer(('127.0.0.1',18080),Handler).serve_forever()
`;
const pythonDriver = `import json,time,urllib.request,urllib.error
data=json.load(open('/app/instrilo-test-data.json'));checks=[]
def add(name,passed,detail):checks.append({'name':name,'passed':bool(passed),'detail':detail})
def request(path,body=None,token=None,content_type='application/json'):
 headers={'Content-Type':content_type}
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request('http://127.0.0.1:8080'+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
 try:
  with urllib.request.urlopen(req,timeout=15) as response:return response.status,json.load(response)
 except urllib.error.HTTPError as error:return error.code,{}
 except Exception:return 0,{}
healthy=(0,{})
for _ in range(90):
 healthy=request('/ping')
 if healthy[0]==200:break
 time.sleep(.5)
add('Health endpoint',healthy[0]==200 and healthy[1].get('status')=='Healthy','GET /ping must return 200 and Healthy.')
add('Unknown route',request('/missing')[0]==404,'Unknown route must return 404.')
body={'input':'Return the deterministic test fixture response.'}
if data['jwt']:
 add('Missing bearer token',request('/invocations',body)[0]==401,'No token must be rejected.')
 add('Invalid signature',request('/invocations',body,'invalid.test.token')[0]==401,'Invalid token must be rejected.')
 add('Expired token',request('/invocations',body,data['expired'])[0]==401,'Expired test JWT must be rejected.')
 if data['requiredScopes']:add('Required scopes',request('/invocations',body,data['noScope'])[0] in (401,403),'JWT lacking required scopes must be rejected.')
valid=request('/invocations',body,data['token']);add('Selected framework invocation',valid[0]==200 and valid[1].get('output')==data['marker'],'POST /invocations must execute the selected framework and return the mock marker.')
add('Untrusted permissions in body',request('/invocations',{**body,'scopes':['admin']},data['token'])[0] in (400,422),'Request-body scopes must be rejected.')
add('Content type boundary',request('/invocations',body,data['token'],'text/plain')[0]==415,'Non-JSON requests must be rejected.')
try:
 with urllib.request.urlopen('http://127.0.0.1:18080/stats',timeout=5) as response:stats=json.load(response)
except Exception:stats={}
add('Local model fixture used',stats.get('modelCalls',0)>0,'At least one model request reached the local fixture.')
print(json.dumps({'checks':checks}))
`;
