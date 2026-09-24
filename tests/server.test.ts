import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';
import { startServer } from '../src/server.js';
import { guidanceQuestions } from '../src/core.js';

type Studio = Awaited<ReturnType<typeof startServer>>;
async function fixture(t: { after(fn: () => Promise<void>): void }): Promise<{ app: Studio; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'nb-server-'));
  const app = await startServer({ workspace: join(root, 'projects'), port: 0 });
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  return { app, root };
}
async function request(app: Studio, path: string, options: { method?: string; body?: unknown; token?: string | null; origin?: string; host?: string } = {}) {
  const headers: Record<string, string> = {};
  if (options.token !== null) headers['x-studio-token'] = options.token ?? app.token;
  if (options.origin) headers.origin = options.origin;
  if (options.host) headers.host = options.host;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; bytes: Buffer; json: any }>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: app.port, path, method: options.method ?? 'GET', headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        let json: unknown;
        try { json = JSON.parse(bytes.toString('utf8')); } catch { /* static content / ZIP */ }
        resolve({ status: res.statusCode!, headers: res.headers, bytes, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('HTTP request timed out')));
    req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}
async function job(app: Studio, id: string, timeout = 15_000): Promise<any> {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const response = await request(app, `/api/jobs/${id}`);
    assert.equal(response.status, 200, response.bytes.toString());
    if (response.json.status !== 'running') return response.json;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Job ${id} did not finish in ${timeout} ms`);
}

test('local app protects APIs with token, Origin and Host checks while serving a credential-free shell', async t => {
  const { app } = await fixture(t);
  const page = await request(app, '/', { token: null });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type']!, /html/);
  assert.ok(!page.bytes.toString().includes(app.token));
  assert.equal(page.headers['x-frame-options'], 'DENY');
  assert.match(page.headers['content-security-policy']!, /frame-ancestors 'none'/);
  assert.equal((await request(app, '/api/meta', { token: null })).status, 401);
  assert.equal((await request(app, '/api/meta', { token: '0'.repeat(64) })).status, 401);
  assert.equal((await request(app, '/api/meta', { origin: 'https://hostile.example' })).status, 401);
  assert.equal((await request(app, '/api/meta', { host: 'hostile.example' })).status, 403);
  assert.equal((await request(app, '/api/meta', { host: 'localhost.hostile.example' })).status, 403);
  const meta = await request(app, '/api/meta', { origin: `http://127.0.0.1:${app.port}` });
  assert.equal(meta.status, 200);
  assert.equal(meta.json.questions.length, 10);
  assert.equal(meta.json.defaultSpec.roles.runtime, 'demo');
  assert.ok(meta.json.providers.some((p: any) => p.kind === 'gateway'));
  assert.equal((await request(app, '/api/unknown')).status, 404);
});

