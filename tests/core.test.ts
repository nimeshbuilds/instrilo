import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyGuidance, defaultSpec, guidanceQuestions, inspectGuidance, loadSpec,
  readCases, saveSpec, validateSpec, writeExampleCases, writeGuidance,
} from '../src/core.js';
import type { GuidanceAnswers, ProjectSpec } from '../src/types.js';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const dir = await mkdtemp(join(tmpdir(), 'nb-agent-core-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function apiSpec(): ProjectSpec {
  const spec = defaultSpec('test-agent');
  spec.connections = { api: { kind: 'openai', model: 'test-model', auth: { type: 'api-key', env: 'MODEL_API_KEY' } } };
  spec.roles = { builder: 'api', runtime: 'api', judge: 'api' };
  return spec;
}
function codes(spec: unknown) { return validateSpec(spec).issues.map(i => i.code); }

test('default project is explicitly offline and names cannot escape output directories', () => {
  const result = validateSpec(defaultSpec('support-drafter'));
  assert.ok(result.spec);
  assert.ok(result.issues.some(i => i.code === 'DEMO_MODE'));
  for (const bad of ['../outside', 'a/b', 'AGENT', '', '-agent', 'a'.repeat(64)]) assert.throws(() => defaultSpec(bad));
  assert.equal(validateSpec({ ...defaultSpec('agent'), surprisingSecretField: 'value' }).spec, undefined);
});

test('roles resolve own connections and authentication stores references rather than key values', () => {
  const spec = apiSpec();
  spec.roles.judge = 'missing';
  assert.ok(codes(spec).includes('MISSING_CONNECTION'));
  spec.roles.judge = 'api';
  delete spec.connections.api.auth.env;
  assert.ok(codes(spec).includes('MISSING_AUTH_REFERENCE'));
  spec.connections.api.auth.env = 'sk-real-secret-value';
  assert.equal(validateSpec(spec).spec, undefined);
  spec.connections.api.auth = { type: 'none' };
  assert.ok(codes(spec).includes('PROVIDER_AUTH_REQUIRED'));
});

test('OAuth references require all fields and a secure token endpoint', () => {
  const spec = apiSpec();
  spec.connections.api = { kind: 'gateway', model: 'test-model', baseUrl: 'https://example.com/v1', auth: { type: 'oauth-client-credentials' } };
  assert.equal(validateSpec(spec).issues.filter(i => i.code === 'MISSING_AUTH_REFERENCE').length, 3);
  spec.connections.api.auth = { type: 'oauth-client-credentials', tokenUrl: 'http://example.com/token', clientIdEnv: 'CLIENT_ID', clientSecretEnv: 'CLIENT_SECRET' };
  assert.ok(codes(spec).includes('INSECURE_TOKEN_URL'));
  spec.connections.api.auth.tokenUrl = 'https://example.com/token';
  assert.ok(validateSpec(spec).spec);
});

test('framework/provider matrix rejects combinations the generators cannot implement', () => {
  const spec = apiSpec();
  spec.framework = 'crewai';
  assert.ok(codes(spec).includes('FRAMEWORK_LANGUAGE'));
  spec.language = 'python';
  assert.ok(validateSpec(spec).spec);
  spec.connections.api.kind = 'xai';
  assert.ok(codes(spec).includes('FRAMEWORK_PROVIDER'));
  spec.framework = 'openai-agents';
  assert.ok(validateSpec(spec).spec);
  spec.connections.api.kind = 'ollama';
  spec.connections.api.auth = { type: 'none' };
  assert.ok(codes(spec).includes('FRAMEWORK_PROVIDER'));
  spec.framework = 'langgraph';
  assert.ok(validateSpec(spec).spec);
  spec.connections.api.kind = 'anthropic';
  spec.connections.api.auth = { type: 'api-key', env: 'ANTHROPIC_API_KEY' };
  assert.ok(codes(spec).includes('FRAMEWORK_PROVIDER'));
  spec.framework = 'native';
  assert.ok(validateSpec(spec).spec);
});

test('CLI runtime only supports native local prompts without portable HTTP tools', () => {
  const spec = apiSpec();
  spec.connections.api = { kind: 'codex-cli', auth: { type: 'none' } };
  assert.ok(validateSpec(spec).spec);
  spec.framework = 'langgraph';
  assert.ok(codes(spec).includes('CLI_RUNTIME_COMPATIBILITY'));
  spec.framework = 'native';
  spec.delivery.target = 'docker';
  assert.ok(codes(spec).includes('CLI_RUNTIME_COMPATIBILITY'));
  spec.delivery.target = 'local';
  spec.agent.tools = [{ name: 'lookup', description: 'Lookup', kind: 'http', url: 'https://example.com/lookup', method: 'GET', requiresApproval: false, requiredScopes: [], inputSchema: { type: 'object' } }];
  assert.ok(codes(spec).includes('CLI_RUNTIME_TOOLS'));
  spec.agent.tools = [];
  spec.delivery.hosts = ['chatgpt'];
  assert.ok(codes(spec).includes('CLI_REMOTE_HOST'));
  spec.delivery.hosts = [];
  spec.connections.api.auth = { type: 'api-key', env: 'KEY' };
  assert.ok(codes(spec).includes('CLI_AUTH_SESSION'));
});

test('offline connections never pass framework/cloud compatibility as a live integration', () => {
  const spec = defaultSpec('demo-agent');
  spec.delivery.target = 'aws-agentcore';
  assert.ok(codes(spec).includes('DEMO_COMPATIBILITY'));
  spec.delivery.target = 'local';
  spec.framework = 'langgraph';
  assert.ok(codes(spec).includes('DEMO_COMPATIBILITY'));
  spec.framework = 'native';
  spec.connections.demo.auth = { type: 'bearer-env', env: 'TOKEN' };
  assert.ok(codes(spec).includes('DEMO_AUTH'));
});

test('offline builder and judge do not restrict a separately configured live runtime', () => {
  const spec = defaultSpec('independent-roles');
  spec.connections.runtime = { kind: 'openai', model: 'explicit-model', auth: { type: 'api-key', env: 'OPENAI_API_KEY' } };
  spec.roles.runtime = 'runtime'; spec.framework = 'langgraph'; spec.delivery.target = 'aws-agentcore';
  assert.ok(validateSpec(spec).spec);
  assert.ok(codes(spec).includes('DEMO_MODE'));
  spec.connections.judge = structuredClone(spec.connections.runtime); spec.roles.judge = 'judge';
  assert.ok(codes(spec).includes('SHARED_JUDGE_CONNECTION'));
});

test('JWT validates asymmetric algorithm allowlist and complete issuer configuration', () => {
  const spec = apiSpec();
  spec.security.inbound.mode = 'jwt';
  assert.equal(validateSpec(spec).issues.filter(i => i.code === 'JWT_CONFIGURATION').length, 3);
  spec.security.inbound = { mode: 'jwt', issuer: 'https://issuer.example.com/', audience: 'agent', jwksUrl: 'https://issuer.example.com/jwks', algorithms: ['RS256'] };
  assert.ok(validateSpec(spec).spec);
  spec.security.inbound.algorithms = ['HS256'];
  assert.equal(validateSpec(spec).spec, undefined);
  spec.security.inbound.algorithms = ['none'];
  assert.equal(validateSpec(spec).spec, undefined);
  spec.security.inbound.algorithms = ['ES256'];
  spec.delivery.target = 'aws-agentcore';
  spec.security.inbound.jwksUrl = 'http://localhost:9000/jwks';
  assert.ok(codes(spec).includes('JWT_HTTPS_REQUIRED'));
});

test('hosted unauthenticated service warns and scopes require verified identity', () => {
  const spec = apiSpec();
  spec.delivery.target = 'docker';
  assert.ok(codes(spec).includes('HOSTED_WITHOUT_AUTH'));
  assert.ok(validateSpec(spec).spec);
  spec.security.requiredScopes = ['agent:run'];
  assert.ok(codes(spec).includes('AUTHORIZATION_WITHOUT_IDENTITY'));
  spec.delivery.target = 'aws-agentcore';
  assert.ok(codes(spec).includes('AGENTCORE_IAM_BOUNDARY'));
  assert.ok(!codes(spec).includes('HOSTED_WITHOUT_AUTH'));
  assert.ok(codes(spec).includes('AUTHORIZATION_WITHOUT_IDENTITY'), 'Platform IAM does not grant application JWT scopes.');
});

test('HTTP tools reject unsafe URL schemes, credential URLs, duplicate names and invalid schemas', () => {
  const spec = apiSpec();
  const tool = { name: 'lookup', description: 'Lookup', kind: 'http' as const, url: 'file:///etc/passwd', method: 'GET' as const, requiresApproval: false, requiredScopes: [], inputSchema: { type: 'object' } };
  spec.agent.tools = [tool];
  assert.equal(validateSpec(spec).spec, undefined);
  tool.url = 'https://user:secret@example.com/path';
  assert.equal(validateSpec(spec).spec, undefined);
  tool.url = 'https://example.com/path';
  assert.ok(validateSpec(spec).spec);
  spec.agent.tools.push({ ...tool });
  assert.ok(codes(spec).includes('DUPLICATE_TOOL'));
  spec.agent.tools = [{ ...tool, inputSchema: {} as { type: string } }];
  assert.ok(codes(spec).includes('TOOL_INPUT_SCHEMA'));
});

test('YAML and JSON project round trips preserve specification and reject unsafe symlink writes', async t => {
  const dir = await fixture(t);
  const spec = apiSpec();
  for (const extension of ['yaml', 'json']) {
    const path = join(dir, `project.${extension}`);
    await saveSpec(path, spec);
    assert.deepEqual(await loadSpec(path), spec);
  }
  const original = join(dir, 'important.txt');
  await writeFile(original, 'preserve');
  await symlink(original, join(dir, 'link.yaml'));
  await assert.rejects(saveSpec(join(dir, 'link.yaml'), spec));
  assert.equal(await readFile(original, 'utf8'), 'preserve');
});

test('guidance inventory is deterministic and excludes hidden, secret, dependency, symlink and binary files', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'z.md'), '## Purpose\nAnswer questions.');
  await writeFile(join(dir, 'a.txt'), 'Reference text.');
  await writeFile(join(dir, '.env'), 'SECRET=hidden');
  await writeFile(join(dir, 'credentials.json'), '{"token":"secret"}');
  await writeFile(join(dir, 'binary.md'), Buffer.from([0, 1, 2]));
  await writeFile(join(dir, 'leaked.md'), 'sk-abcdefghijklmnopqrstuvwxyz1234567890');
  await mkdir(join(dir, 'node_modules'));
  await writeFile(join(dir, 'node_modules', 'nested.md'), 'not guidance');
  await symlink(join(dir, 'z.md'), join(dir, 'link.md'));
  const first = await inspectGuidance(dir);
  const second = await inspectGuidance(dir);
  assert.deepEqual(first, second);
  assert.deepEqual(first.files.map(f => f.path), ['a.txt', 'z.md']);
  assert.match(first.files[0].sha256, /^[a-f0-9]{64}$/);
  assert.ok(first.issues.some(i => i.code === 'GUIDANCE_SYMLINK_SKIPPED'));
  assert.ok(first.issues.some(i => i.code === 'GUIDANCE_SECRET_SKIPPED'));
  assert.ok(first.issues.some(i => i.code === 'GUIDANCE_BINARY_SKIPPED'));
  assert.ok(!first.combined.includes('abcdefghijklmnopqrstuvwxyz'));
  assert.ok(!first.missing.includes('purpose'));
  assert.ok(first.missing.includes('boundaries'));
});

