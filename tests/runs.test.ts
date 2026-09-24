import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, cp, mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { defaultSpec, loadSpec, readCases } from '../src/core.js';
import { createProject, buildProject, manifestName } from '../src/workbench.js';
import { evaluateProject, prepareProject } from '../src/execution.js';
import { startRecordedRun, resumeRecordedRun, replayRun, replayRunBundle, getRun, approveRun, denyRun, reconcileRun, recoverRunLock, runGraph, exportRunBundle, importRunBundle } from '../src/runs.js';
import type { Framework, Language } from '../src/types.js';

async function fixture(t: any, framework: Framework = 'native', language: Language = 'typescript') {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-runs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const counts = { model: 0, read: 0, write: 0 }; let ambiguous = false; let stopped = false; let modelFailure = false; let secretResult = false;
  const server = createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/chat/completions') {
      counts.model++; const body = JSON.parse(data);
      if (modelFailure) { res.statusCode = 503; res.end('{"error":"mock unavailable"}'); return; }
      const message = body.messages.some((m: any) => m.role === 'tool') ? { role: 'assistant', content: 'Verified write complete' } : { role: 'assistant', content: '', tool_calls: [
        { id: 'read-call', type: 'function', function: { name: 'lookup', arguments: '{"id":"42"}' } },
        { id: 'write-call', type: 'function', function: { name: 'update', arguments: '{"id":"42","value":"ready"}' } },
      ] };
      res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 2, completion_tokens: 3 } }));
    } else if (req.url?.startsWith('/read')) { counts.read++; res.end(secretResult ? '{"id":"42","password":"do-not-persist-this"}' : '{"id":"42","state":"pending"}'); }
    else if (req.url === '/write') { counts.write++; if (ambiguous) req.socket.destroy(); else res.end('{"ok":true}'); }
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = async () => { if (!stopped) { stopped = true; await new Promise<void>(resolve => server.close(() => resolve())); } };
  t.after(close);
  const address = server.address() as { port: number }; const base = `http://127.0.0.1:${address.port}`;
  let spec = defaultSpec('durable-test'); spec.language = language; spec.framework = framework;
  spec.connections.api = { kind: 'gateway', model: 'mock', baseUrl: base + '/v1', auth: { type: 'none' } };
  spec.roles.runtime = 'api'; spec.agent.limits.timeoutMs = 15000;
  spec.agent.tools = [
    { name: 'lookup', kind: 'http', description: 'Read a record', method: 'GET', url: base + '/read', requiresApproval: false, requiredScopes: [], inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
    { name: 'update', kind: 'http', description: 'Write a record', method: 'POST', url: base + '/write', requiresApproval: true, requiredScopes: [], inputSchema: { type: 'object', properties: { id: { type: 'string' }, value: { type: 'string' } }, required: ['id', 'value'], additionalProperties: false } },
  ];
  const project = await createProject(root, { name: spec.name, spec });
  spec = await loadSpec(join(project.dir, manifestName));
  const generated = join(project.dir, 'generated'); await buildProject(join(project.dir, manifestName)); await prepareProject(spec, generated);
  return { spec, generated, counts, close, ambiguous: () => { ambiguous = true; }, failModel: () => { modelFailure = true; }, secretResult: () => { secretResult = true; } };
}

