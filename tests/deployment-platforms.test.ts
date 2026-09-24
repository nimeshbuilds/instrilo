import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { parse as yaml } from 'yaml';
import { deploymentPlatform, deploymentPlatforms } from '../src/deployment-platforms.js';
import { generateArtifacts, writeArtifacts } from '../src/generators.js';
import type { GuidanceReport, ProjectSpec, Target } from '../src/types.js';

const exec = promisify(execFile);
const guidance: GuidanceReport = { root: 'guidance', files: [], combined: 'Return a brief answer.', issues: [], missing: [] };
function spec(target: Target): ProjectSpec {
  return { schemaVersion: '1', name: 'deployment-fixture', description: 'Contract fixture', language: 'typescript', framework: 'native', guidanceDir: 'guidance',
    connections: { api: { kind: 'openai', model: 'fixture', auth: { type: 'api-key', env: 'MODEL_KEY' } } }, roles: { builder: 'api', runtime: 'api', judge: 'api' },
    agent: { systemPrompt: 'Answer briefly.', tools: [], limits: { maxSteps: 2, timeoutMs: 45000, maxOutputTokens: 200 } },
    evaluation: { dataset: 'evals/cases.jsonl', rubric: 'evals/rubric.md', threshold: .8 },
    security: { inbound: { mode: 'jwt', issuer: 'https://identity.example/', audience: 'agent', jwksUrl: 'https://identity.example/jwks', algorithms: ['RS256'] }, requiredScopes: [] },
    delivery: { target, hosts: [], port: 8080 } };
}
const contents = (target: Target, path: string) => generateArtifacts(spec(target), guidance).find(f => f.path === path)!.content;

test('deployment plans expose dated architecture contracts and execution remains explicit', () => {
  assert.equal(deploymentPlatform('aws-agentcore').architecture, 'linux/arm64');
  for (const target of ['cloud-run', 'azure-container-apps'] as const) assert.equal(deploymentPlatform(target).architecture, 'linux/amd64');
  const copy = deploymentPlatform('docker'); copy.constraints.length = 0;
  assert.ok(deploymentPlatform('docker').constraints.length);
  for (const platform of deploymentPlatforms()) {
    const plan = JSON.parse(contents(platform.target, 'deployment-plan.json'));
    assert.equal(plan.architecture, platform.architecture);
    assert.equal(plan.verifiedAt, '2026-09-24');
    assert.equal(plan.status, 'generated-not-deployed');
    assert.equal(plan.testing.sourceProjectRequired, true);
    assert.match(plan.testing.executeCommand, /--execute$/);
    if (platform.architecture !== 'host') assert.equal(yaml(contents(platform.target, 'compose.yaml')).services.agent.platform, platform.architecture);
    const guide = contents(platform.target, 'DEPLOYMENT.md');
    assert.match(guide, /prerequisites|Prerequisites/);
    assert.match(guide, /deployment cleanup RUN_ID/);
    assert.match(guide, /Mock results cannot prove cloud IAM/);
    assert.ok(platform.references.every(r => guide.includes(r.url)));
  }
});

test('Azure first-deploy identity, environment schema and health probes are complete', () => {
  const config = JSON.parse(contents('azure-container-apps', 'deploy/azure-container-app.json'));
  assert.deepEqual(yaml(contents('azure-container-apps', 'deploy/azure-container-app.yaml')), config);
  assert.equal(config.identity.type, 'UserAssigned');
  assert.equal(config.properties.environmentId, 'REPLACE_ENVIRONMENT_RESOURCE_ID');
  assert.equal(config.properties.managedEnvironmentId, undefined);
  assert.equal(config.properties.configuration.secrets[0].identity, 'REPLACE_IDENTITY_RESOURCE_ID');
  assert.equal(config.properties.template.containers[0].probes[0].httpGet.path, '/ping');
  const invalid = spec('azure-container-apps'); invalid.name = 'a'.repeat(33);
  assert.throws(() => generateArtifacts(invalid, guidance), /32 characters/);
  invalid.name = 'agent--invalid'; assert.throws(() => generateArtifacts(invalid, guidance), /consecutive/);
  invalid.name = 'a'.repeat(32); assert.throws(() => generateArtifacts(invalid, guidance), /fewer than 32/);
  const gcp = spec('cloud-run'); gcp.name = 'a'.repeat(50);
  assert.throws(() => generateArtifacts(gcp, guidance), /shorter than 50/);
  const aws = spec('aws-agentcore'); aws.name = 'a';
  assert.throws(() => generateArtifacts(aws, guidance), /at least 2/);
});

