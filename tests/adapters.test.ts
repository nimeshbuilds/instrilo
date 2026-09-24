import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, truncate, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { adapterFingerprint, adapterManifestSchema, generatePluginArtifacts, inspectAdapter, installAdapter, invokeAdapter, listAdapters, removeAdapter, scaffoldAdapter, serveAdapter, testAdapter, withAdapterRegistryLock } from '../src/adapters.js';
import { defaultSpec } from '../src/core.js';
import { buildProject, createProject, manifestName } from '../src/workbench.js';
import { generate } from '../src/providers.js';
import type { GuidanceReport } from '../src/types.js';

const spec = defaultSpec('adapter-project');
const guidance: GuidanceReport = { root: 'guidance', files: [], combined: 'Only approved writes.', missing: [], issues: [] };
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-adapters-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function source(root: string, id: string, code?: string, kind: 'target' | 'framework' | 'provider' | 'host' = 'target', environment: string[] = []) {
  const dir = join(root, id);
  const { manifest } = await scaffoldAdapter(dir, id, kind);
  manifest.permissions.environment = environment;
  if (code) await writeFile(join(dir, 'entry.mjs'), code);
  await writeFile(join(dir, 'adapter.json'), JSON.stringify(manifest));
  return dir;
}
function setEnv(t: TestContext, key: string, value: string) {
  const before = process.env[key]; process.env[key] = value;
  t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
}
async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 5000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) { const result = await fn(); if (result !== undefined) return result; await new Promise(r => setTimeout(r, 15)); }
  throw new Error('Fixture did not become ready');
}
async function pidGone(pid: number) { try { process.kill(pid, 0); return undefined; } catch (e: any) { if (e.code === 'ESRCH') return true; throw e; } }

test('source workflow scaffolds, trusts, pins, conforms, builds, replaces and removes framework extensions', async t => {
  const root = await fixture(t), project = await createProject(root, { name: 'adapter-project' });
  const dir = await source(root, 'extra-files', undefined, 'framework');
  await assert.rejects(installAdapter(project.dir, dir, { trustCode: false }), /trust-code/);
  const first = await installAdapter(project.dir, dir, { trustCode: true });
  assert.equal(first.sha256, (await inspectAdapter(dir)).sha256);
  assert.deepEqual(await adapterFingerprint(project.dir), [{ id: 'extra-files', version: '0.1.0', sha256: first.sha256 }]);
  const conformance = await testAdapter(project.dir, 'extra-files', project.spec);
  assert.equal(conformance.passed, true);
  assert.deepEqual(conformance.checks.map(c => c.name), ['generate/python', 'generate/typescript', 'reject/unknown-operation', 'reject/invalid-input']);
  await buildProject(join(project.dir, manifestName), undefined, true);
  const generated = join(project.dir, 'generated');
  assert.match(await readFile(join(generated, 'extensions/extra-files/README.md'), 'utf8'), /Project: adapter-project/);
  const originalRuntime = await readFile(join(generated, 'runtime.ts'), 'utf8');
  const lock = JSON.parse(await readFile(join(generated, 'build-lock.json'), 'utf8'));
  assert.equal(lock.adapterHashes['extra-files@0.1.0'], first.sha256);
  await writeFile(join(dir, 'entry.mjs'), `export default async r => ({ artifacts: [{path:'extensions/extra-files/README.md',content:'Updated extension'}] });`);
  assert.match((await invokeAdapter(project.dir, 'extra-files', { apiVersion: '1', operation: 'generate', spec } )).artifacts[0].content, /Project:/);
  await assert.rejects(installAdapter(project.dir, dir, { trustCode: true }), /already installed/);
  const replacement = await installAdapter(project.dir, dir, { trustCode: true, replace: true });
  assert.notEqual(first.sha256, replacement.sha256);
  await buildProject(join(project.dir, manifestName), undefined, true);
  assert.equal(await readFile(join(generated, 'extensions/extra-files/README.md'), 'utf8'), 'Updated extension');
  assert.equal(await readFile(join(generated, 'runtime.ts'), 'utf8'), originalRuntime);
  await removeAdapter(project.dir, 'extra-files');
  await buildProject(join(project.dir, manifestName), undefined, true);
  await assert.rejects(access(join(generated, 'extensions/extra-files/README.md')), { code: 'ENOENT' });
  assert.deepEqual(await listAdapters(project.dir), []);
  await access(join(project.dir, replacement.directory));
});