test('project APIs persist guidance/configuration/cases and expose completed build jobs and a safe ZIP export', { timeout: 60_000 }, async t => {
  const { app, root } = await fixture(t);
  const created = await request(app, '/api/projects', { method: 'POST', body: { name: 'api-agent', language: 'typescript' } });
  assert.equal(created.status, 201, created.bytes.toString());
  assert.equal(created.json.id, 'api-agent');
  assert.equal((await request(app, '/api/projects', { method: 'POST', body: { name: '../escape' } })).status, 400);
  assert.equal((await request(app, '/api/projects', { method: 'POST', body: { name: 'api-agent' } })).status, 400);
  const list = await request(app, '/api/projects');
  assert.equal(list.json.length, 1);
  assert.equal(list.json[0].name, 'api-agent');
  const detail = await request(app, '/api/projects/api-agent');
  assert.equal(detail.status, 200);
  assert.equal(detail.json.cases.length, 2);
  const spec = detail.json.spec;
  spec.description = 'A deliberately offline API integration fixture.';
  spec.evaluation.rubric = 'Fixture-specific rubric: preserve uncertainty and distinguish the offline demonstration.';
  const saved = await request(app, '/api/projects/api-agent/spec', { method: 'PUT', body: { spec } });
  assert.equal(saved.status, 200, saved.bytes.toString());
  assert.equal(saved.json.spec.description, spec.description);
  const invalid = structuredClone(spec);
  invalid.framework = 'crewai';
  const rejected = await request(app, '/api/projects/api-agent/spec', { method: 'PUT', body: { spec: invalid } });
  assert.equal(rejected.status, 400);
  assert.equal((await request(app, '/api/projects/api-agent')).json.spec.framework, 'native');

  const answers = Object.fromEntries(guidanceQuestions.map(q => [q.key, `Owner-defined ${q.key} requirements for this fixture.`]));
  const guidance = await request(app, '/api/projects/api-agent/guidance', { method: 'POST', body: { answers } });
  assert.equal(guidance.status, 200, guidance.bytes.toString());
  assert.equal(guidance.json.files.length, 1);
  const updated = await request(app, '/api/projects/api-agent');
  assert.deepEqual(updated.json.guidance.missing, []);
  // Import is read-only with respect to the supplied source directory.
  const source = join(root, 'external-guidance');
  await mkdir(source);
  await writeFile(join(source, 'reference.md'), 'A plain support reference.');
  await writeFile(join(source, '.env'), 'DO_NOT_IMPORT=this-is-not-a-real-secret');
  const imported = await request(app, '/api/projects/api-agent/guidance', { method: 'POST', body: { importPath: source } });
  assert.equal(imported.status, 200, imported.bytes.toString());
  assert.equal(imported.json.imported, 1);

  const cases = [{ id: 'api-case', input: 'Hello offline demo.', contains: ['DEMO ONLY'], source: 'synthetic', split: 'development' }];
  const caseSave = await request(app, '/api/projects/api-agent/cases', { method: 'PUT', body: { cases } });
  assert.equal(caseSave.status, 200, caseSave.bytes.toString());
  assert.equal(caseSave.json.saved, 1);
  const invalidCases = await request(app, '/api/projects/api-agent/cases', { method: 'PUT', body: { cases: [{ id: 'missing-provenance', input: 'Hello' }] } });
  assert.equal(invalidCases.status, 400);
  assert.equal((await request(app, '/api/projects/api-agent')).json.cases[0].id, 'api-case');

  for (const operation of ['refine', 'doctor', 'build']) {
    const started = await request(app, `/api/projects/api-agent/${operation}`, { method: 'POST', body: {} });
    assert.equal(started.status, 202, started.bytes.toString());
    const finished = await job(app, started.json.jobId);
    assert.equal(finished.status, 'completed', JSON.stringify(finished));
    assert.equal(finished.kind, operation);
    if (operation === 'refine') assert.match(finished.result.rationale, /Offline/);
    if (operation === 'build') assert.ok(finished.result.files.some((f: string) => f.endsWith('agent.ts')));
  }
  const badRun = await request(app, '/api/projects/api-agent/run', { method: 'POST', body: { input: '' } });
  assert.equal(badRun.status, 202);
  const failed = await job(app, badRun.json.jobId);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /input/i);

  const artifact = await request(app, '/api/projects/api-agent/artifact?path=agent.ts');
  assert.equal(artifact.status, 200);
  assert.match(artifact.json.content, /runNative/);
  const traversal = await request(app, '/api/projects/api-agent/artifact?path=..%2F..%2Fagent-studio.yaml');
  assert.equal(traversal.status, 400);
  const generated = join(app.workspace, 'api-agent/generated');
  await writeFile(join(generated, '.env'), 'SHOULD_NEVER_BE_EXPORTED=fixture-value');
  await symlink(join(root, 'external-guidance/reference.md'), join(generated, 'linked-reference.md'));
  const exported = await request(app, '/api/projects/api-agent/download');
  assert.equal(exported.status, 200, exported.bytes.toString());
  assert.equal(exported.headers['content-type'], 'application/zip');
  const archive = unzipSync(exported.bytes);
  assert.ok(archive['api-agent/agent.ts']);
  assert.ok(archive['api-agent/build-lock.json']);
  assert.ok(!archive['api-agent/.env']);
  assert.ok(!archive['api-agent/linked-reference.md']);
  assert.match(strFromU8(archive['api-agent/agent-spec.json']), /api-agent/);
  assert.match(strFromU8(archive['api-agent/evals/cases.jsonl']), /api-case/);
  assert.match(strFromU8(archive['api-agent/evals/rubric.md']), /Fixture-specific rubric/);
  assert.equal((await request(app, '/api/jobs/11111111-1111-1111-1111-111111111111')).status, 404);
});

