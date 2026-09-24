import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../src/server.js';

type Studio = Awaited<ReturnType<typeof startServer>>;
const identity = 'PRIVATE_TEST_IDENTITY@invalid.example';
const secret = 'PRIVATE_TEST_TOKEN_DO_NOT_FORWARD';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function request(app: Studio, path: string, options: { method?: string; body?: unknown; token?: string | null; origin?: string; host?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.token !== null) headers['x-studio-token'] = options.token ?? app.token;
  if (options.origin) headers.origin = options.origin;
  if (options.host) headers.host = options.host;
  return new Promise<{ status: number; data: any; raw: string }>((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: app.port, path, method: options.method ?? 'GET', headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode!, data: JSON.parse(raw), raw });
      });
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('Fixture request timed out.')));
    req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}

function redacted(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.ok(!serialized.includes(identity), 'Provider account identity must not enter the app response.');
  assert.ok(!serialized.includes(secret), 'Raw provider output must not enter the app response.');
  assert.ok(!serialized.includes('attacker.invalid'), 'Unverified login URLs must not enter the app response.');
}

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-subscription-api-'));
  const bin = join(root, 'fake-bin'), configPath = join(root, 'fixture.json'), logPath = join(root, 'commands.jsonl'), releasePath = join(root, 'release');
  await mkdir(bin);
  let config: Record<string, unknown> = { codexAuth: 'unauthenticated', claudeAuth: 'subscription', loginWait: false, loginExit: 0, npmExit: 0 };
  await writeFile(configPath, JSON.stringify(config));
  // Every discovered client and npm is a temporary fixture. No real CLI, installer,
  // account, home-directory credential store, or model endpoint is contacted.
  const source = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const configPath = ${JSON.stringify(configPath)};
