import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync } from 'fflate';
import { startServer } from '../src/server.js';
import { captureEvidenceSnapshot, evidenceHash, reportCompatibleHash } from '../src/evidence.js';
import type { EvalCase, EvalReport } from '../src/types.js';

type Studio = Awaited<ReturnType<typeof startServer>>;
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-server-quality-'));
  const app = await startServer({ workspace: join(root, 'projects'), port: 0 });
  t.after(async () => { app.server.closeAllConnections(); await new Promise<void>((resolve, reject) => app.server.close(error => error ? reject(error) : resolve())); await rm(root, { recursive: true, force: true }); });
  return { root, app };
}
async function request(app: Studio, path: string, options: { method?: string; body?: unknown; token?: string | null; origin?: string; host?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.token !== null) headers['x-studio-token'] = options.token ?? app.token;
  if (options.origin) headers.origin = options.origin;
  if (options.host) headers.host = options.host;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return new Promise<{ status: number; json: any; text: string; bytes: Buffer }>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: app.port, path, method: options.method ?? 'GET', headers }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => { const bytes = Buffer.concat(chunks), text = bytes.toString(); let json: any; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode!, json, text, bytes }); });
    });
    req.on('error', reject); req.setTimeout(10_000, () => req.destroy(new Error('HTTP request timed out')));
    req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}
async function create(app: Studio, name = 'quality-agent') {
  const created = await request(app, '/api/projects', { method: 'POST', body: { name, language: 'typescript' } });
  assert.equal(created.status, 201, created.text);
  return { name, base: '/api/projects/' + name, dir: join(app.workspace, name) };
}
async function tree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(path = '') {
    let entries; try { entries = await readdir(join(root, path), { withFileTypes: true }); } catch (error: any) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = path ? path + '/' + entry.name : entry.name;
      if (entry.isDirectory()) { result[relative + '/'] = 'directory'; await visit(relative); }
      else if (entry.isSymbolicLink()) result[relative] = 'symlink';
      else result[relative] = createHash('sha256').update(await readFile(join(root, relative))).digest('hex');
    }
  }
  await visit(); return result;
}
async function job(app: Studio, id: string) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) { const result = await request(app, '/api/jobs/' + id); assert.equal(result.status, 200, result.text); if (!['running', 'cancelling'].includes(result.json.status)) return result.json; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Server job did not complete');
}
const requirement = { id: 'REQ-GROUNDING', text: 'Draft a grounded answer.', sourcePath: 'purpose.md', reviewer: 'owner', reason: 'Checked the fixture brief.' };

test('quality endpoints authenticate before writes; GET and unsupported verbs do not mutate projects', async t => {
  const { app } = await fixture(t); const f = await create(app); const before = await tree(f.dir);
  for (const [suffix, method] of [['quality/requirements', 'POST'], ['quality/policy', 'PUT'], ['quality/evidence/register', 'POST'], ['quality/review/label', 'POST'], ['generation/plan', 'POST'], ['runs', 'GET']]) {
    for (const credentials of [{ token: null }, { token: 'wrong-token' }, { origin: 'https://hostile.example' }]) {
      const response = await request(app, f.base + '/' + suffix, { method, body: method === 'GET' ? undefined : requirement, ...credentials });
      assert.equal(response.status, 401, response.text);
    }
  }
  assert.equal((await request(app, f.base + '/quality', { host: 'hostile.example' })).status, 403);
  for (const suffix of ['quality', 'quality/review/export', 'generation/inspect', 'generation/dependencies', 'runs']) {
    const response = await request(app, f.base + '/' + suffix); assert.equal(response.status, 200, response.text);
  }
  for (const [suffix, method] of [['quality/requirements', 'GET'], ['quality/policy', 'POST'], ['quality/release', 'GET'], ['quality/review/label', 'GET'], ['generation/plan', 'GET'], ['generation/inspect', 'DELETE'], ['runs', 'POST'], ['quality', 'PATCH'], ['quality/unknown', 'POST']]) {
    const response = await request(app, f.base + '/' + suffix, { method, body: ['POST', 'PATCH'].includes(method) ? {} : undefined });
    assert.equal(response.status, 404, response.text);
  }
  assert.deepEqual(await tree(f.dir), before, 'Rejected requests and read-only endpoints must not create state directories or evidence.');
});