test('installed code and registry paths cannot silently change the recorded pin', async t => {
  const root = await fixture(t), dir = await source(root, 'pin-test'), project = join(root, 'project');
  const installed = await installAdapter(project, dir, { trustCode: true });
  await writeFile(join(project, installed.directory, 'entry.mjs'), 'export default () => ({ modified:true });');
  await assert.rejects(invokeAdapter(project, 'pin-test', {}), /installed pin/);
  await assert.rejects(installAdapter(project, dir, { trustCode: true, replace: true }), /modified/);
  const file = join(project, '.instrilo/adapters.json'), registry = JSON.parse(await readFile(file, 'utf8'));
  registry.adapters[0].directory = '../pin-test';
  await writeFile(file, JSON.stringify(registry));
  await assert.rejects(listAdapters(project), /Invalid installed bundle directory/);
});

test('bundle inspection rejects hidden files, dependencies, links, non-files and bounded traversal', async t => {
  const root = await fixture(t);
  for (const [index, name] of ['.env', 'node_modules', 'link', 'bad\\path'].entries()) {
    const dir = await source(root, 'bad-bundle-' + index);
    if (name === 'node_modules') await mkdir(join(dir, name));
    else if (name === 'link') await symlink(join(dir, 'entry.mjs'), join(dir, name));
    else await writeFile(join(dir, name), 'secret');
    await assert.rejects(inspectAdapter(dir), /hidden|node_modules|symbolic|bundle path/);
  }
  const nested = await source(root, 'nested-bundle'); await mkdir(join(nested, ...Array(18).fill('deep')), { recursive: true });
  await assert.rejects(inspectAdapter(nested), /directory levels/);
  const wide = await source(root, 'wide-bundle'); await Promise.all(Array.from({ length: 201 }, (_, i) => mkdir(join(wide, 'dir' + i))));
  await assert.rejects(inspectAdapter(wide), /filesystem entries/);
  const many = await source(root, 'many-files'); await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(join(many, 'file' + i), '')));
  await assert.rejects(inspectAdapter(many), /100 files/);
  const large = await source(root, 'large-bundle'); await writeFile(join(large, 'large.bin'), ''); await truncate(join(large, 'large.bin'), 2_000_001);
  await assert.rejects(inspectAdapter(large), /size limit/);
  if (process.platform !== 'win32') {
    const fifo = await source(root, 'fifo-bundle'); assert.equal(spawnSync('mkfifo', [join(fifo, 'pipe')]).status, 0);
    await assert.rejects(inspectAdapter(fifo), /regular files/);
  }
  const linked = join(root, 'linked-root'); await symlink(large, linked); await assert.rejects(inspectAdapter(linked), /[Ss]ymbolic links/);
});

test('manifest entry paths and runtime-control environment declarations are rejected', async t => {
  const root = await fixture(t), dir = await source(root, 'manifest-test');
  const base = JSON.parse(await readFile(join(dir, 'adapter.json'), 'utf8'));
  for (const entry of ['../escape.mjs', '/escape.mjs', 'nested/../../escape.mjs', 'entry.js']) assert.equal(adapterManifestSchema.safeParse({ ...base, entry }).success, false);
  for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'PATH', 'BASH_ENV', 'HOME', 'INSTRILO_ADAPTER_FIXTURE']) assert.equal(adapterManifestSchema.safeParse({ ...base, permissions: { ...base.permissions, environment: [name] } }).success, false, name);
  await writeFile(join(dir, 'adapter.json'), JSON.stringify({ ...base, entry: 'missing.mjs' }));
  await assert.rejects(inspectAdapter(dir), /entry is missing/);
});

