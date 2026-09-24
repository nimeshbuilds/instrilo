import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { archiveName, assertPackageFiles, killTree, metadata, repository, run } from './release-utils.mjs';

let tarball = join(repository, 'release', archiveName), output = join(repository, 'release', 'verification-local.json');
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--tarball' && args[index + 1]) tarball = resolve(args[++index]);
  else if (args[index] === '--output' && args[index + 1]) output = resolve(args[++index]);
  else throw new Error('Usage: npm run test:release -- [--tarball FILE] [--output FILE]');
}
if (process.platform === 'win32') throw new Error('Run release verification in WSL. Native Windows is not a supported release platform yet.');
const started = Date.now(), archiveBytes = await readFile(tarball);
const report = {
  schemaVersion: 1, package: metadata.name, version: metadata.version,
  sha256: createHash('sha256').update(archiveBytes).digest('hex'),
  generatedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.versions.node,
  status: 'running', checks: [],
  scope: 'Clean global, local-hoisted and extracted installs of the release archive; installed CLI aliases/manual; copying tutorial workspaces without a source checkout and rejecting existing destinations; native TypeScript generation, dependency preparation and execution; Python generation; local browser app assets and authenticated API; web/browser-launch readiness, opt-in/opt-out and failed-opener fallback using isolated opener fixtures; uninstall preserves user projects.',
  limitations: ['Runtime dependencies require npm registry access.', 'No live provider login, paid model request, cloud deployment, native Windows operation or Python execution is claimed.', 'Browser launch checks use isolated OS-opener executable fixtures against the actual loopback server, printed session URL and authenticated API; no real desktop browser or native WSL handoff is claimed.'],
};
const root = await mkdtemp(join(tmpdir(), 'instrilo-release-'));
const env = {};
for (const key of ['PATH', 'HOME', 'USERPROFILE', 'USER', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'CI', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']) if (process.env[key]) env[key] = process.env[key];
Object.assign(env, { npm_config_userconfig: join(root, 'empty.npmrc'), npm_config_cache: join(root, 'npm-cache'), OTEL_SDK_DISABLED: 'true', DO_NOT_TRACK: '1' });
await writeFile(env.npm_config_userconfig, '');
const command = (binary, arguments_, options = {}) => run(binary, arguments_, { cwd: root, env, ...options });
const passed = (id, details) => { report.checks.push({ id, status: 'passed', details }); console.log(`PASS ${id}`); };
const exists = async path => { try { await access(path); return true; } catch { return false; } };
let app;
const stopApp = async () => {
  if (!app) return;
  const child = app;
  app = undefined;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolveStop => {
    const timer = setTimeout(() => killTree(child, 'SIGKILL'), 2000);
    child.once('close', () => { clearTimeout(timer); resolveStop(); });
    killTree(child);
  });
};
const startInstalledApp = async (binary, arguments_, appEnv = env) => {
  assert.equal(app, undefined, 'Stop the previous app before starting another installed launch check.');
  app = spawn(binary, arguments_, { cwd: root, env: appEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const child = app;
  let captured = '', errors = '';
  const url = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error('Installed app did not become ready within 15 seconds.')), 15_000);
    const fail = message => { clearTimeout(timer); reject(new Error(message)); };
    child.stdout.on('data', chunk => {
      captured += chunk;
      if (captured.length > 65_536) { fail('Installed app exceeded startup output limit.'); killTree(child, 'SIGKILL'); return; }
      const match = captured.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]{64}/);
      if (match) { clearTimeout(timer); resolveUrl(new URL(match[0])); }
    });
    // URLs and paths stay in process memory or the disposable private fixture directory.
    child.stderr.on('data', chunk => {
      errors += chunk;
      if (errors.length > 65_536) { fail('Installed app exceeded diagnostic output limit.'); killTree(child, 'SIGKILL'); }
    });
    child.once('error', () => fail('Installed app could not start.'));
    child.once('close', () => fail('Installed app stopped before becoming ready.'));
  });
  return { url, stderr: () => errors };
};
const waitUntil = async (check, description) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise(resolveWait => setTimeout(resolveWait, 25));
  }
  throw new Error(description);
};
const verifyLiveSession = async url => {
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  assert.ok(token && /^[0-9a-f]{64}$/.test(token), 'Installed launcher must print a complete private session token.');
  assert.equal((await fetch(new URL('/api/meta', url), { signal: AbortSignal.timeout(5_000) })).status, 401);
  const response = await fetch(new URL('/api/meta', url), { headers: { 'X-Studio-Token': token }, signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200, 'Installed launcher must remain usable with its printed authenticated URL.');
  assert.equal((await response.json()).version, metadata.version);
};
const stopOnSignal = () => { killTree(app, 'SIGKILL'); };
process.once('SIGINT', stopOnSignal); process.once('SIGTERM', stopOnSignal);
try {
  const archiveFiles = (await command('tar', ['-tzf', tarball])).stdout.trim().split('\n');
  assert.ok(archiveFiles.every(file => file.startsWith('package/')), 'Every archive file must have the npm package prefix.');
  assertPackageFiles(archiveFiles.map(file => file.slice('package/'.length)));
  passed('package-contents', 'Restrictive allowlist, complete compiled CLI/app assets, both language templates, offline reference and all ten example definitions.');

  const prefix = join(root, 'global');
  await command('npm', ['install', '--global', '--prefix', prefix, '--omit=dev', '--no-audit', '--no-fund', tarball]);
  const globalModules = (await command('npm', ['root', '--global', '--prefix', prefix])).stdout.trim();
  const installed = join(globalModules, '@nimeshbuilds/instrilo');
  const installedMetadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(installedMetadata.version, metadata.version);
  assert.equal(await exists(join(installed, 'src')), false, 'Release must not depend on source checkout.');
  assert.equal(await exists(join(installed, 'node_modules/typescript')), false, 'Installation must not need the TypeScript compiler.');
  for (const alias of ['instrilo', 'in', 'nb-agent']) {
    const binary = join(prefix, 'bin', alias);
    assert.equal((await command(binary, ['--version'])).stdout.trim(), metadata.version);
    assert.match((await command(binary, ['--help'])).stdout, /Instrilo|instrilo/);
  }
  const aliasEnv = { ...env, PATH: `${join(prefix, 'bin')}:${env.PATH || ''}` };
  assert.equal((await command('/bin/bash', ['--noprofile', '--norc', '-c', 'command in --version'], { env: aliasEnv })).stdout.trim(), metadata.version);
  const cli = (arguments_, options) => command(join(prefix, 'bin', 'instrilo'), arguments_, options);
  const allHelp = (await cli(['help', '--all'])).stdout, allManual = (await cli(['explain', '--all'])).stdout;
  assert.ok(allHelp.length > 20_000 && allManual.length > 20_000, 'Comprehensive offline help/manual must be present.');
  for (const term of ['subscriptions', 'deployment', 'approval', 'guidance', 'judge']) assert.ok(allManual.toLowerCase().includes(term), `Offline manual is missing ${term}.`);
  assert.ok((await readFile(join(installed, 'docs/CLI.md'), 'utf8')).length > 20_000);
  passed('global-install-aliases-manual', 'Installed without development dependencies; instrilo, in, nb-agent, Bash reserved-word invocation and comprehensive offline help all work.');

  const tutorials = join(root, 'tutorial-workspace');
  const tutorialSetup = JSON.parse((await cli(['tutorials', 'setup', tutorials])).stdout);
  assert.equal(tutorialSetup.tutorials, 10);
  const tutorialList = JSON.parse((await cli(['tutorials', 'list'])).stdout);
  assert.equal(tutorialList.length, 10);
  for (const tutorial of tutorialList) {
    const guide = await readFile(join(tutorials, 'guides', `${tutorial.id}.md`), 'utf8');
    assert.ok(guide.includes('instrilo tutorials setup'));
    assert.ok(!guide.includes('node dist/cli.js'), 'Bundled user guides must use the installed CLI.');
  }
  assert.match((await cli(['tutorials', 'show', 'deployment-artifacts'])).stdout, /instrilo deployment /);
  for (const path of ['foundations/answers.json', 'foundations/guidance/product.md', 'foundations/fixture.mjs', 'foundations/verify.mjs', 'delivery/fixture.mjs', 'delivery/verify.mjs']) {
    const copied = join(tutorials, 'examples/quickstarts', path);
    assert.equal((await lstat(copied)).isSymbolicLink(), false, 'Tutorial files must be independent copies.');
    assert.deepEqual(await readFile(copied), await readFile(join(installed, 'examples/quickstarts', path)));
  }
  for (const path of ['dist', 'src', 'node_modules']) assert.equal(await exists(join(tutorials, path)), false, 'Tutorials must not require a source-checkout layout.');
  await cli(['guidance', 'inspect', 'examples/quickstarts/foundations/guidance'], { cwd: tutorials });
  const editable = join(tutorials, 'examples/quickstarts/foundations/guidance/product.md');
  await writeFile(editable, 'User-owned tutorial edits must remain intact.\n');
  await assert.rejects(cli(['tutorials', 'setup', tutorials]), 'Existing tutorial directories must be rejected.');
  assert.equal(await readFile(editable, 'utf8'), 'User-owned tutorial edits must remain intact.\n');
  assert.notEqual(await readFile(join(installed, 'examples/quickstarts/foundations/guidance/product.md'), 'utf8'), await readFile(editable, 'utf8'));
  const occupied = join(root, 'occupied-tutorial-path');
  await writeFile(occupied, 'Existing user file.\n');
  await assert.rejects(cli(['tutorials', 'setup', occupied]), 'Existing files must be rejected.');
  assert.equal(await readFile(occupied, 'utf8'), 'Existing user file.\n');
  passed('installed-tutorial-workspace', 'The installed CLI copies bundled guidance and fixture helpers into a fresh workspace, works there without source/dependency symlinks, preserves independent user edits, and refuses existing file or directory destinations.');

  const projects = join(root, 'user-projects');
  await cli(['init', 'typescript-release', '--directory', projects, '--language', 'typescript']);
  const tsProject = join(projects, 'typescript-release');
  await cli(['build', tsProject]);
  await cli(['prepare', tsProject]);
  const result = JSON.parse((await cli(['run', tsProject, '--input', 'Hello from the release'])).stdout);
  assert.equal(result.output, '[DEMO ONLY] Hello from the release');
  assert.ok(Array.isArray(result.trace) && result.trace.length > 0);
  for (const file of ['agent.ts', 'runtime.ts', 'server.ts', 'session.ts', 'mcp_server.ts', 'package.json', 'build-lock.json']) await access(join(tsProject, 'generated', file));
  passed('typescript-generation-and-run', 'The installed CLI generated, prepared and actually executed its native TypeScript runtime; the explicit offline result and trace were checked.');

  await cli(['init', 'python-release', '--directory', projects, '--language', 'python']);
  const pyProject = join(projects, 'python-release');
  await cli(['build', pyProject]);
  for (const file of ['agent.py', 'runtime.py', 'server.py', 'session.py', 'mcp_server.py', 'pyproject.toml', 'build-lock.json']) {
    assert.ok((await readFile(join(pyProject, 'generated', file), 'utf8')).length > 20, `Missing/empty Python artifact ${file}.`);
  }
  passed('python-template-generation', 'The installed package generated the Python runtime, HTTP/MCP servers, session support, project metadata and build evidence; no Python interpreter is required for generation.');

  const openerDirectory = join(root, 'opener-fixtures');
  await mkdir(openerDirectory);
  const openerFixture = String.raw`#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';
const record = process.env.INSTRILO_RELEASE_OPENER_RECORD;
const urlText = process.argv.find(value => /^http:\/\/127\.0\.0\.1:/.test(value));
const append = async value => appendFile(record, JSON.stringify(value) + '\n');
await append({ invoked: true });
try {
  const url = new URL(urlText);
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  const page = await fetch(url, { signal: AbortSignal.timeout(3000) });
  const unauthenticated = await fetch(new URL('/api/meta', url), { signal: AbortSignal.timeout(3000) });
  const authenticated = await fetch(new URL('/api/meta', url), { headers: { 'X-Studio-Token': token ?? '' }, signal: AbortSignal.timeout(3000) });
  const info = await authenticated.json();
  await append({ complete: true, url: urlText, html: page.status, unauthenticated: unauthenticated.status, authenticated: authenticated.status, version: info.version });
  process.exitCode = process.env.INSTRILO_RELEASE_OPENER_FAIL === '1' ? 17 : 0;
} catch {
  await append({ complete: true, failed: true });
  process.exitCode = 19;
}
`;
  for (const executable of ['open', 'xdg-open', 'wslview', 'explorer.exe']) {
    const path = join(openerDirectory, executable);
    await writeFile(path, openerFixture);
    await chmod(path, 0o755);
  }
  const openerEnv = record => ({ ...env, PATH: `${openerDirectory}:${env.PATH || ''}`, INSTRILO_RELEASE_OPENER_RECORD: record });
  const openerRecords = async record => {
    if (!await exists(record)) return [];
    const text = await readFile(record, 'utf8');
    return text.split('\n').slice(0, -1).filter(Boolean).map(line => JSON.parse(line));
  };
  const verifyOpening = async (record, url) => {
    const entry = await waitUntil(async () => (await openerRecords(record)).find(item => item.complete), 'Installed launcher did not finish its isolated browser-open attempt.');
    assert.equal(entry.failed, undefined, 'The local server must already be reachable when the platform opener is invoked.');
    assert.ok(entry.url === url.href, 'The platform opener must receive exactly the printed authenticated URL.');
    assert.equal(entry.html, 200);
    assert.equal(entry.unauthenticated, 401);
    assert.equal(entry.authenticated, 200);
    assert.equal(entry.version, metadata.version);
  };
  const manualRecord = join(root, 'manual-app-opener.jsonl');
  const { url: appUrl } = await startInstalledApp(join(prefix, 'bin', 'instrilo'), ['app', '--workspace', projects, '--port', '0'], openerEnv(manualRecord));
  const request = path => fetch(new URL(path, appUrl), { signal: AbortSignal.timeout(10_000) });
  const html = await request('/');
  assert.equal(html.status, 200); assert.match(await html.text(), /<title>Instrilo<\/title>/);
  for (const [asset, mime] of [['app.js', 'javascript'], ['deployment.js', 'javascript'], ['style.css', 'css'], ['icon.svg', 'svg']]) {
    const response = await request(`/${asset}`);
    assert.equal(response.status, 200, `App asset ${asset} must be served.`);
    assert.ok(response.headers.get('content-type')?.includes(mime));
    assert.ok((await response.text()).length > 100, `App asset ${asset} must not be empty.`);
  }
  assert.equal((await request('/api/meta')).status, 401);
  const token = new URLSearchParams(appUrl.hash.slice(1)).get('token');
  const authenticated = await fetch(new URL('/api/meta', appUrl), { headers: { 'X-Studio-Token': token }, signal: AbortSignal.timeout(10_000) });
  assert.equal(authenticated.status, 200); assert.equal((await authenticated.json()).version, metadata.version);
  const listed = await fetch(new URL('/api/projects', appUrl), { headers: { 'X-Studio-Token': token }, signal: AbortSignal.timeout(10_000) });
  assert.equal(listed.status, 200); assert.equal((await listed.json()).length, 2);
  await new Promise(resolveObservation => setTimeout(resolveObservation, 300));
  assert.equal(await exists(manualRecord), false, 'The legacy app command must remain manual unless --open is requested.');
  await stopApp();
  passed('installed-browser-app', 'Local branded HTML, all JavaScript/CSS/icon assets, rejected unauthenticated API access, authenticated version metadata and both generated projects were verified.');

  for (const [id, arguments_, description] of [
    ['installed-web-auto-open', ['web', '--workspace', projects], 'The installed web command selects an available port and invokes the platform opener only after its authenticated server is reachable.'],
    ['installed-web-enable', ['web', 'enable', '--workspace', projects, '--port', '0'], 'The installed web enable form opens the same ready authenticated local app with explicit workspace and port options.'],
    ['installed-app-open-opt-in', ['app', '--workspace', projects, '--port', '0', '--open'], 'The legacy app command supports explicit browser opening while its ordinary startup remains manual.'],
  ]) {
    const record = join(root, `${id}.jsonl`);
    const { url } = await startInstalledApp(join(prefix, 'bin', 'instrilo'), arguments_, openerEnv(record));
    await verifyOpening(record, url);
    await verifyLiveSession(url);
    await stopApp();
    passed(id, description);
  }

  for (const variant of [[], ['enable']]) {
    const noOpenRecord = join(root, `web-${variant.length ? 'enable-' : ''}no-open.jsonl`);
    const { url: noOpenUrl } = await startInstalledApp(join(prefix, 'bin', 'instrilo'), ['web', ...variant, '--workspace', projects, '--port', '0', '--no-open'], openerEnv(noOpenRecord));
    await verifyLiveSession(noOpenUrl);
    // Keep the server alive long enough to observe an incorrectly scheduled detached opener.
    await new Promise(resolveObservation => setTimeout(resolveObservation, 300));
    assert.equal(await exists(noOpenRecord), false, '--no-open must never invoke the platform opener.');
    await stopApp();
  }
  passed('installed-web-no-open', 'Both installed web and web enable forms honor --no-open, print usable authenticated URLs and never invoke the browser opener.');

  const failingRecord = join(root, 'web-failed-opener.jsonl');
  const failedOpen = await startInstalledApp(join(prefix, 'bin', 'instrilo'), ['web', '--workspace', projects, '--port', '0'], { ...openerEnv(failingRecord), INSTRILO_RELEASE_OPENER_FAIL: '1' });
  await verifyOpening(failingRecord, failedOpen.url);
  await waitUntil(() => failedOpen.stderr().length > 0, 'A failed browser opener must produce a manual-opening diagnostic.');
  await verifyLiveSession(failedOpen.url);
  await stopApp();
  passed('installed-web-opener-fallback', 'A failed isolated platform opener produces a diagnostic while the printed authenticated URL and local app remain usable; no real browser is launched.');

  const consumer = join(root, 'local-consumer');
  await mkdir(consumer);
  await command('npm', ['install', '--prefix', consumer, '--omit=dev', '--no-audit', '--no-fund', tarball]);
  const localCli = join(consumer, 'node_modules/.bin/instrilo');
  assert.equal(await exists(join(consumer, 'node_modules/tsx')), true, 'Exercise npm-hoisted runtime dependencies.');
  assert.equal(await exists(join(consumer, 'node_modules/@nimeshbuilds/instrilo/node_modules/tsx')), false, 'Local install should expose the hoisted-layout case.');
  const localResult = JSON.parse((await command(localCli, ['run', tsProject, '--input', 'Hoisted package works'])).stdout);
  assert.equal(localResult.output, '[DEMO ONLY] Hoisted package works');
  passed('local-install-hoisted-runtime', 'A separate local npm installation executed the prepared agent with hoisted runtime dependencies.');

  const extracted = join(root, 'extracted');
  await mkdir(extracted);
  await command('tar', ['-xzf', tarball, '-C', extracted]);
  const extractedPackage = join(extracted, 'package');
  await command('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: extractedPackage });
  const linkedPrefix = join(root, 'linked-prefix');
  await command('npm', ['link'], { cwd: extractedPackage, env: { ...env, npm_config_prefix: linkedPrefix } });
  const linkedCli = join(linkedPrefix, 'bin', 'instrilo');
  assert.equal((await command(linkedCli, ['--version'], { cwd: root })).stdout.trim(), metadata.version);
  const linkedTutorials = join(root, 'linked-tutorials');
  await command(linkedCli, ['tutorials', 'setup', linkedTutorials]);
  await command(linkedCli, ['guidance', 'inspect', 'examples/quickstarts/foundations/guidance'], { cwd: linkedTutorials });
  const extractedResult = JSON.parse((await command(linkedCli, ['run', tsProject, '--input', 'Extracted package works'], { cwd: root })).stdout);
  assert.equal(extractedResult.output, '[DEMO ONLY] Extracted package works');
  passed('extracted-package-link', 'The extracted archive installs runtime dependencies and npm link exposes the named instrilo CLI in an isolated prefix; tutorial setup, guidance inspection and actual TypeScript execution work outside the package directory.');

  await command('npm', ['uninstall', '--global', '--prefix', prefix, '--no-audit', '--no-fund', metadata.name]);
  for (const alias of ['instrilo', 'in', 'nb-agent']) assert.equal(await exists(join(prefix, 'bin', alias)), false);
  await access(join(tsProject, 'agent-studio.yaml')); await access(join(pyProject, 'agent-studio.yaml'));
  passed('uninstall-preserves-projects', 'npm uninstall removes the installed package and all aliases while retaining the separately created user projects.');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : String(error));
} finally {
  await stopApp();
  process.removeListener('SIGINT', stopOnSignal); process.removeListener('SIGTERM', stopOnSignal);
  await rm(root, { recursive: true, force: true });
  report.durationMs = Date.now() - started;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(`Release verification ${report.status}: ${report.checks.length} checks. Report contains no private session URLs, workspace paths or command output.`);