test('requirements, registered evidence, blind review, policies and release decisions work through authenticated HTTP', async t => {
  const { app } = await fixture(t); const f = await create(app);
  const detail = await request(app, f.base); const spec = detail.json.spec;
  spec.connections.fixture = { kind: 'gateway', model: 'fixture-only-no-inference', baseUrl: 'http://127.0.0.1:19999/v1', auth: { type: 'none' } };
  spec.roles = { builder: 'fixture', runtime: 'fixture', judge: 'fixture' };
  assert.equal((await request(app, f.base + '/spec', { method: 'PUT', body: { spec } })).status, 200);
  const cases: EvalCase[] = [{ id: 'grounded-answer', input: 'Draft an answer.', expected: 'A grounded answer.', contains: ['grounded'], source: 'reviewed', split: 'holdout' }];
  assert.equal((await request(app, f.base + '/cases', { method: 'PUT', body: { cases } })).status, 200);
  const added = await request(app, f.base + '/quality/requirements', { method: 'POST', body: requirement });
  assert.equal(added.status, 200, added.text); assert.equal(added.json.review.state, 'reviewed');
  const updated = await request(app, f.base + '/quality/requirements/update', { method: 'POST', body: { id: requirement.id, patch: { title: 'Ground every answer', reviewer: 'owner', reason: 'Reviewed a clearer title.' }, expectedRevision: 1 } });
  assert.equal(updated.status, 200, updated.text); assert.equal(updated.json.revision, 2);
  assert.equal((await request(app, f.base + '/quality/requirements/update', { method: 'POST', body: { id: requirement.id, patch: { text: 'Stale editor' }, expectedRevision: 1 } })).status, 400);
  const link = { caseId: cases[0].id, kind: 'deterministic', reviewer: 'owner', reason: 'The required text check covers this fixture.' };
  assert.equal((await request(app, f.base + '/quality/requirements/link', { method: 'POST', body: { id: requirement.id, link } })).status, 200);
  assert.equal((await request(app, f.base + '/quality')).json.evidence.requirements[0].status, 'ready');
  // This is a local report fixture, not a model or provider inference.
  const report: EvalReport = { id: randomUUID(), createdAt: new Date().toISOString(), project: f.name, mode: 'live', split: 'holdout', total: 1, passed: 1, passRate: 1, reviewed: 1, synthetic: 0,
    results: [{ id: cases[0].id, caseHash: reportCompatibleHash(cases[0]), input: cases[0].input, output: 'A grounded answer.', passed: true, checks: [{ name: 'Contains expected text', passed: true, detail: 'grounded' }, { name: 'Judge rubric', passed: true, detail: 'HIDDEN-JUDGE-FIXTURE' }], judge: { score: .95, rationale: 'HIDDEN-JUDGE-FIXTURE' }, durationMs: 1 }], ...await captureEvidenceSnapshot(f.dir), warnings: [] };
  await mkdir(join(f.dir, 'reports')); await writeFile(join(f.dir, 'reports/importable.json'), JSON.stringify(report));
  const unregistered = await tree(f.dir);
  for (const route of ['queue', 'calibrate']) for (const selected of [report.id, 'reports/importable.json', '../other-agent/reports/importable.json']) {
    const response = await request(app, f.base + '/quality/review/' + route + '?report=' + encodeURIComponent(selected)); assert.equal(response.status, 400, response.text);
  }
  assert.deepEqual(await tree(f.dir), unregistered, 'GET review cannot implicitly import a saved report.');
  const registered = await request(app, f.base + '/quality/evidence/register', { method: 'POST', body: report });
  assert.equal(registered.status, 200, registered.text); assert.equal(registered.json.report.id, report.id);
  const beforeRead = await tree(f.dir);
  const queue = await request(app, f.base + '/quality/review/queue?report=' + report.id);
  assert.equal(queue.status, 200, queue.text); assert.equal(queue.json.blind, true); assert.equal(queue.json.current, true); assert.ok(!queue.text.includes('HIDDEN-JUDGE-FIXTURE'));
  const visible = await request(app, f.base + '/quality/review/queue?report=' + report.id + '&unblind=true'); assert.equal(visible.json.cases[0].automated.judge.score, .95);
  assert.equal((await request(app, f.base + '/quality/review/calibrate?report=' + report.id)).status, 200);
  assert.deepEqual(await tree(f.dir), beforeRead);
  const wrong = { ...queue.json.cases[0].binding, outputHash: 'f'.repeat(64) };
  const label = { reportId: report.id, caseId: cases[0].id, verdict: 'pass', reviewer: 'human-reviewer', reason: 'Reviewed the fixture output.', binding: queue.json.cases[0].binding };
  assert.equal((await request(app, f.base + '/quality/review/label', { method: 'POST', body: { ...label, binding: wrong } })).status, 400);
  assert.equal((await request(app, f.base + '/quality/review/label', { method: 'POST', body: label })).status, 200);
  assert.equal((await request(app, f.base + '/quality/review/export')).json.labels.length, 1);
  const policy = { schemaVersion: '1', requireHumanReview: true, minHumanReviews: 2 };
  assert.equal((await request(app, f.base + '/quality/policy', { method: 'PUT', body: policy })).status, 200);
  const blocked = await request(app, f.base + '/quality/release', { method: 'POST', body: { report: report.id } });
  assert.equal(blocked.status, 200, blocked.text); assert.equal(blocked.json.allowed, false); assert.ok(blocked.json.issues.some((issue: any) => issue.code === 'HUMAN_REVIEW_REQUIRED'));
  assert.equal((await request(app, f.base + '/quality/policy', { method: 'PUT', body: { ...policy, minHumanReviews: 1 } })).status, 200);
  const allowed = await request(app, f.base + '/quality/release', { method: 'POST', body: { report: report.id } });
  assert.equal(allowed.status, 200, allowed.text); assert.equal(allowed.json.allowed, true); assert.equal(allowed.json.classification, 'release-evidence');
  assert.equal((await request(app, f.base + '/quality/review/calibrate?report=' + report.id)).json.sampleCount, 1);
  assert.equal((await request(app, f.base + '/quality/requirements/unlink', { method: 'POST', body: { id: requirement.id, link: { caseId: cases[0].id, reviewer: 'owner', reason: 'Coverage withdrawn deliberately.' } } })).status, 200);
  assert.equal((await request(app, f.base + '/quality/requirements/waive', { method: 'POST', body: { id: requirement.id, waiver: { reviewer: 'owner', reason: 'Manual review exception.' } } })).status, 200);
  const waived = await request(app, f.base + '/quality/release', { method: 'POST', body: { report: report.id } }); assert.equal(waived.json.allowed, false); assert.ok(waived.json.issues.some((issue: any) => issue.code === 'WAIVER_DISALLOWED'));
});