test('worker receives only declared credentials and fixture conformance withholds them', async t => {
  const root = await fixture(t), project = join(root, 'project');
  setEnv(t, 'INSTRILO_TEST_CREDENTIAL', 'declared-secret-value');
  setEnv(t, 'UNDECLARED_ADAPTER_SECRET', 'must-not-be-inherited');
  setEnv(t, 'NODE_OPTIONS', '--definitely-invalid');
  const dir = await source(root, 'env-test', 'export default () => Object.fromEntries(Object.entries(process.env));', 'provider', ['TEST_ADAPTER_CREDENTIAL']);
  setEnv(t, 'TEST_ADAPTER_CREDENTIAL', 'declared-secret-value');
  await installAdapter(project, dir, { trustCode: true });
  const live = await invokeAdapter(project, 'env-test', {});
  assert.equal(live.TEST_ADAPTER_CREDENTIAL, 'declared-secret-value');
  assert.equal(live.NODE_OPTIONS, undefined); assert.equal(live.UNDECLARED_ADAPTER_SECRET, undefined); assert.equal(live.HOME, undefined);
  // macOS can add this CoreFoundation variable itself during process startup.
  assert.deepEqual(Object.keys(live).filter(key => !(process.platform === 'darwin' && key === '__CF_USER_TEXT_ENCODING')).sort(), ['INSTRILO_ADAPTER_FIXTURE', 'NODE_ENV', 'PATH', 'TEST_ADAPTER_CREDENTIAL']);
  const fixtureEnv = await invokeAdapter(project, 'env-test', {}, { fixture: true });
  assert.equal(fixtureEnv.TEST_ADAPTER_CREDENTIAL, undefined); assert.equal(fixtureEnv.INSTRILO_ADAPTER_FIXTURE, '1');
});

test('errors and malformed worker output never expose forwarded credentials, even before truncation', async t => {
  const root = await fixture(t), project = join(root, 'project'), secret = 'credential-prefix-' + 'q'.repeat(2600);
  setEnv(t, 'ADAPTER_TEST_TOKEN', secret);
  const dir = await source(root, 'error-test', `export default r => { if(r.invalid){process.stdout.write(process.env.ADAPTER_TEST_TOKEN);return null;} throw new Error('Credentials: '+process.env.ADAPTER_TEST_TOKEN); };`, 'provider', ['ADAPTER_TEST_TOKEN']);
  await installAdapter(project, dir, { trustCode: true });
  for (const request of [{}, { invalid: true }]) await assert.rejects(invokeAdapter(project, 'error-test', request), (error: any) => { assert.doesNotMatch(error.message, /credential-prefix|qqqqqq/); return true; });
});