for (const language of ['typescript', 'python'] as Language[]) for (const framework of ['native', 'langgraph'] as Framework[]) {
  test(`durable ${language}/${framework}: pause, restart, single claim and zero-network replay`, { timeout: 180000, skip: language === 'python' && !process.env.NB_AGENT_PYTHON }, async t => {
    const f = await fixture(t, framework, language); const identity = { caller: 'local:review-test', tenant: 'tenant-42', scopes: ['records:write'] };
    const first = await startRecordedRun(f.spec, f.generated, 'Inspect and update record 42', { recordContent: true, ...identity });
    assert.equal(first.status, 'paused', first.error); assert.deepEqual(f.counts, { model: 1, read: 1, write: 0 });
    assert.equal(first.events[2].status, 'pending'); assert.equal(first.events[2].name, 'update');
    assert.ok(first.events[0].request); assert.equal((await stat(join(dirname(f.generated), '.instrilo/runs', first.id + '.json'))).mode & 0o777, 0o600);
    await assert.rejects(() => resumeRecordedRun(f.spec, f.generated, first.id), /Caller, tenant/);
    await assert.rejects(() => approveRun(f.generated, first.id, { expectedDigest: '0'.repeat(64) }), /digest/);
    const approvals = await Promise.allSettled([0, 1].map(() => approveRun(f.generated, first.id, { expectedDigest: first.events[2].approvalDigest! })));
    assert.equal(approvals.filter(x => x.status === 'fulfilled').length, 1);
    const resumes = await Promise.allSettled([0, 1].map(() => resumeRecordedRun(f.spec, f.generated, first.id, identity)));
    assert.equal(resumes.filter(x => x.status === 'fulfilled').length, 1);
    const completed = await getRun(f.generated, first.id); assert.equal(completed.status, 'completed', completed.error); assert.equal(completed.output, 'Verified write complete');
    assert.equal(completed.events[2].approval?.decision, 'claimed'); assert.deepEqual(f.counts, { model: 2, read: 1, write: 1 });
    await assert.rejects(() => resumeRecordedRun(f.spec, f.generated, first.id, identity), /Only a paused/);
    await f.close();
    const replay = await replayRun(f.spec, f.generated, first.id, identity); assert.equal(replay.matched, true, replay.error); assert.equal(replay.modelCalls, 0); assert.equal(replay.toolCalls, 0); assert.equal(replay.eventsReplayed, 4);
    assert.deepEqual(f.counts, { model: 2, read: 1, write: 1 });
    const graph = runGraph(completed); assert.deepEqual(graph.nodes.map(n => n.kind), ['start', 'model', 'tool', 'tool', 'model', 'end']); assert.match(graph.mermaid, /update \(completed\)/);
    const portable = importRunBundle(await exportRunBundle(f.generated, first.id)); assert.equal(portable.executable, false); assert.equal(portable.bundle.contentIncluded, false); assert.equal(portable.bundle.run.events[0].request, undefined);
    const full = importRunBundle(await exportRunBundle(f.generated, first.id, { includeContent: true })); assert.equal(full.bundle.run.output, completed.output);
    await writeFile(join(f.generated, language === 'python' ? 'agent.py' : 'agent.ts'), '\n# changed\n', { flag: 'a' });
    await assert.rejects(() => replayRun(f.spec, f.generated, first.id, identity), /Build changed/);
  });
}

test('denied and expired approvals never dispatch their write', { timeout: 180000 }, async t => {
  const f = await fixture(t);
  const denied = await startRecordedRun(f.spec, f.generated, 'deny this write', { recordContent: true });
  await denyRun(f.generated, denied.id, { expectedDigest: denied.events[2].approvalDigest! });
  await assert.rejects(() => resumeRecordedRun(f.spec, f.generated, denied.id), /Only a paused/);
  const expired = await startRecordedRun(f.spec, f.generated, 'expire this write', { recordContent: true });
  await approveRun(f.generated, expired.id, { expectedDigest: expired.events[2].approvalDigest!, expiresInMs: 1 });
  await new Promise(r => setTimeout(r, 10));
  const resumed = await resumeRecordedRun(f.spec, f.generated, expired.id); assert.equal(resumed.status, 'failed'); assert.match(resumed.error!, /expired/); assert.equal(f.counts.write, 0);
});