test('generation previews create nothing, show collisions and preserve customized runtime files', async t => {
  const { app } = await fixture(t); const f = await create(app); const initial = await tree(f.dir);
  const first = await request(app, f.base + '/generation/plan', { method: 'POST', body: {} });
  assert.equal(first.status, 200, first.text); assert.equal(first.json.conflicts.length, 0); assert.ok(first.json.changes.some((item: any) => item.action === 'add'));
  assert.deepEqual(await tree(f.dir), initial);
  await mkdir(join(f.dir, 'generated')); await writeFile(join(f.dir, 'generated/agent.ts'), '// unowned custom file\n');
  const beforeCollision = await tree(f.dir);
  const collision = await request(app, f.base + '/generation/plan', { method: 'POST', body: { merge: true } });
  assert.equal(collision.status, 200, collision.text); assert.ok(collision.json.conflicts.includes('agent.ts')); assert.deepEqual(await tree(f.dir), beforeCollision);
  await rm(join(f.dir, 'generated/agent.ts'));
  const build = await request(app, f.base + '/build', { method: 'POST', body: {} }); assert.equal(build.status, 202, build.text); assert.equal((await job(app, build.json.jobId)).status, 'completed');
  await writeFile(join(f.dir, 'generated/agent.ts'), '\n// preserved user customization\n', { flag: 'a' });
  const beforePreview = await tree(f.dir);
  const preview = await request(app, f.base + '/generation/plan', { method: 'POST', body: { merge: true } });
  assert.equal(preview.status, 200, preview.text); assert.equal(preview.json.changes.find((item: any) => item.path === 'agent.ts').action, 'preserve');
  assert.deepEqual(await tree(f.dir), beforePreview);
  assert.equal((await request(app, f.base + '/generation/inspect')).json.drift[0].path, 'agent.ts');
  await writeFile(join(f.dir, 'generated/.instrilo/transaction.json'), JSON.stringify({ schemaVersion: '1', id: 'pending-fixture', phase: 'prepared', operations: [] }));
  const interrupted = await tree(f.dir);
  assert.equal((await request(app, f.base + '/generation/plan', { method: 'POST', body: {} })).status, 400);
  assert.deepEqual(await tree(f.dir), interrupted);
});