const logPath = ${JSON.stringify(logPath)};
const releasePath = ${JSON.stringify(releasePath)};
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
fs.appendFileSync(logPath, JSON.stringify({name,args}) + '\\n');
const identity = ${JSON.stringify(identity)};
const secret = ${JSON.stringify(secret)};
if (name === 'npm') { console.log(identity + ' ' + secret); process.exit(config.npmExit); }
if (args.join(' ') === '--version') { console.log(name + ' 1.2.3 ' + identity + ' ' + secret); process.exit(0); }
if (name === 'codex' && args.join(' ') === 'login status') {
  const auth = config.codexAuth;
  console.error(identity + ' ' + secret);
  console.log(auth === 'subscription' ? 'Logged in using ChatGPT' : auth === 'api-key' ? 'Logged in using an API key' : 'Not logged in');
  process.exit(auth === 'unauthenticated' ? 1 : 0);
}
if (name === 'claude' && args.join(' ') === 'auth status') {
  console.log(JSON.stringify({loggedIn:config.claudeAuth !== 'unauthenticated',authMethod:config.claudeAuth === 'subscription' ? 'claude.ai' : 'api_key',email:identity,accessToken:secret}));
  process.exit(config.claudeAuth === 'unauthenticated' ? 1 : 0);
}
if (args[0] === 'login' || args.join(' ') === 'auth login') {
  fs.writeFileSync(${JSON.stringify(join(root, 'login-pid'))}, String(process.pid));
  console.log(identity + ' ' + secret);
  console.log('https://attacker.invalid/signin');
  console.log('https://auth.openai.com/authorize?access_token=' + secret);
  console.log('https://auth.openai.com/codex/device');
  console.log('Device code: ABCD-EFGH');
  const finish = () => {
    if (config.loginExit === 0) {
      const latest = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      latest[name + 'Auth'] = 'subscription';
      fs.writeFileSync(configPath, JSON.stringify(latest));
    }
    process.exit(config.loginExit);
  };
  if (!config.loginWait) setTimeout(finish, 100);
  else { const timer = setInterval(() => { if (fs.existsSync(releasePath)) { clearInterval(timer); finish(); } }, 20); setTimeout(() => process.exit(2), 15000).unref(); }
} else process.exit(91);
`;
  for (const name of ['codex', 'claude', 'grok', 'npm']) await writeFile(join(bin, name), source, { mode: 0o700 });
  const envKeys = ['PATH', 'INSTRILO_PROVIDER_HOME'] as const;
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  process.env.PATH = bin;
  process.env.INSTRILO_PROVIDER_HOME = join(root, 'managed-provider-prefix');
  const app = await startServer({ workspace: join(root, 'projects'), port: 0 });
  t.after(async () => {
    await writeFile(releasePath, 'release');
    await sleep(150);
    app.server.closeAllConnections();
    if (app.server.listening) await new Promise<void>((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
    for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await rm(root, { recursive: true, force: true });
  });
  return {
    app, root, bin,
    async configure(values: Record<string, unknown>) { config = { ...JSON.parse(await readFile(configPath, 'utf8')), ...values }; await writeFile(configPath, JSON.stringify(config)); },
    async commands(): Promise<{ name: string; args: string[] }[]> { return (await readFile(logPath, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); },
    async release() { await writeFile(releasePath, 'release'); },
  };
}

async function poll(app: Studio, id: string, predicate: (job: any) => boolean = job => ['completed', 'failed', 'cancelled'].includes(job.status)) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await request(app, `/api/jobs/${id}`);
    assert.equal(response.status, 200, response.raw);
    redacted(response.data);
    if (predicate(response.data)) return response.data;
    await sleep(20);
  }
  throw new Error('Provider fixture job did not reach the expected state.');
}

test('subscription status is authorized, read-only, and excludes raw identity or credentials', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  for (const options of [{ token: null }, { token: 'incorrect' }, { origin: 'https://attacker.invalid' }]) {
    assert.equal((await request(f.app, '/api/subscriptions', options)).status, 401);
  }
  assert.equal((await request(f.app, '/api/subscriptions', { host: 'attacker.invalid' })).status, 403);
  assert.deepEqual(await f.commands(), []);
  const result = await request(f.app, '/api/subscriptions');
  assert.equal(result.status, 200, result.raw);
  redacted(result.data);
  assert.deepEqual(result.data.providers.map((provider: any) => provider.provider), ['codex', 'claude', 'grok']);
  const codex = result.data.providers[0], claude = result.data.providers[1], grok = result.data.providers[2];
  assert.equal(codex.installed, true);
  assert.equal(codex.path, join(f.bin, 'codex'));
  assert.equal(codex.version, '1.2.3');
  assert.equal(codex.authentication.state, 'unauthenticated');
  assert.equal(codex.ready, false);
  assert.equal(codex.deviceAuth, true);
  assert.equal(claude.authentication.method, 'subscription');
  assert.equal(claude.ready, true);
  assert.equal(claude.deviceAuth, false);
  assert.equal(grok.authentication.state, 'unknown');
  assert.equal(grok.ready, false);
  assert.equal(result.data.plans.codex.command, 'npm');
  assert.equal(result.data.plans.codex.package, '@openai/codex');
  assert.equal(result.data.plans.codex.destination, join(f.root, 'managed-provider-prefix'));
  assert.equal(result.data.plans.codex.requiresConsent, true);
  assert.ok(result.data.plans.codex.docs.every((url: string) => url.startsWith('https://')));
  assert.ok((await f.commands()).every(command => ['--version', 'login status', 'auth status'].includes(command.args.join(' '))));
  await f.configure({ claudeAuth: 'api-key' });
  const direct = await request(f.app, '/api/subscriptions/claude');
  assert.equal(direct.status, 200);
  assert.equal(direct.data.authentication.method, 'api-key');
  assert.equal(direct.data.ready, false);
  redacted(direct.data);
});

test('installation requires explicit consent and only runs the official fixed plan through fake npm', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  for (const body of [{}, { consent: false }, { consent: 'true' }, { consent: true, command: 'arbitrary' }]) {
    assert.equal((await request(f.app, '/api/subscriptions/codex/install', { method: 'POST', body })).status, 400);
  }
  assert.deepEqual(await f.commands(), []);
  const start = await request(f.app, '/api/subscriptions/codex/install', { method: 'POST', body: { consent: true } });
  assert.equal(start.status, 202, start.raw);
  const finished = await poll(f.app, start.data.jobId);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.kind, 'install');
  assert.equal(finished.provider, 'codex');
  assert.equal(finished.project, '__subscriptions__');
  assert.equal(finished.result.ready, false, 'Installing a client does not sign it in.');
  const installers = (await f.commands()).filter(command => command.name === 'npm');
  assert.deepEqual(installers, [{ name: 'npm', args: ['install', '--global', '--prefix', join(f.root, 'managed-provider-prefix'), '@openai/codex', '--registry', 'https://registry.npmjs.org', '--no-audit', '--no-fund'] }]);
  assert.ok(finished.progressMessages.every((event: any) => event.type === 'message'));
  redacted(finished);
});

test('provider login exposes only trusted bounded handoff events while active and clears them on completion', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  await f.configure({ loginWait: true });
  const start = await request(f.app, '/api/subscriptions/codex/login', { method: 'POST', body: { device: true } });
  assert.equal(start.status, 202, start.raw);
  const progress = await poll(f.app, start.data.jobId, job => job.progressMessages?.some((event: any) => event.type === 'device-code'));
  assert.equal(progress.status, 'running');
  assert.deepEqual(progress.progressMessages.filter((event: any) => event.type !== 'message'), [
    { type: 'url', url: 'https://auth.openai.com/codex/device' },
    { type: 'device-code', code: 'ABCD-EFGH' },
  ]);
  assert.equal((await request(f.app, '/api/subscriptions/codex/login', { method: 'POST', body: {} })).status, 409);
  assert.equal((await request(f.app, '/api/subscriptions/codex/install', { method: 'POST', body: { consent: true } })).status, 409);
  await f.release();
  const finished = await poll(f.app, start.data.jobId);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.result.authentication.method, 'subscription');
  assert.equal(finished.result.ready, true);
  assert.ok(finished.progressMessages.every((event: any) => event.type === 'message'));
  assert.ok(!JSON.stringify(finished).includes('ABCD-EFGH'));
  const commands = await f.commands();
  assert.deepEqual(commands.filter(command => command.args[0] === 'login' && command.args[1] !== 'status'), [{ name: 'codex', args: ['login', '--device-auth'] }]);
  assert.equal((await request(f.app, '/api/subscriptions/codex')).data.ready, true);
});

test('cancelling provider login stops the official child and removes browser/device handoff details', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  await f.configure({ loginWait: true });
  const start = await request(f.app, '/api/subscriptions/codex/login', { method: 'POST', body: { device: false } });
  await poll(f.app, start.data.jobId, job => job.progressMessages?.some((event: any) => event.type === 'device-code'));
  const cancelled = await request(f.app, `/api/jobs/${start.data.jobId}/cancel`, { method: 'POST' });
  assert.ok(['cancelling', 'cancelled'].includes(cancelled.data.status));
  const finished = await poll(f.app, start.data.jobId);
  assert.equal(finished.status, 'cancelled');
  assert.match(finished.error, /cancelled/i);
  assert.ok(finished.progressMessages.every((event: any) => event.type === 'message'));
  assert.equal((await request(f.app, '/api/subscriptions/codex')).data.authentication.state, 'unauthenticated');
});

test('Grok successful login remains unverified and terminal-required login exposes a safe fallback', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  const start = await request(f.app, '/api/subscriptions/grok/login', { method: 'POST', body: { device: false } });
  assert.equal(start.status, 202);
  const finished = await poll(f.app, start.data.jobId);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.result.authentication.state, 'unknown');
  assert.equal(finished.result.ready, false);
  assert.match(finished.result.message, /no verified/i);
  assert.deepEqual((await f.commands()).filter(command => command.name === 'grok').map(command => command.args), [['login'], ['--version']]);
  await f.configure({ loginExit: 2 });
  const fallbackStart = await request(f.app, '/api/subscriptions/claude/login', { method: 'POST', body: {} });
  const fallback = await poll(f.app, fallbackStart.data.jobId);
  assert.equal(fallback.status, 'completed', 'The result carries the explicit terminal-required outcome.');
  assert.equal(fallback.result.terminalRequired, true);
  assert.equal(fallback.result.ready, false);
  assert.match(fallback.result.message, /instrilo auth login claude/);
  assert.deepEqual(fallback.result.command, { executable: join(f.bin, 'claude'), args: ['auth', 'login'] });
  redacted(fallback);
});

test('setup APIs reject unknown providers and unsupported options before starting official processes', async t => {
  const f = await fixture(t);
  const invalid = [
    ['/api/subscriptions/unknown/login', {}],
    ['/api/subscriptions/claude/login', { device: true }],
    ['/api/subscriptions/codex/login', { device: 'true' }],
    ['/api/subscriptions/codex/login', { password: secret }],
    ['/api/subscriptions/codex/login', null],
    ['/api/subscriptions/codex/login', []],
  ] as const;
  for (const [path, body] of invalid) assert.equal((await request(f.app, path, { method: 'POST', body })).status, 400);
  assert.equal((await request(f.app, '/api/subscriptions/codex/install')).status, 405);
  assert.equal((await request(f.app, '/api/subscriptions/codex', { method: 'POST', body: {} })).status, 405);
  assert.deepEqual(await f.commands(), []);
});

test('closing the app server aborts an active detached provider login', { timeout: 20_000 }, async t => {
  const f = await fixture(t);
  await f.configure({ loginWait: true });
  const start = await request(f.app, '/api/subscriptions/codex/login', { method: 'POST', body: {} });
  assert.equal(start.status, 202);
  await poll(f.app, start.data.jobId, job => job.progressMessages?.some((event: any) => event.type === 'device-code'));
  const pid = Number(await readFile(join(f.root, 'login-pid'), 'utf8'));
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  process.kill(pid, 0);
  f.app.server.closeAllConnections();
  await new Promise<void>((resolve, reject) => f.app.server.close(error => error ? reject(error) : resolve()));
  const deadline = Date.now() + 3000;
  let alive = true;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch (error) { assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH'); alive = false; break; }
    await sleep(20);
  }
  assert.equal(alive, false, 'Closing the local server must not orphan its detached login child.');
});