test('ambiguous side effect requires explicit observed-result reconciliation and is never repeated', { timeout: 180000 }, async t => {
  const f = await fixture(t); f.ambiguous();
  const first = await startRecordedRun(f.spec, f.generated, 'perform write', { recordContent: true });
  await approveRun(f.generated, first.id, { expectedDigest: first.events[2].approvalDigest! });
  const uncertain = await resumeRecordedRun(f.spec, f.generated, first.id); assert.equal(uncertain.status, 'needs_reconciliation'); assert.equal(f.counts.write, 1);
  await assert.rejects(() => resumeRecordedRun(f.spec, f.generated, first.id), /reconcile/);
  await reconcileRun(f.generated, first.id, { expectedDigest: uncertain.events[2].approvalDigest!, response: { ok: true }, note: 'Operator checked destination record and confirmed value ready.' });
  const done = await resumeRecordedRun(f.spec, f.generated, first.id); assert.equal(done.status, 'completed', done.error); assert.equal(f.counts.write, 1); assert.equal(f.counts.read, 1);
});

test('recording requires opt-in, rejects SDK frameworks and protects exact arguments', { timeout: 180000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(() => startRecordedRun(f.spec, f.generated, 'test', {} as any), /explicit/);
  await assert.rejects(() => startRecordedRun({ ...f.spec, framework: 'openai-agents' }, f.generated, 'test', { recordContent: true }), /native and LangGraph/);
  const run = await startRecordedRun(f.spec, f.generated, 'test', { recordContent: true });
  const path = join(dirname(f.generated), '.instrilo/runs', run.id + '.json'); const edited = JSON.parse(await readFile(path, 'utf8'));
  edited.events[0].response.message.tool_calls[1].function.arguments = '{"id":"43","value":"ready"}'; await writeFile(path, JSON.stringify(edited));
  await approveRun(f.generated, run.id, { expectedDigest: run.events[2].approvalDigest! });
  const result = await resumeRecordedRun(f.spec, f.generated, run.id); assert.equal(result.status, 'failed'); assert.match(result.error!, /arguments changed/); assert.equal(f.counts.write, 0);
  assert.throws(() => importRunBundle(' '.repeat(17 * 1024 * 1024)), /16 MiB/);
  assert.throws(() => importRunBundle('{"schemaVersion":"1","script":"rm -rf /"}'), /./);
});

test('error events replay offline and missing fixtures cannot silently run a provider', { timeout: 180000 }, async t => {
  const f = await fixture(t); f.failModel();
  const run = await startRecordedRun(f.spec, f.generated, 'model failure', { recordContent: true });
  assert.equal(run.status, 'failed'); assert.equal(run.events[0].status, 'error'); assert.match(run.events[0].error!, /503/);
  await f.close(); const replay = await replayRun(f.spec, f.generated, run.id); assert.equal(replay.matched, true, replay.error); assert.equal(f.counts.model, 1);
  const path = join(dirname(f.generated), '.instrilo/runs', run.id + '.json'); const edited = JSON.parse(await readFile(path, 'utf8')); edited.events = []; await writeFile(path, JSON.stringify(edited));
  const absent = await replayRun(f.spec, f.generated, run.id); assert.equal(absent.matched, false); assert.match(absent.error!, /no recorded fixture/); assert.equal(f.counts.model, 1);
});

test('recognizable secrets are scrubbed; altered recordings become inspect-only', { timeout: 180000 }, async t => {
  const f = await fixture(t); f.secretResult();
  await assert.rejects(() => startRecordedRun(f.spec, f.generated, 'sk-abcdefghijklmnopqrstuvwxyz1234567890', { recordContent: true }), /credentials/);
  const run = await startRecordedRun(f.spec, f.generated, 'inspect secret response', { recordContent: true });
  assert.equal(run.status, 'failed'); assert.equal(run.replayable, false); assert.equal((run.events[1].response as any).password, '[redacted]');
  const stored = await readFile(join(dirname(f.generated), '.instrilo/runs', run.id + '.json'), 'utf8'); assert.ok(!stored.includes('do-not-persist-this'));
  const exported = await exportRunBundle(f.generated, run.id, { includeContent: true }); assert.ok(!exported.includes('do-not-persist-this')); assert.equal(importRunBundle(exported).executable, false);
  await assert.rejects(() => resumeRecordedRun(f.spec, f.generated, run.id), /redacted/);
});