test('run inspection and exact approvals stay inside the selected project and safe exports omit content', async t => {
  const { app } = await fixture(t); const own = await create(app, 'run-owner'); const other = await create(app, 'run-other');
  const id = randomUUID(), buildHash = '1'.repeat(64), requestHash = '2'.repeat(64), caller = 'local:fixture', tenant = 'fixture-tenant', scopes = ['draft:write'];
  const approvalDigest = evidenceHash({ runId: id, buildHash, seq: 0, requestHash, caller, tenant, scopes });
  const run = { schemaVersion: '1', id, project: own.name, framework: 'native', language: 'typescript', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'paused', recordContent: true, buildHash, caller, tenant, scopes, input: 'PRIVATE-RUN-INPUT', events: [{ seq: 0, kind: 'tool', requestHash, request: { value: 'PRIVATE-TOOL-INPUT' }, status: 'pending', name: 'create_draft', approvalDigest }], replayable: true, replayCount: 0 };
  await mkdir(join(own.dir, '.instrilo/runs'), { recursive: true }); const path = join(own.dir, '.instrilo/runs', id + '.json'); await writeFile(path, JSON.stringify(run));
  const original = await readFile(path, 'utf8');
  const listed = await request(app, own.base + '/runs'); assert.equal(listed.status, 200); assert.equal(listed.json.length, 1); assert.ok(!listed.text.includes('PRIVATE-'));
  const detail = await request(app, own.base + '/runs/' + id); assert.equal(detail.status, 200, detail.text); assert.equal(detail.json.graph.nodes[1].label, 'tool: create_draft (pending)');
  assert.equal((await request(app, other.base + '/runs/' + id)).status, 404);
  assert.equal((await request(app, other.base + '/runs/' + id + '/approve', { method: 'POST', body: { expectedDigest: approvalDigest } })).status, 404);
  assert.equal((await request(app, own.base + '/runs/..%2F..%2Frun-other/approve', { method: 'POST', body: { expectedDigest: approvalDigest } })).status, 404);
  assert.equal((await request(app, own.base + '/runs/' + id + '/approve')).status, 404);
  assert.equal((await request(app, own.base + '/runs/' + id + '/approve', { method: 'POST', token: null, body: { expectedDigest: approvalDigest } })).status, 401);
  assert.equal((await request(app, own.base + '/runs/' + id + '/approve', { method: 'POST', body: { expectedDigest: '0'.repeat(64) } })).status, 400);
  assert.equal(await readFile(path, 'utf8'), original);
  const safe = await request(app, own.base + '/runs/' + id + '/export'); assert.equal(safe.status, 200, safe.text); assert.equal(safe.json.contentIncluded, false); assert.ok(!safe.text.includes('PRIVATE-'));
  const full = await request(app, own.base + '/runs/' + id + '/export?includeContent=true'); assert.equal(full.json.contentIncluded, true); assert.equal(full.json.run.input, run.input);
  const approved = await request(app, own.base + '/runs/' + id + '/approve', { method: 'POST', body: { expectedDigest: approvalDigest } });
  assert.equal(approved.status, 200, approved.text); assert.equal(approved.json.events[0].approval.decision, 'approved');
  assert.equal((await request(app, own.base + '/runs/' + id + '/approve', { method: 'POST', body: { expectedDigest: approvalDigest } })).status, 400);
  await rm(join(other.dir, '.instrilo/runs'), { recursive: true }); await symlink(join(own.dir, '.instrilo/runs'), join(other.dir, '.instrilo/runs'));
  assert.equal((await request(app, other.base + '/runs/' + id)).status, 400);
  assert.equal((await request(app, other.base + '/runs/' + id + '/approve', { method: 'POST', body: { expectedDigest: approvalDigest } })).status, 400);
  const deniedRecording = await request(app, own.base + '/record', { method: 'POST', body: { input: 'No consent' } }); assert.equal(deniedRecording.status, 202);
  const rejectedJob = await job(app, deniedRecording.json.jobId); assert.equal(rejectedJob.status, 'failed'); assert.match(rejectedJob.error, /explicit consent/);
  assert.equal((await readdir(join(own.dir, '.instrilo/runs'))).filter(name => name.endsWith('.json')).length, 1);
});

