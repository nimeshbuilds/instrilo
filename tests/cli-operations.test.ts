import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { atomicProjectWrite, hashText, readDocument, readTextDocument, setField } from '../src/project-ops.js';
import { withGenerationLock } from '../src/regeneration.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const tsx = join(repository, 'node_modules/tsx/dist/cli.mjs'), cli = join(repository, 'src/cli.ts');
type Result = { code: number | null; stdout: string; stderr: string };
async function run(args: string[], cwd = repository): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsx, cli, ...args], { cwd, env: process.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI operation timed out.')); }, 20_000);
    child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
function success(result: Result) { assert.equal(result.code, 0, result.stderr + '\n' + result.stdout); }
function json(result: Result): any { success(result); return JSON.parse(result.stdout); }
const data = (value: unknown) => ['--data', JSON.stringify(value)];
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-operations-')); t.after(() => rm(root, { recursive: true, force: true }));
  success(await run(['init', 'operations-agent', '--directory', root]));
  return { root, project: join(root, 'operations-agent') };
}

test('CLI plan --apply preserves an intervening configuration edit during a delayed builder call', { timeout: 30_000 }, async t => {
  const { project } = await fixture(t);
  let release!: () => void, received!: () => void, calls = 0;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { received = resolve; });
  const proposal = { description: 'Builder-proposed fixture description.', systemPrompt: 'Builder-proposed fixture instructions.', questions: [], rationale: 'An explicitly mocked local builder response.' };
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += String(chunk);
    assert.equal(req.url, '/v1/chat/completions'); assert.ok(JSON.parse(body).messages.length >= 2);
    calls++; received(); await delayed;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'local-builder-fixture', choices: [{ message: { role: 'assistant', content: JSON.stringify(proposal) }, finish_reason: 'stop' }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { release(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const port = (server.address() as { port: number }).port;
  json(await run(['connections', 'add', 'fixture-builder', project, ...data({ kind: 'gateway', model: 'local-fixture-only', baseUrl: `http://127.0.0.1:${port}/v1`, auth: { type: 'none' }, timeoutMs: 10_000 })]));
  json(await run(['connections', 'use', 'builder', 'fixture-builder', project]));
  const before = json(await run(['config', 'show', project]));
  const pending = run(['plan', project, '--apply']);
  t.after(async () => { release(); await pending; });
  let timer!: NodeJS.Timeout;
  try { await Promise.race([started, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Builder fixture received no request.')), 5_000); })]); }
  finally { clearTimeout(timer); }
  json(await run(['config', 'set', 'description', 'A concurrent editor owns this description.', project]));
  json(await run(['config', 'set', 'agent.limits.maxSteps', '9', project, '--json']));
  const manifest = join(project, 'agent-studio.yaml'), concurrentBytes = await readFile(manifest);
  release();
  const stale = await pending;
  assert.equal(stale.code, 1, stale.stdout + '\n' + stale.stderr); assert.match(stale.stderr, /changed|stale/i);
  assert.deepEqual(await readFile(manifest), concurrentBytes, 'Failed application must preserve all intervening config bytes.');
  const preserved = json(await run(['config', 'show', project]));
  assert.equal(preserved.description, 'A concurrent editor owns this description.'); assert.equal(preserved.agent.limits.maxSteps, 9); assert.equal(preserved.agent.systemPrompt, before.agent.systemPrompt);
  const current = await run(['plan', project, '--apply']); success(current);
  const applied = json(await run(['config', 'show', project]));
  assert.equal(applied.description, proposal.description); assert.equal(applied.agent.systemPrompt, proposal.systemPrompt); assert.equal(applied.agent.limits.maxSteps, 9);
  const validBytes = await readFile(manifest);
  proposal.systemPrompt = '';
  const malformed = await run(['plan', project, '--apply']);
  assert.equal(malformed.code, 1, 'A structurally valid builder response must still satisfy the final manifest constraints.');
  assert.deepEqual(await readFile(manifest), validBytes, 'An invalid builder proposal must not corrupt the last valid manifest.');
  assert.equal(calls, 3, 'Only the three explicitly mocked local builder calls ran.');
});

test('actual CLI config, independent connections and HTTP tool CRUD validate and retain backups', { timeout: 60_000 }, async t => {
  const { project } = await fixture(t);
  const initial = json(await run(['config', 'show', project, '--hash']));
  assert.match(initial.sha256, /^[a-f0-9]{64}$/);
  const fields = json(await run(['config', 'fields'])); assert.ok(fields.fields.some((f: any) => f.field === 'roles.builder'));
  assert.equal(json(await run(['config', 'get', 'roles.runtime'], project)), 'demo');
  json(await run(['config', 'set', 'agent.limits.maxSteps', '9', project, '--json', '--expected-sha', initial.sha256]));
  assert.equal(json(await run(['config', 'get', 'agent.limits.maxSteps', project])), 9);
  const stale = await run(['config', 'set', 'description', 'Stale edit', project, '--expected-sha', initial.sha256]); assert.equal(stale.code, 1); assert.match(stale.stderr, /changed/);
  const unknown = await run(['config', 'set', 'nonexistent', 'value', project]); assert.equal(unknown.code, 1);
  for (const path of ['__proto__.polluted', 'constructor.prototype.polluted', 'agent.__proto__.polluted']) {
    const rejected = await run(['config', 'set', path, 'true', project, '--json']); assert.equal(rejected.code, 1); assert.match(rejected.stderr, /prototype/i);
  }
  const beforeApply = json(await run(['config', 'show', project]));
  const malicious = JSON.parse(JSON.stringify(beforeApply)); Object.defineProperty(malicious, '__proto__', { value: { polluted: true }, enumerable: true });
  assert.equal((await run(['config', 'apply', project, ...data(malicious)])).code, 1);
  assert.equal(({} as any).polluted, undefined);
  json(await run(['config', 'apply', project, ...data({ ...beforeApply, description: 'A revised fixture description.' })]));
  assert.equal(json(await run(['config', 'get', 'description', project])), 'A revised fixture description.');
  assert.ok((await readdir(join(project, '.instrilo/backups'))).length >= 2);
  json(await run(['connections', 'add', 'judge-demo', project, ...data({ kind: 'demo', auth: { type: 'none' } })]));
  json(await run(['connections', 'use', 'judge', 'judge-demo', project]));
  assert.equal(json(await run(['connections', 'list', project])).roles.judge, 'judge-demo');
  assert.equal((await run(['connections', 'remove', 'judge-demo', project])).code, 1);
  json(await run(['connections', 'use', 'judge', 'demo', project])); json(await run(['connections', 'remove', 'judge-demo', project]));
  const tool = { name: 'lookup', description: 'Read a fixture item.', kind: 'http', url: 'http://127.0.0.1:19999/lookup', method: 'GET', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, requiredScopes: ['lookup:read'], requiresApproval: false };
  assert.equal((await run(['tools', 'add', project, ...data(tool)])).code, 1, 'Scoped tools require an authenticated caller boundary.');
  json(await run(['config', 'set', 'security.inbound', JSON.stringify({ mode: 'jwt', issuer: 'http://127.0.0.1:19999', audience: 'fixture-agent', jwksUrl: 'http://127.0.0.1:19999/jwks', algorithms: ['RS256'] }), project, '--json']));
  json(await run(['tools', 'add', project, ...data(tool)]));
  assert.equal(json(await run(['tools', 'list', project]))[0].name, tool.name);
  assert.equal((await run(['tools', 'add', project, ...data(tool)])).code, 1);
  json(await run(['tools', 'add', project, '--replace', ...data({ ...tool, description: 'Revised fixture lookup.' })]));
  json(await run(['tools', 'remove', tool.name, project])); assert.deepEqual(json(await run(['tools', 'list', project])), []);
  assert.equal((await run(['tools', 'add', project, ...data({ ...tool, url: 'file:///etc/passwd' })])).code, 1);
});

test('CLI case import/export/update keeps provenance, duplicate guards and JSON dataset format', { timeout: 45_000 }, async t => {
  const { root, project } = await fixture(t);
  const item = { id: 'case-one', input: 'Fixture task.', expected: 'Fixture answer.', contains: ['answer'], source: 'reviewed', split: 'holdout' };
  json(await run(['cases', 'import', project, '--replace', ...data([item])]));
  assert.equal(json(await run(['cases', 'list', project, '--split', 'holdout'])).length, 1);
  const duplicate = await run(['cases', 'add', project, ...data(item)]); assert.equal(duplicate.code, 1); assert.match(duplicate.stderr, /Duplicate/);
  json(await run(['cases', 'update', item.id, project, ...data({ ...item, expected: 'Revised expected answer.' })]));
  const output = join(root, 'cases.jsonl'); json(await run(['cases', 'export', project, '--output', output]));
  assert.equal(JSON.parse((await readFile(output, 'utf8')).trim()).expected, 'Revised expected answer.');
  assert.equal((await run(['cases', 'export', project, '--output', output])).code, 1);
  await writeFile(join(project, 'evals/alternate.json'), JSON.stringify([item]));
  json(await run(['config', 'set', 'evaluation.dataset', './evals/alternate.json', project]));
  json(await run(['cases', 'add', project, ...data({ ...item, id: 'case-two', split: 'development' })]));
  assert.equal(JSON.parse(await readFile(join(project, 'evals/alternate.json'), 'utf8')).length, 2, 'JSON source datasets remain JSON arrays after mutation.');
  json(await run(['cases', 'remove', 'case-two', project])); assert.equal(json(await run(['cases', 'list', project])).length, 1);
  assert.equal((await run(['cases', 'remove', item.id, project])).code, 1, 'The core requires at least one evaluation case.');
});

test('guidance edits enforce hashes, create-only semantics, bounded inputs and managed symlink ancestors', { timeout: 45_000 }, async t => {
  const { root, project } = await fixture(t);
  const initial = json(await run(['guidance', 'read', 'purpose.md', project]));
  assert.equal((await run(['guidance', 'write', 'purpose.md', project, '--text', 'Unreviewed overwrite'])).code, 1);
  json(await run(['guidance', 'write', 'purpose.md', project, '--replace', '--expected-sha', initial.sha256, '--text', '# Purpose\nA revised test purpose.']));
  const stale = await run(['guidance', 'write', 'purpose.md', project, '--replace', '--expected-sha', initial.sha256, '--text', '# Purpose\nStale revision.']); assert.equal(stale.code, 1);
  const source = join(root, 'operations.md'); await writeFile(source, '# Operations\nAsk for missing task inputs.');
  json(await run(['guidance', 'write', 'operations.md', project, '--file', source]));
  assert.equal(json(await run(['guidance', 'read', 'operations.md', project])).content, await readFile(source, 'utf8'));
  const appeared = join(project, 'guidance/appeared.md'); await writeFile(appeared, 'A concurrent editor created this after inspection.');
  await assert.rejects(atomicProjectWrite(project, 'guidance/appeared.md', 'Must not overwrite it.', null), /appeared/);
  assert.match(await readFile(appeared, 'utf8'), /concurrent editor/);
  await atomicProjectWrite(project, 'guidance/new.md', '# New\nCreated atomically.', null);
  await assert.rejects(atomicProjectWrite(project, 'guidance/new.md', 'Implicit overwrite.'), /appeared/);
  await assert.rejects(atomicProjectWrite(project, 'guidance/new.md', 'Wrong revision.', '0'.repeat(64)), /changed/);
  const outside = join(root, 'outside'); await mkdir(outside); await symlink(outside, join(project, 'guidance/linked'));
  const escaped = await run(['guidance', 'write', 'linked/nested.md', project, '--text', 'Must not escape.']); assert.equal(escaped.code, 1); assert.match(escaped.stderr, /Symbolic/);
  await assert.rejects(access(join(outside, 'nested.md')));
  const sourceLink = join(root, 'source-link.md'); await symlink(source, sourceLink);
  assert.equal((await run(['guidance', 'write', 'from-link.md', project, '--file', sourceLink])).code, 1);
  const large = join(root, 'large.md'); await writeFile(large, 'x'.repeat(256_001));
  const oversized = await run(['guidance', 'write', 'large.md', project, '--file', large]); assert.equal(oversized.code, 1); assert.match(oversized.stderr, /bounded|limit|KB/);
  await assert.rejects(access(join(project, 'guidance/large.md')));
});

test('bounded document readers reject malformed, cyclic and prototype-bearing data before mutation', async t => {
  const { root } = await fixture(t);
  const file = join(root, 'data.json'); await writeFile(file, '{"value":1}'); assert.deepEqual(await readDocument(file), { value: 1 });
  await assert.rejects(readDocument(file, 5), /bounded/);
  await writeFile(file, '{"__proto__":{"polluted":true}}'); await assert.rejects(readDocument(file), /Prototype/);
  await writeFile(file, '&self\nchild: *self\n'); await assert.rejects(readDocument(file), /Cyclic/);
  await writeFile(file, Buffer.from([0xc3, 0x28])); await assert.rejects(readTextDocument(file), /encoded|encoding/i);
  await assert.rejects(readTextDocument(root), /regular/);
  const inherited = Object.create({ secret: { value: 1 } }); assert.throws(() => setField(inherited, 'secret.value', 2), /Unknown/);
  assert.equal(inherited.secret.value, 1);
});

test('CLI ZIP export is complete, current and serialized; excludes private state and never overwrites', { timeout: 60_000 }, async t => {
  const { root, project } = await fixture(t); const generated = join(project, 'generated');
  const unbuilt = await run(['export', project, '--output', join(root, 'unbuilt.zip')]); assert.equal(unbuilt.code, 1); await assert.rejects(access(generated));
  json(await run(['config', 'set', 'delivery.hosts', '["codex","claude-code"]', project, '--json']));
  json(await run(['build', project]));
  await writeFile(join(generated, 'user-notes.md'), 'A user-owned note.');
  await writeFile(join(generated, '.env'), 'DO_NOT_EXPORT=fixture');
  await writeFile(join(generated, 'credentials.json'), '{"fixture":"DO_NOT_EXPORT"}');
  await mkdir(join(generated, 'nested/.instrilo'), { recursive: true }); await writeFile(join(generated, 'nested/.instrilo/private.json'), 'DO_NOT_EXPORT');
  await mkdir(join(project, '.instrilo/evidence'), { recursive: true }); await writeFile(join(project, '.instrilo/evidence/private.json'), 'DO_NOT_EXPORT');
  const destination = join(root, 'source.zip'); json(await run(['export', project, '--output', destination]));
  const archive = unzipSync(await readFile(destination)); const names = Object.keys(archive);
  for (const path of ['agent-studio.yaml', 'guidance/purpose.md', 'evals/cases.jsonl', 'agent.ts', 'user-notes.md', '.env.example', '.agents/skills/operations-agent/SKILL.md', '.claude/skills/operations-agent/SKILL.md']) assert.ok(names.includes('operations-agent/' + path), path);
  assert.ok(names.every(path => !path.includes('/.instrilo/') && !path.endsWith('/.env') && !path.endsWith('/credentials.json')));
  assert.ok(Object.values(archive).every(bytes => !Buffer.from(bytes).includes('DO_NOT_EXPORT')));
  assert.equal((await run(['export', project, '--output', destination])).code, 1);
  const locked = await withGenerationLock(generated, () => run(['export', project, '--output', join(root, 'locked.zip')])); assert.equal(locked.code, 1); assert.match(locked.stderr, /locked/);
  await writeFile(join(generated, '.instrilo/transaction.json'), '{}');
  const incomplete = await run(['export', project, '--output', join(root, 'incomplete.zip')]); assert.equal(incomplete.code, 1); assert.match(incomplete.stderr, /incomplete/);
  await rm(join(generated, '.instrilo/transaction.json'));
  const sourceConfig = await readFile(join(project, 'agent-studio.yaml'), 'utf8');
  json(await run(['config', 'set', 'description', 'A newer source description.', project]));
  const staleConfig = await run(['export', project, '--output', join(root, 'stale-config.zip')]); assert.equal(staleConfig.code, 1); assert.match(staleConfig.stderr, /Configuration changed/);
  await writeFile(join(project, 'agent-studio.yaml'), sourceConfig);
  const guidancePath = join(project, 'guidance/purpose.md'), guidance = await readFile(guidancePath, 'utf8'); await writeFile(guidancePath, guidance + '\nNew rule.\n');
  const staleGuidance = await run(['export', project, '--output', join(root, 'stale-guidance.zip')]); assert.equal(staleGuidance.code, 1); assert.match(staleGuidance.stderr, /Guidance changed/); await writeFile(guidancePath, guidance);
  const datasetPath = join(project, 'evals/cases.jsonl'), dataset = await readFile(datasetPath, 'utf8');
  json(await run(['cases', 'add', project, ...data({ id: 'new-case', input: 'A newer task.', source: 'synthetic', split: 'development' })]));
  const staleCases = await run(['export', project, '--output', join(root, 'stale-cases.zip')]); assert.equal(staleCases.code, 1); assert.match(staleCases.stderr, /Dataset changed/); await writeFile(datasetPath, dataset);
  const portable = join(generated, 'guidance/purpose.md'); await writeFile(portable, 'A tampered generated guidance source.');
  const tampered = await run(['export', project, '--output', join(root, 'tampered.zip')]); assert.equal(tampered.code, 1); assert.match(tampered.stderr, /portable guidance/);
});

test('complete CLI help has meaningful descriptions, nested paths, flags, JSON and searchable manuals', { timeout: 30_000 }, async () => {
  const reference = json(await run(['help', '--json'])) as any[];
  assert.ok(reference.length > 90);
  for (const item of reference) assert.ok(item.description && item.description.trim().length >= 15, item.command + ' has no useful description.');
  const all = await run(['help', '--all']); success(all); assert.match(all.stdout, /Usage: instrilo config set/); assert.match(all.stdout, /Usage: instrilo review queue/);
  const nested = await run(['help', 'connections', 'add']); success(nested); assert.match(nested.stdout, /--file/); assert.match(nested.stdout, /--replace/); assert.match(nested.stdout, /Guide: instrilo explain connections/);
  const topics = json(await run(['explain', '--list', '--json'])); assert.ok(topics.some((x: any) => x.topic === 'configuration')); assert.ok(topics.some((x: any) => x.topic === 'release'));
  const found = json(await run(['explain', '--search', 'immutable', '--json'])); assert.ok(found.length); assert.ok(found.every((x: any) => x.text && x.topic));
  const missing = await run(['help', 'config', 'does-not-exist']); assert.equal(missing.code, 1); assert.match(missing.stderr, /Unknown command path/);
  const noTarget = await run(['export']); assert.equal(noTarget.code, 1); assert.match(noTarget.stderr, /required option.*output/);
  const spec = json(await run(['config', 'template', '--language', 'python', '--name', 'example-agent'])); assert.equal(spec.language, 'python');
  assert.ok(reference.find(x => x.command === 'instrilo export').options.find((x: any) => x.flags === '--output <path>' && x.required));
});