test('real evaluation fingerprints guidance and rejects edits during execution', { timeout: 180000 }, async t => {
  const f = await fixture(t); const project = dirname(f.generated); const cases = await readCases(join(project, f.spec.evaluation.dataset));
  const report = await evaluateProject(f.spec, f.generated, cases); assert.match(report.guidanceHash!, /^[a-f0-9]{64}$/);
  await assert.rejects(() => evaluateProject(f.spec, f.generated, cases, { onProgress(done) {
    if (done === 1) writeFileSync(join(project, 'guidance/purpose.md'), '# Changed while evaluating\n');
  } }), /changed during evaluation/);
});

test('portable bundles replay offline against a separate trusted matching project through API and CLI', { timeout: 180000 }, async t => {
  const f = await fixture(t);
  // Both ordinary custom source and an imported build-output helper must enter the fingerprint.
  await writeFile(join(f.generated, 'unowned-helper.ts'), 'export const customValue = 1;\n');
  await mkdir(join(f.generated, 'dist')); await writeFile(join(f.generated, 'dist/helper.js'), 'export const importedCustomValue = 1;\n');
  await writeFile(join(f.generated, 'agent.ts'), "\nimport './dist/helper.js';\n", { flag: 'a' });
  const first = await startRecordedRun(f.spec, f.generated, 'Portable bundle fixture', { recordContent: true, caller: 'local:portable-fixture', tenant: 'portable-tenant', scopes: ['records:write'] });
  assert.equal(first.status, 'paused', first.error);
  await approveRun(f.generated, first.id, { expectedDigest: first.events[2].approvalDigest! });
  const complete = await resumeRecordedRun(f.spec, f.generated, first.id, { caller: first.caller, tenant: first.tenant, scopes: first.scopes });
  assert.equal(complete.status, 'completed', complete.error);
  const full = await exportRunBundle(f.generated, first.id, { includeContent: true }), metadataOnly = await exportRunBundle(f.generated, first.id);
  await f.close();
  const counts = { ...f.counts };

  const cloneRoot = await mkdtemp(join(tmpdir(), 'instrilo-portable-target-')); t.after(() => rm(cloneRoot, { recursive: true, force: true }));
  const clone = await createProject(cloneRoot, { name: f.spec.name, spec: structuredClone(f.spec) });
  const generated = join(clone.dir, 'generated'); await buildProject(join(clone.dir, manifestName));
  // Reuse the already-installed trusted dependencies; no source or run history comes from the bundle.
  for (const path of ['node_modules', 'package-lock.json', 'agent.ts', 'unowned-helper.ts', 'dist']) await cp(join(f.generated, path), join(generated, path), { recursive: true });
  const spec = await loadSpec(join(clone.dir, manifestName));
  await assert.rejects(access(join(clone.dir, '.instrilo/runs')), { code: 'ENOENT' });
  assert.equal(importRunBundle(full).executable, false);
  await assert.rejects(replayRunBundle(spec, generated, full, { executeLocal: false }), /execute-local/);
  await assert.rejects(replayRunBundle(spec, generated, metadataOnly, { executeLocal: true }), /inspect-only|complete recorded content/);
  const portable = await replayRunBundle(spec, generated, full, { executeLocal: true });
  assert.equal(portable.matched, true, portable.error); assert.equal(portable.output, complete.output); assert.equal(portable.eventsReplayed, 4); assert.equal(portable.modelCalls, 0); assert.equal(portable.toolCalls, 0);
  await assert.rejects(access(join(clone.dir, '.instrilo/runs')), { code: 'ENOENT' });

  const bundlePath = join(cloneRoot, 'portable.json'), metadataPath = join(cloneRoot, 'metadata.json');
  await writeFile(bundlePath, full); await writeFile(metadataPath, metadataOnly);
  const execute = promisify(execFile), cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  async function cli(args: string[]) {
    try { const result = await execute(process.execPath, ['--import', 'tsx', cliPath, ...args], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }); return { code: 0, ...result }; }
    catch (error: any) { return { code: error.code, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }; }
  }
  const inspect = await cli(['runs', 'inspect-bundle', bundlePath]); assert.equal(inspect.code, 0, inspect.stderr); assert.equal(JSON.parse(inspect.stdout).executable, false);
  const consent = await cli(['runs', 'replay-bundle', bundlePath, clone.dir]); assert.equal(consent.code, 1); assert.match(consent.stderr, /execute-local/);
  const missingContent = await cli(['runs', 'replay-bundle', metadataPath, clone.dir, '--execute-local']); assert.equal(missingContent.code, 1); assert.match(missingContent.stderr, /inspect-only|complete recorded content/);
  const replay = await cli(['runs', 'replay-bundle', bundlePath, clone.dir, '--execute-local']); assert.equal(replay.code, 0, replay.stderr); assert.equal(JSON.parse(replay.stdout).matched, true); assert.equal(JSON.parse(replay.stdout).modelCalls, 0);
  await assert.rejects(access(join(clone.dir, '.instrilo/runs')), { code: 'ENOENT' });

  for (const path of ['unowned-helper.ts', 'dist/helper.js']) {
    const original = await readFile(join(generated, path), 'utf8'); await writeFile(join(generated, path), original.replace('= 1', '= 2'));
    await assert.rejects(replayRunBundle(spec, generated, full, { executeLocal: true }), /does not match/);
    const rejected = await cli(['runs', 'replay-bundle', bundlePath, clone.dir, '--execute-local']); assert.equal(rejected.code, 1); assert.match(rejected.stderr, /does not match/);
    await writeFile(join(generated, path), original);
  }
  const altered = JSON.parse(full); altered.run.events[0].request.password = 'portable-private-fixture';
  const scrubbed = importRunBundle(JSON.stringify(altered)); assert.equal(scrubbed.bundle.run.replayable, false); assert.ok(!JSON.stringify(scrubbed).includes('portable-private-fixture'));
  await assert.rejects(replayRunBundle(spec, generated, JSON.stringify(altered), { executeLocal: true }), /inspect-only|redacted/);
  const incomplete = JSON.parse(full); incomplete.run.events[2].status = 'pending';
  await assert.rejects(replayRunBundle(spec, generated, JSON.stringify(incomplete), { executeLocal: true }), /incomplete/);
  const missingFixture = JSON.parse(full); missingFixture.run.events = [];
  const noFallback = await replayRunBundle(spec, generated, JSON.stringify(missingFixture), { executeLocal: true }); assert.equal(noFallback.matched, false); assert.match(noFallback.error!, /no recorded fixture/);
  assert.deepEqual(f.counts, counts, 'The original provider and tool server stayed offline throughout every replay.');
});

test('run lock recovery refuses a live coordinator and serializes recovery of a dead coordinator', async t => {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-run-recovery-')); t.after(() => rm(root, { recursive: true, force: true }));
  const generated = join(root, 'generated'), id = '12345678-1234-4123-8123-123456789abc';
  const store = join(root, '.instrilo/runs'); await mkdir(store, { recursive: true });
  const path = join(store, id + '.json.lock');
  const active = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }); await writeFile(path, active);
  await assert.rejects(recoverRunLock(generated, id), /still alive/); assert.equal(await readFile(path, 'utf8'), active);
  await assert.rejects(access(path + '.recovery'), { code: 'ENOENT' });
  await writeFile(path, JSON.stringify({ pid: 2147483647, createdAt: new Date().toISOString() }));
  const recoveries = await Promise.allSettled([recoverRunLock(generated, id), recoverRunLock(generated, id)]);
  assert.equal(recoveries.filter(result => result.status === 'fulfilled').length, 1);
  await assert.rejects(access(path), { code: 'ENOENT' }); await assert.rejects(access(path + '.recovery'), { code: 'ENOENT' });
});