test('Azure secret names stay valid and unique for arbitrary environment references', () => {
  const project = spec('azure-container-apps');
  project.connections.api.auth = { type: 'oauth-client-credentials', tokenUrl: 'https://identity.example/token', clientIdEnv: '_Client_ID', clientSecretEnv: '_CLIENT_ID' };
  const config = JSON.parse(generateArtifacts(project, guidance).find(f => f.path === 'deploy/azure-container-app.json')!.content);
  const names = config.properties.configuration.secrets.map((s: { name: string }) => s.name);
  assert.equal(new Set(names).size, 2);
  assert.ok(names.every((n: string) => /^[a-z][a-z0-9-]*$/.test(n)));
  for (const environment of config.properties.template.containers[0].env) if (environment.secretRef) assert.ok(names.includes(environment.secretRef));
});

test('all generated cloud scripts and guide command blocks pass bash syntax validation', { skip: process.platform === 'win32' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'instrilo-platform-syntax-')); t.after(() => rm(dir, { recursive: true, force: true }));
  for (const platform of deploymentPlatforms()) {
    for (const file of generateArtifacts(spec(platform.target), guidance)) {
      if (!file.path.endsWith('.sh') && file.path !== 'DEPLOYMENT.md') continue;
      const blocks = file.path.endsWith('.sh') ? [file.content] : [...file.content.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]);
      for (let i = 0; i < blocks.length; i++) {
        const path = join(dir, `${platform.target}-${i}.sh`); await writeFile(path, blocks[i]);
        await exec('bash', ['-n', path]);
      }
    }
  }
});

test('Azure script resolves identity and environment before fixture deployment; refuses unresolved secrets before push', { skip: process.platform === 'win32' }, async t => {
  try { await exec('jq', ['--version']); } catch { t.skip('jq is required for generated deployment script fixture'); return; }
  const dir = await mkdtemp(join(tmpdir(), 'instrilo-azure-script-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeArtifacts(dir, generateArtifacts(spec('azure-container-apps'), guidance));
  const bin = join(dir, 'fixture-bin'), log = join(dir, 'commands.jsonl'); await mkdir(bin);
  await writeFile(join(bin, 'package.json'), '{"type":"commonjs"}');
  const executable = `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({binary:require('node:path').basename(process.argv[1]),args})+'\\n');if(args[0]==='acr'&&args[1]==='show')console.log('fixture.azurecr.io');\n`;
  for (const binary of ['az', 'docker']) await writeFile(join(bin, binary), executable, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_LOG: log, AZURE_RESOURCE_GROUP: 'fixture-rg', AZURE_REGISTRY: 'fixture', AZURE_REGION: 'eastus', AZURE_ENVIRONMENT_ID: '/subscriptions/fixture/managedEnvironments/fixture', AZURE_IDENTITY_ID: '/subscriptions/fixture/userAssignedIdentities/fixture' };
  await assert.rejects(exec('bash', [join(dir, 'deploy/azure.sh')], { env }), /Complete Key Vault/);
  let calls = (await readFile(log, 'utf8')).trim().split('\n').map(v => JSON.parse(v));
  assert.ok(!calls.some(c => c.args.includes('--push') || c.args[0] === 'containerapp'));
  const path = join(dir, 'deploy/azure-container-app.json'), config = JSON.parse(await readFile(path, 'utf8'));
  config.properties.configuration.secrets[0].keyVaultUrl = 'https://fixture.vault.azure.net/secrets/model-key'; await writeFile(path, JSON.stringify(config));
  await exec('bash', [join(dir, 'deploy/azure.sh')], { env });
  const rendered = yaml(await readFile(join(dir, '.deployment/azure-container-app.yaml'), 'utf8'));
  assert.equal(rendered.properties.environmentId, env.AZURE_ENVIRONMENT_ID);
  assert.deepEqual(rendered.identity.userAssignedIdentities, { [env.AZURE_IDENTITY_ID]: {} });
  assert.equal(rendered.properties.configuration.registries[0].identity, env.AZURE_IDENTITY_ID);
  assert.equal(rendered.properties.configuration.secrets[0].identity, env.AZURE_IDENTITY_ID);
  calls = (await readFile(log, 'utf8')).trim().split('\n').map(v => JSON.parse(v));
  assert.ok(calls.some(c => c.binary === 'docker' && c.args.includes('linux/amd64') && c.args.includes('--push')));
  assert.ok(calls.some(c => c.binary === 'az' && c.args.includes('.deployment/azure-container-app.yaml')));
});

test('AWS role permits stream writes and script checks placeholders before publishing', () => {
  const policy = JSON.parse(contents('aws-agentcore', 'deploy/aws-iam-policy.json'));
  assert.ok(policy.Statement.some((s: { Action: string[]; Resource: string }) => s.Action.includes('logs:PutLogEvents') && s.Resource.endsWith(':log-stream:*')));
  const script = contents('aws-agentcore', 'deploy/aws-agentcore.sh');
  assert.ok(script.indexOf('Replace secret/OIDC placeholders') < script.indexOf('--push'));
  assert.match(script, /--platform linux\/arm64 --provenance=false/);
  const cloudRun = contents('cloud-run', 'deploy/cloud-run.sh');
  assert.match(cloudRun, /--concurrency 1 --timeout 55/);
  assert.match(cloudRun, /--no-allow-unauthenticated/);
});