test('shared download rejects stale mirrors and write locks while excluding private generation and evidence history', async t => {
  const { app } = await fixture(t); const f = await create(app); const before = await tree(f.dir);
  assert.equal((await request(app, f.base + '/download')).status, 404);
  assert.deepEqual(await tree(f.dir), before, 'An unbuilt download must not initialize generation state.');
  const started = await request(app, f.base + '/build', { method: 'POST', body: {} });
  assert.equal((await job(app, started.json.jobId)).status, 'completed');
  assert.equal((await request(app, f.base + '/quality/requirements', { method: 'POST', body: requirement })).status, 200);
  await writeFile(join(f.dir, 'generated/my-helper.ts'), 'export const custom = true;\n');
  const download = await request(app, f.base + '/download'); assert.equal(download.status, 200, download.text);
  const archive = unzipSync(download.bytes);
  assert.ok(archive[f.name + '/agent.ts']); assert.ok(archive[f.name + '/my-helper.ts']);
  assert.ok(Object.keys(archive).every(path => !path.includes('/.instrilo/')));
  for (const path of ['generated/agent-spec.json', 'generated/guidance.md', 'generated/agent-studio.yaml', 'guidance/purpose.md', 'evals/cases.jsonl']) {
    const original = await readFile(join(f.dir, path), 'utf8');
    const changed = path.endsWith('agent-spec.json') ? original.replace('"name": "quality-agent"', '"name": "changed-agent"')
      : path.endsWith('agent-studio.yaml') ? original.replace('name: quality-agent', 'name: changed-agent')
      : path.endsWith('cases.jsonl') ? original.trim().split('\n').map(line => JSON.stringify({ ...JSON.parse(line), input: 'New reviewed input after generation.' })).join('\n') + '\n'
      : original + '\nStale edit after generation.\n';
    assert.notEqual(changed, original, 'Fixture must change ' + path); await writeFile(join(f.dir, path), changed);
    const rejected = await request(app, f.base + '/download'); assert.equal(rejected.status, 400, path + ': ' + rejected.text);
    await writeFile(join(f.dir, path), original);
  }
  const lock = join(f.dir, 'generated/.instrilo/write.lock'); await writeFile(lock, '{}');
  assert.equal((await request(app, f.base + '/download')).status, 400); await rm(lock);
  assert.equal((await request(app, f.base + '/download')).status, 200);
});

test('a live local mock job permits inspection but rejects concurrent quality, run and generation mutations', { timeout: 30_000 }, async t => {
  const { app } = await fixture(t); const f = await create(app);
  let reached!: () => void, release!: () => void;
  const reachedRequest = new Promise<void>(resolve => { reached = resolve; }); const released = new Promise<void>(resolve => { release = resolve; });
  const mock = http.createServer(async (req, res) => { for await (const _chunk of req) {} reached(); await released; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ description: 'Fixture response', systemPrompt: 'Fixture instructions', questions: [], rationale: 'Local mock only' }) } }] })); });
  await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve));
  t.after(async () => { release(); mock.closeAllConnections(); await new Promise<void>(resolve => mock.close(() => resolve())); });
  const spec = (await request(app, f.base)).json.spec;
  spec.connections.fixture = { kind: 'gateway', model: 'local-mock-only', baseUrl: `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`, auth: { type: 'none' } }; spec.roles.builder = 'fixture';
  assert.equal((await request(app, f.base + '/spec', { method: 'PUT', body: { spec } })).status, 200);
  const before = await tree(f.dir);
  const started = await request(app, f.base + '/refine', { method: 'POST', body: {} }); assert.equal(started.status, 202, started.text);
  await reachedRequest;
  try {
    for (const [route, method, body] of [['quality/requirements', 'POST', requirement], ['quality/policy', 'PUT', { schemaVersion: '1' }], ['quality/release', 'POST', {}], ['quality/evidence/register', 'POST', {}], ['quality/review/label', 'POST', {}], ['generation/plan', 'POST', {}], ['build', 'POST', {}], ['record', 'POST', { input: 'No parallel run', recordContent: true }], ['runs/' + randomUUID() + '/approve', 'POST', {}]] as const) {
      const response = await request(app, f.base + '/' + route, { method, body }); assert.equal(response.status, 409, response.text);
    }
    for (const route of ['quality', 'quality/review/export', 'generation/inspect', 'runs']) assert.equal((await request(app, f.base + '/' + route)).status, 200);
    assert.deepEqual(await tree(f.dir), before);
  } finally { release(); }
  assert.equal((await job(app, started.json.jobId)).status, 'completed');
  assert.equal((await request(app, f.base + '/quality/requirements', { method: 'POST', body: requirement })).status, 200);
});