test('request, response, diagnostics and wall-clock limits stop adapter execution', async t => {
  const root = await fixture(t), project = join(root, 'project');
  const dir = await source(root, 'limits-test', `export default async r => { if(r.mode==='output')return 'x'.repeat(2_000_001); if(r.mode==='stderr'){process.stderr.write('x'.repeat(2_000_001));return 'ok';} await new Promise(r=>setTimeout(r,60000)); };`);
  await installAdapter(project, dir, { trustCode: true });
  await assert.rejects(invokeAdapter(project, 'limits-test', { text: 'x'.repeat(2_000_000) }), /request exceeds/);
  await assert.rejects(invokeAdapter(project, 'limits-test', undefined), /JSON serializable/);
  await assert.rejects(invokeAdapter(project, 'limits-test', { mode: 'output' }), /output exceeds/);
  await assert.rejects(invokeAdapter(project, 'limits-test', { mode: 'stderr' }), /diagnostics exceed/);
  await assert.rejects(invokeAdapter(project, 'limits-test', {}, { timeoutMs: 100 }), /timed out/);
  for (const timeoutMs of [0, -1, NaN, Infinity, 120001]) await assert.rejects(invokeAdapter(project, 'limits-test', {}, { timeoutMs }), /timeout must/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(invokeAdapter(project, 'limits-test', {}, { signal: controller.signal }), /cancelled/);
});

test('timeout and cancellation kill ordinary descendants as well as the adapter worker', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t), project = join(root, 'project');
  const dir = await source(root, 'process-test', `import {spawn} from 'node:child_process';import {writeFile} from 'node:fs/promises';export default async r => { const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await writeFile(r.pidFile,String(child.pid));await new Promise(r=>setTimeout(r,60000)); };`);
  await installAdapter(project, dir, { trustCode: true });
  for (const mode of ['timeout', 'cancel']) {
    const controller = new AbortController(), pidFile = join(root, mode + '.pid');
    const running = invokeAdapter(project, 'process-test', { pidFile }, { timeoutMs: mode === 'timeout' ? 1000 : 5000, signal: controller.signal });
    // Attach rejection handling immediately while waiting for the fixture's child.
    const outcome = running.then(() => undefined, error => error);
    const pid = await waitFor(async () => { try { const text=await readFile(pidFile, 'utf8');const pid=Number(text);return /^\d+$/.test(text)&&pid>1?pid:undefined; } catch { return undefined; } });
    let cleaned = false;
    t.after(async () => { if(!cleaned)try { process.kill(pid, 'SIGKILL'); } catch {} });
    if (mode === 'cancel') controller.abort();
    assert.match((await outcome).message, mode === 'cancel' ? /cancelled/ : /timed out/);
    await waitFor(() => pidGone(pid));cleaned=true;
  }
});

test('generator output rejects protected paths, traversal, hidden files, executables and duplicates', async t => {
  const root = await fixture(t), project = join(root, 'project');
  const dir = await source(root, 'path-test', `export default r => ({artifacts:JSON.parse(r.guidance.combined)});`);
  await installAdapter(project, dir, { trustCode: true });
  for (const path of ['runtime.ts', 'extensions/other/readme.txt', 'extensions/path-test/../../runtime.ts', 'extensions/path-test/.env', 'extensions/path-test/a\\b', 'extensions/path-test/a\u0000b', 'extensions/path-test/' + 'a'.repeat(600)]) {
    await assert.rejects(generatePluginArtifacts(project, spec, { ...guidance, combined: JSON.stringify([{ path, content: 'unsafe' }]) }), /protected runtime/);
  }
  await assert.rejects(generatePluginArtifacts(project, spec, { ...guidance, combined: JSON.stringify([{ path: 'extensions/path-test/run.sh', content: 'unsafe', executable: true }]) }), /non-executable/);
  const file = { path: 'extensions/path-test/readme.md', content: 'safe' };
  await assert.rejects(generatePluginArtifacts(project, spec, { ...guidance, combined: JSON.stringify([file, file]) }), /Duplicate/);
  assert.deepEqual(await generatePluginArtifacts(project, spec, { ...guidance, combined: JSON.stringify([file]) }), [file]);
});

test('concurrent installation/removal preserves registry integrity and a held lock cannot be stolen', async t => {
  const root = await fixture(t), project = join(root, 'project');
  const first = await source(root, 'first-adapter'), second = await source(root, 'second-adapter');
  const installs = await Promise.allSettled([installAdapter(project, first, { trustCode: true }), installAdapter(project, second, { trustCode: true })]);
  for (const result of installs) if (result.status === 'rejected') assert.equal(result.reason.code, 'EEXIST');
  const successful = installs.filter(r => r.status === 'fulfilled').length;
  assert.ok(successful >= 1); assert.equal((await listAdapters(project)).length, successful);
  for (const dir of [first, second]) if (!(await listAdapters(project)).some(a => a.manifest.id === dir.split('/').at(-1))) await installAdapter(project, dir, { trustCode: true });
  const removals = await Promise.allSettled([removeAdapter(project, 'first-adapter'), removeAdapter(project, 'second-adapter')]);
  assert.equal((await listAdapters(project)).length, 2 - removals.filter(r => r.status === 'fulfilled').length);
  for (const result of removals) if (result.status === 'rejected') assert.equal(result.reason.code, 'EEXIST');
  const lock = join(project, '.instrilo/adapters.lock'); await writeFile(lock, 'held-test-lock');
  await assert.rejects(installAdapter(project, first, { trustCode: true, replace: true }), { code: 'EEXIST' });
  assert.equal(await readFile(lock, 'utf8'), 'held-test-lock');
  assert.ok((await readdir(join(project, '.instrilo'))).every(name => !name.startsWith('adapter-staging-') && !/^adapters.json\./.test(name)));
});