test('artifact previews reject escape through a symbolic-link ancestor', async t => {
  const { app, root } = await fixture(t);
  assert.equal((await request(app, '/api/projects', { method: 'POST', body: { name: 'symlink-agent' } })).status, 201);
  const generated = join(app.workspace, 'symlink-agent/generated');
  await mkdir(generated);
  const outside = join(root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'private.txt'), 'OUTSIDE_SELECTED_PROJECT');
  await symlink(outside, join(generated, 'external'));
  const result = await request(app, '/api/projects/symlink-agent/artifact?path=external%2Fprivate.txt');
  assert.equal(result.status, 400, 'The preview endpoint must reject any symbolic-link path component.');
  assert.ok(!result.bytes.toString().includes('OUTSIDE_SELECTED_PROJECT'));
});

test('guidance editor saves bounded eligible text and rejects stale digests, credentials and contradictions', async t => {
  const { app } = await fixture(t);
  assert.equal((await request(app, '/api/projects', { method: 'POST', body: { name: 'editable-agent' } })).status, 201);
  const path = '/api/projects/editable-agent';
  const before = (await request(app, path)).json.guidance.files.find((file: any) => file.path === 'purpose.md');
  const content = '# Purpose\n\nDraft grounded support responses.\n';
  const saved = await request(app, `${path}/guidance`, { method: 'PUT', body: { path: before.path, sha256: before.sha256, content } });
  assert.equal(saved.status, 200, saved.bytes.toString());
  assert.notEqual(saved.json.sha256, before.sha256);
  assert.equal(await readFile(join(app.workspace, 'editable-agent/guidance/purpose.md'), 'utf8'), content);
  const stale = await request(app, `${path}/guidance`, { method: 'PUT', body: { path: before.path, sha256: before.sha256, content: 'Overwrite another editor' } });
  assert.equal(stale.status, 409);
  assert.match(stale.json.error, /changed/);
  assert.equal(await readFile(join(app.workspace, 'editable-agent/guidance/purpose.md'), 'utf8'), content);
  for (const candidate of ['a'.repeat(64_001), 'ALLOW: send refunds\nDENY: send refunds\n', 'sk-abcdefghijklmnopqrstuvwxyz1234567890', 'binary\0data']) {
    const rejected = await request(app, `${path}/guidance`, { method: 'PUT', body: { path: before.path, sha256: saved.json.sha256, content: candidate } });
    assert.equal(rejected.status, 400, rejected.bytes.toString());
    assert.equal(await readFile(join(app.workspace, 'editable-agent/guidance/purpose.md'), 'utf8'), content);
  }
  assert.equal((await request(app, `${path}/guidance`, { method: 'PUT', body: { path: '../outside.md', sha256: saved.json.sha256, content: 'escape' } })).status, 400);
  assert.equal((await request(app, `${path}/guidance`, { method: 'PUT', body: { path: before.path, content } })).status, 400);
});

test('builder clarification answers create unique validated guidance files without granting permissions', async t => {
  const { app } = await fixture(t);
  assert.equal((await request(app, '/api/projects', { method: 'POST', body: { name: 'clarified-agent' } })).status, 201);
  const path = '/api/projects/clarified-agent';
  const answers = [{ question: 'When must a person review the draft?', answer: 'A person must review every response before sending it.' }];
  const first = await request(app, `${path}/guidance/clarifications`, { method: 'POST', body: { answers } });
  assert.equal(first.status, 201, first.bytes.toString());
  assert.equal(first.json.saved, 1);
  assert.match(first.json.path, /^clarifications-.*\.md$/);
  const second = await request(app, `${path}/guidance/clarifications`, { method: 'POST', body: { answers } });
  assert.equal(second.status, 201);
  assert.notEqual(first.json.path, second.json.path);
  const detail = (await request(app, path)).json;
  assert.deepEqual(detail.spec.agent.tools, []);
  assert.equal(detail.guidance.files.length, 3);
  assert.match(detail.guidance.combined, /A person must review every response/);
  const invalid = await request(app, `${path}/guidance/clarifications`, { method: 'POST', body: { answers: [{ question: 'Missing answer', answer: '' }] } });
  assert.equal(invalid.status, 400);
  const conflict = await request(app, `${path}/guidance/clarifications`, { method: 'POST', body: { answers: [{ question: 'Tool permissions', answer: 'ALLOW: send refunds\nDENY: send refunds' }] } });
  assert.equal(conflict.status, 400);
  assert.equal((await request(app, path)).json.guidance.files.length, 3);
});