test('oversized files and invalid root symlinks cannot enter guidance prompts', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'oversized.md'), 'a'.repeat(64_001));
  assert.equal((await inspectGuidance(dir)).files.length, 0);
  const target = join(dir, 'real');
  await mkdir(target);
  await symlink(target, join(dir, 'alias'));
  const result = await inspectGuidance(join(dir, 'alias'));
  assert.ok(result.issues.some(i => i.level === 'error'));
  assert.throws(() => applyGuidance(defaultSpec('agent'), result));
});

test('guidance conflicts are surfaced and contradictory explicit directives cannot be applied', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'one.md'), '## Boundaries\nALLOW: send refunds\n');
  await writeFile(join(dir, 'two.md'), '## Boundaries\nDENY: send refunds\n');
  const report = await inspectGuidance(dir);
  assert.ok(report.issues.some(i => i.code === 'GUIDANCE_POSSIBLE_CONFLICT'));
  assert.ok(report.issues.some(i => i.code === 'GUIDANCE_CONFLICT'));
  assert.throws(() => applyGuidance(defaultSpec('agent'), report), /conflicting/);
});

test('the interview retains missing decisions and never overwrites an existing guide', async t => {
  const dir = await fixture(t);
  const answers = Object.fromEntries(guidanceQuestions.map(q => [q.key, ''])) as unknown as GuidanceAnswers;
  answers.purpose = 'Draft grounded support responses.';
  const written = await writeGuidance(dir, answers);
  assert.equal(written.length, 1);
  const report = await inspectGuidance(dir);
  assert.ok(!report.missing.includes('purpose'));
  assert.ok(report.missing.includes('success'));
  assert.match(report.combined, /UNDECIDED/);
  await assert.rejects(writeGuidance(dir, answers), /EEXIST/);
  const spec = defaultSpec('agent');
  const applied = applyGuidance(spec, report);
  assert.notEqual(applied.agent.systemPrompt, spec.agent.systemPrompt);
  assert.deepEqual(applyGuidance(applied, report), applied);
  assert.deepEqual(applied.agent.tools, []);
});

test('a completed interview is recognized without inventing decisions', async t => {
  const dir = await fixture(t);
  const answers = Object.fromEntries(guidanceQuestions.map(q => [q.key, `Project owner supplied ${q.key} requirements.`])) as unknown as GuidanceAnswers;
  await writeGuidance(dir, answers);
  assert.deepEqual((await inspectGuidance(dir)).missing, []);
});

test('example cases stay synthetic/development; datasets require provenance and unique IDs', async t => {
  const dir = await fixture(t);
  const path = join(dir, 'cases.jsonl');
  await writeExampleCases(path);
  const cases = await readCases(path);
  assert.ok(cases.every(c => c.source === 'synthetic' && c.split === 'development'));
  await assert.rejects(writeExampleCases(path), /EEXIST/);
  await writeFile(path, JSON.stringify({ id: 'a', input: 'hello' }));
  await assert.rejects(readCases(path), /source|split/);
  await writeFile(path, `${JSON.stringify(cases[0])}\n${JSON.stringify(cases[0])}\n`);
  await assert.rejects(readCases(path), /Duplicate/);
  await writeFile(path, 'not JSON');
  await assert.rejects(readCases(path), /line 1/);
});