test('a build holds the registry lock through generation and pin capture; concurrent mutation cannot mislabel artifacts', async t => {
  const root = await fixture(t), project = await createProject(root, { name: 'locked-build' });
  const started = join(root, 'generator-started'), release = join(root, 'generator-release');
  const code = `import {writeFile,access} from 'node:fs/promises';export default async()=>{await writeFile(${JSON.stringify(started)},'ready');for(;;){try{await access(${JSON.stringify(release)});break;}catch{await new Promise(r=>setTimeout(r,15));}}return {artifacts:[{path:'extensions/locked-extension/version.txt',content:'original'}]};};`;
  const dir = await source(root, 'locked-extension', code), extra = await source(root, 'unrelated-extension');
  const original = await installAdapter(project.dir, dir, { trustCode: true });
  const building = buildProject(join(project.dir, manifestName)).then(result => ({ result }), error => ({ error }));
  try {
    await waitFor(async () => { try { return (await readFile(started, 'utf8')) === 'ready' ? true : undefined; } catch { return undefined; } });
    await writeFile(join(dir, 'entry.mjs'), `export default()=>({artifacts:[{path:'extensions/locked-extension/version.txt',content:'replacement'}]});`);
    const mutations = await Promise.allSettled([
      installAdapter(project.dir, dir, { trustCode: true, replace: true }),
      installAdapter(project.dir, extra, { trustCode: true }),
      removeAdapter(project.dir, 'locked-extension'),
    ]);
    for (const mutation of mutations) { assert.equal(mutation.status, 'rejected'); if(mutation.status === 'rejected')assert.equal(mutation.reason.code, 'EEXIST'); }
    assert.deepEqual(await adapterFingerprint(project.dir), [{ id: 'locked-extension', version: '0.1.0', sha256: original.sha256 }]);
  } finally { await writeFile(release, 'continue'); }
  const outcome = await building;if('error' in outcome)throw outcome.error;
  const generated = join(project.dir, 'generated');
  assert.equal(await readFile(join(generated, 'extensions/locked-extension/version.txt'), 'utf8'), 'original');
  assert.equal(JSON.parse(await readFile(join(generated, 'build-lock.json'), 'utf8')).adapterHashes['locked-extension@0.1.0'], original.sha256);
  const replacement = await installAdapter(project.dir, dir, { trustCode: true, replace: true });
  await buildProject(join(project.dir, manifestName), undefined, true);
  assert.equal(await readFile(join(generated, 'extensions/locked-extension/version.txt'), 'utf8'), 'replacement');
  assert.equal(JSON.parse(await readFile(join(generated, 'build-lock.json'), 'utf8')).adapterHashes['locked-extension@0.1.0'], replacement.sha256);
  await assert.rejects(withAdapterRegistryLock(project.dir, async () => { throw new Error('fixture failure'); }), /fixture failure/);
  await assert.rejects(access(join(project.dir, '.instrilo/adapters.lock')), { code: 'ENOENT' });
  await removeAdapter(project.dir, 'locked-extension');
});

