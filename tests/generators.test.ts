import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateArtifacts, writeArtifacts } from '../src/generators.js';
import type { ProjectSpec, GuidanceReport } from '../src/types.js';
const spec: ProjectSpec = {
  schemaVersion: '1', name: 'agent-test', description: 'Draft support answers', language: 'typescript', framework: 'native', guidanceDir: 'guidance',
  connections: { demo: { kind: 'demo', model: 'demo', auth: { type: 'none' } } }, roles: { builder: 'demo', runtime: 'demo', judge: 'demo' },
  agent: { systemPrompt: 'Be concise.', tools: [], limits: { maxSteps: 3, timeoutMs: 30000, maxOutputTokens: 300 } },
  evaluation: { dataset: 'evals/cases.jsonl', rubric: 'evals/rubric.md', threshold: .8 }, security: { inbound: { mode: 'none', algorithms: ['RS256'] }, requiredScopes: [] }, delivery: { target: 'local', hosts: ['codex', 'claude-code', 'claude-desktop', 'chatgpt'], port: 8080 },
};
const guidance: GuidanceReport = { root: 'guidance', files: [], combined: 'Do not send messages without human approval.', issues: [], missing: [] };
const contents = (files: ReturnType<typeof generateArtifacts>, path: string) => files.find(a => a.path === path)!.content;
test('outputs executable agent contract and separates ChatGPT remote integration', () => {
  const files = generateArtifacts(spec, guidance);
  assert.match(contents(files, 'agent.ts'), /runNative\(input, ctx\)/);
  assert.match(contents(files, 'server.ts'), /jwtVerify/);
  assert.match(contents(files, 'runtime.ts'), /Approval required for exact call/);
  assert.match(contents(files, 'hosts/chatgpt.md'), /actual authenticated Streamable HTTP/);
  assert.match(contents(files, 'mcp_http.ts'), /StreamableHTTPServerTransport/);
  assert.ok(files.some(f => f.path.endsWith('/SKILL.md')));
});
test('declared frameworks generate actual calls and reject unsupported combinations', () => {
  const apiSpec = { ...spec, connections: { demo: { kind: 'openai' as const, model: 'explicit-model', auth: { type: 'api-key' as const, env: 'TEST_API_KEY' } } } };
  assert.match(contents(generateArtifacts({ ...apiSpec, framework: 'langgraph' }, guidance), 'agent.ts'), /new StateGraph/);
  assert.match(contents(generateArtifacts({ ...apiSpec, framework: 'openai-agents' }, guidance), 'agent.ts'), /new Runner/);
  assert.match(contents(generateArtifacts({ ...apiSpec, language: 'python', framework: 'crewai' }, guidance), 'agent.py'), /Crew\(agents=/);
  assert.throws(() => generateArtifacts({ ...apiSpec, framework: 'crewai' }, guidance), /Unsupported/);
  assert.throws(() => generateArtifacts({ ...spec, delivery: { ...spec.delivery, target: 'cloud-run' } }, guidance));
});
test('AWS scaffold uses arm64, secret references and health contract', () => {
  const aws: ProjectSpec = { ...spec, language: 'python', connections: { demo: { kind: 'gateway', model: 'test', baseUrl: 'https://gateway.example/v1', auth: { type: 'bearer-env', env: 'RUNTIME_TOKEN' } } }, delivery: { ...spec.delivery, target: 'aws-agentcore' } };
  const files = generateArtifacts(aws, guidance);
  assert.match(contents(files, 'deploy/aws-agentcore.sh'), /linux\/arm64/);
  assert.match(contents(files, 'deploy/aws-runtime.json'), /RUNTIME_TOKEN_SECRET_ARN/);
  assert.match(contents(files, 'server.py'), /\/ping/);
  assert.match(contents(files, 'Dockerfile'), /PORT=8080/);
});
test('artifact writer rejects traversal, symlinks and overwrites without partial writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nb-writer-'));
  try {
    await assert.rejects(writeArtifacts(dir, [{ path: '../escape', content: 'x' }]), /Unsafe/);
    await writeFile(join(dir, 'existing'), 'old');
    await assert.rejects(writeArtifacts(dir, [{ path: 'new', content: 'new' }, { path: 'existing', content: 'bad' }]));
    await assert.rejects(readFile(join(dir, 'new')));
    await symlink(join(dir, 'existing'), join(dir, 'linked'));
    await assert.rejects(writeArtifacts(dir, [{ path: 'linked', content: 'bad' }], { overwrite: true }), /symbolic-link/);
    assert.equal(await readFile(join(dir, 'existing'), 'utf8'), 'old');
    await writeArtifacts(dir, [{ path: 'sub/file.txt', content: 'ok' }]);
    assert.equal(await readFile(join(dir, 'sub/file.txt'), 'utf8'), 'ok');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