async function request(url: string, headers: Record<string, string>, body: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers }, res => { let output = ''; res.setEncoding('utf8'); res.on('data', c => output += c); res.on('end', () => resolve({ status: res.statusCode!, body: output })); });
    req.on('error', reject); req.end(body);
  });
}
test('provider scaffold conforms, serves authenticated local HTTP, and suppresses provider secrets on errors', async t => {
  const root = await fixture(t), project = join(root, 'project');
  const dir = await source(root, 'http-provider', undefined, 'provider');
  await installAdapter(project, dir, { trustCode: true });
  assert.equal((await testAdapter(project, 'http-provider', spec)).passed, true);
  setEnv(t, 'ADAPTER_GATEWAY_TOKEN', 'local-test-gateway-token-at-least-24');
  setEnv(t, 'ADAPTER_REMOTE_TOKEN', 'private-upstream-credential');
  let upstreamCalls = 0;
  const upstream = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer private-upstream-credential');
    let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); upstreamCalls++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: body.model, message: { role: 'assistant', content: 'received: ' + body.messages.at(-1).content }, usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }));
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => upstream.close(() => resolve())));
  setEnv(t, 'ADAPTER_REMOTE_URL', 'http://127.0.0.1:' + (upstream.address() as any).port);
  const manifest = JSON.parse(await readFile(join(dir, 'adapter.json'), 'utf8')); manifest.permissions.environment = ['ADAPTER_REMOTE_TOKEN', 'ADAPTER_REMOTE_URL']; manifest.permissions.network = true;
  await writeFile(join(dir, 'adapter.json'), JSON.stringify(manifest));
  await writeFile(join(dir, 'entry.mjs'), `export default async r=>{if(r.model==='fail')throw new Error(process.env.ADAPTER_REMOTE_TOKEN);const response=await fetch(process.env.ADAPTER_REMOTE_URL,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.ADAPTER_REMOTE_TOKEN},body:JSON.stringify(r)});return response.json();};`);
  await installAdapter(project, dir, { trustCode: true, replace: true });
  const bridge = await serveAdapter(project, 'http-provider', { port: 0, tokenEnv: 'ADAPTER_GATEWAY_TOKEN' });
  t.after(() => new Promise<void>(resolve => bridge.server.close(() => resolve())));
  const url = bridge.url + '/chat/completions', headers = { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.ADAPTER_GATEWAY_TOKEN };
  const payload = JSON.stringify({ model: 'local-test-model', messages: [{ role: 'user', content: 'hello' }] });
  const success = await request(url, headers, payload);
  assert.equal(success.status, 200); const envelope = JSON.parse(success.body);
  assert.equal(envelope.model, 'local-test-model'); assert.equal(envelope.choices[0].message.content, 'received: hello'); assert.equal(envelope.usage.total_tokens, 3);
  const throughGateway = await generate({ kind: 'gateway', model: 'gateway-model', baseUrl: bridge.url, auth: { type: 'bearer-env', env: 'ADAPTER_GATEWAY_TOKEN' } }, { system: 'local test', prompt: 'configured provider connection' });
  assert.equal(throughGateway.text, 'received: configured provider connection'); assert.equal(upstreamCalls, 2);
  assert.equal((await request(url, { ...headers, authorization: process.env.ADAPTER_GATEWAY_TOKEN! }, payload)).status, 401);
  assert.equal((await request(url, { ...headers, authorization: 'Bearer invalid' }, payload)).status, 401);
  assert.equal((await request(url, { ...headers, origin: 'https://evil.example' }, payload)).status, 403);
  assert.equal((await request(url, { ...headers, host: 'evil.example' }, payload)).status, 403);
  assert.equal((await request(url, { ...headers, 'content-type': 'application/jsonjunk' }, payload)).status, 415);
  assert.equal((await request(url, headers, '{')).status, 400);
  assert.equal((await request(url, headers, JSON.stringify({ ...JSON.parse(payload), stream: true }))).status, 400);
  assert.equal((await request(url, headers, 'x'.repeat(1_000_001))).status, 413);
  const failure = await request(url, headers, JSON.stringify({ ...JSON.parse(payload), model: 'fail' }));
  assert.equal(failure.status, 502); assert.doesNotMatch(failure.body, /private-upstream|credential/);
});
