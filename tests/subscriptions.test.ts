import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os, { homedir, tmpdir } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { delimiter, join } from 'node:path';
import { providerDefinitions, providerId, providerHome, resolveProviderExecutable, inspectSubscription, installPlan, installSubscription, loginSubscription, type SubscriptionProgress } from '../src/subscriptions.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-subscription-')), bin = join(root, 'path-bin'), prefix = join(root, 'managed');
  await mkdir(bin);
  t.mock.method(os, 'homedir', () => root); syncBuiltinESMExports();
  const names = ['PATH', 'INSTRILO_PROVIDER_HOME', 'SUBS_FIX_LOG', 'SUBS_FIX_STARTED', 'SUBS_FIX_CHILD_MARKER', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY'];
  const prior = new Map(names.map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  process.env.PATH = bin; process.env.INSTRILO_PROVIDER_HOME = prefix; process.env.SUBS_FIX_LOG = join(root, 'calls.jsonl');
  t.after(async () => { t.mock.restoreAll(); syncBuiltinESMExports(); for (const [name, value] of prior) if (value === undefined) delete process.env[name]; else process.env[name] = value; await rm(root, { recursive: true, force: true }); });
  async function binary(name: string, body: string, directory = bin) {
    await mkdir(directory, { recursive: true }); const path = join(directory, name);
    const prelude = "const fs = require('node:fs'); const args = process.argv.slice(2); if(process.env.SUBS_FIX_LOG)fs.appendFileSync(process.env.SUBS_FIX_LOG,JSON.stringify(args)+'\\n');\n";
    await writeFile(path, '#!' + process.execPath + '\n' + prelude + body); await chmod(path, 0o755); return path;
  }
  async function calls() { try { return (await readFile(process.env.SUBS_FIX_LOG!, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error: any) { if (error.code === 'ENOENT') return []; throw error; } }
  return { root, bin, prefix, binary, calls };
}
const codexStatus = "if(args[0]==='--version')console.log('codex-cli 1.2.3 PRIVATE-IDENTITY');else if(args.join(' ')==='login status')console.error('Logged in using ChatGPT; PRIVATE-STATUS');else process.exitCode=1;";

test('aliases and install plans permit only official packages and an explicitly consented managed prefix', async t => {
  const f = await fixture(t);
  assert.equal(providerId('codex-cli'), 'codex'); assert.equal(providerId(' CLAUDE-CODE '), 'claude'); assert.equal(providerId('grok-cli'), 'grok');
  for (const value of ['openai', '../../npm', 'codex; echo secret', '@attacker/package']) assert.throws(() => providerId(value), /Choose/);
  assert.deepEqual(providerDefinitions.map(item => item.npmPackage), ['@openai/codex', '@anthropic-ai/claude-code', '@xai-official/grok']);
  const plan = installPlan('codex'); assert.equal(plan.destination, f.prefix); assert.equal(plan.requiresConsent, true);
  assert.deepEqual(plan.args, ['install', '--global', '--prefix', f.prefix, '@openai/codex', '--registry', 'https://registry.npmjs.org', '--no-audit', '--no-fund']);
  await assert.rejects(installSubscription('codex', { consent: false }), /explicit consent/); await assert.rejects(access(f.prefix), { code: 'ENOENT' });
  process.env.INSTRILO_PROVIDER_HOME = 'relative/prefix'; assert.throws(() => providerHome(), /absolute/);
  delete process.env.INSTRILO_PROVIDER_HOME; assert.equal(providerHome(), join(homedir(), '.local/share/instrilo/providers'));
});

test('discovery honors PATH before managed installation without invoking a provider', async t => {
  const f = await fixture(t); const managed = await f.binary('codex', '', join(f.prefix, 'bin')); const onPath = await f.binary('codex', '');
  assert.equal(await resolveProviderExecutable('codex-cli'), onPath); await rm(onPath); assert.equal(await resolveProviderExecutable('codex'), managed);
  await symlink(f.root, onPath); assert.equal(await resolveProviderExecutable('codex'), managed); await rm(onPath);
  assert.deepEqual(await f.calls(), []);
  const extra = join(f.root, 'another-bin'); await f.binary('codex', '', extra); process.env.PATH = [extra, f.bin].join(delimiter);
  assert.equal(await resolveProviderExecutable('codex'), join(extra, 'codex'));
  const absent = await inspectSubscription('claude'); assert.equal(absent.installed, false); assert.equal(absent.ready, false);
  await assert.rejects(loginSubscription('claude', { stdio: 'capture' }), /instrilo setup claude/);
});

test('Codex status reads only version and auth probes and never returns credentials, identities or logs', async t => {
  const f = await fixture(t); await f.binary('codex', codexStatus);
  const ready = await inspectSubscription('codex'); assert.equal(ready.ready, true); assert.equal(ready.version, '1.2.3'); assert.deepEqual(ready.authentication, { state: 'authenticated', method: 'subscription' });
  assert.ok(!JSON.stringify(ready).includes('PRIVATE')); assert.match(ready.warnings[0], /quota/); assert.deepEqual(await f.calls(), [['--version'], ['login', 'status']]);
  await f.binary('codex', "if(args[0]==='--version')console.log('4.5.6');else console.error('Logged in using an API key: PRIVATE-TOKEN');");
  const api = await inspectSubscription('codex'); assert.equal(api.ready, false); assert.equal(api.authentication.method, 'api-key'); assert.ok(!JSON.stringify(api).includes('PRIVATE'));
  await f.binary('codex', "if(args[0]==='--version')console.log('4.5.6');else{console.error('Not logged in');process.exitCode=1;}");
  assert.equal((await inspectSubscription('codex')).authentication.state, 'unauthenticated');
  await f.binary('codex', "console.error('PRIVATE provider failure');process.exitCode=8;");
  const failed = await inspectSubscription('codex'); assert.equal(failed.authentication.state, 'error'); assert.ok(!JSON.stringify(failed).includes('PRIVATE'));
});

test('Claude consumes only login fields, tolerates status-schema changes, and Grok invents no status probe', async t => {
  const f = await fixture(t);
  await f.binary('claude', "if(args[0]==='--version')console.log('2.3.4');else console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',email:'PRIVATE-IDENTITY',accessToken:'PRIVATE-TOKEN'}));");
  process.env.ANTHROPIC_API_KEY = 'private-environment-api-key';
  const claude = await inspectSubscription('claude-code'); assert.equal(claude.ready, true); assert.equal(claude.version, '2.3.4'); assert.ok(claude.warnings.some(warning => warning.includes('ANTHROPIC_API_KEY'))); assert.ok(!JSON.stringify(claude).includes('PRIVATE')); assert.ok(!JSON.stringify(claude).includes('private-environment'));
  assert.deepEqual(await f.calls(), [['--version'], ['auth', 'status']]);
  await f.binary('claude', "if(args[0]==='--version')console.log('2.3.4');else{console.log(JSON.stringify({loggedIn:false}));process.exitCode=1;}");
  assert.equal((await inspectSubscription('claude')).authentication.state, 'unauthenticated');
  await f.binary('claude', "if(args[0]==='--version')console.log('2.3.4');else console.log(JSON.stringify({futureSchema:'PRIVATE-FIELD'}));");
  const future = await inspectSubscription('claude'); assert.equal(future.authentication.state, 'authenticated'); assert.equal(future.authentication.method, 'unknown'); assert.equal(future.ready, false);
  await f.binary('claude', "if(args[0]==='--version')console.log('2.3.4');else{console.error('error: unknown command auth PRIVATE');process.exitCode=1;}");
  assert.equal((await inspectSubscription('claude')).authentication.state, 'error');
  await writeFile(process.env.SUBS_FIX_LOG!, ''); await f.binary('grok', "console.log('grok 0.7.8');");
  const grok = await inspectSubscription('grok'); assert.equal(grok.installed, true); assert.equal(grok.ready, false); assert.equal(grok.authentication.state, 'unknown'); assert.deepEqual(await f.calls(), [['--version']]);
});

test('installation runs the reviewed npm arguments, suppresses logs, and releases its prefix lock', async t => {
  const f = await fixture(t); await f.binary('codex', codexStatus); await f.binary('npm', "console.error('PRIVATE-NPM-TOKEN');");
  const events: SubscriptionProgress[] = []; const installed = await installSubscription('codex', { consent: true, onProgress: event => events.push(event) });
  assert.equal(installed.ready, true); assert.deepEqual((await f.calls())[0], installPlan('codex').args);
  assert.ok(events.every(event => event.type === 'message')); assert.ok(!JSON.stringify(events).includes('PRIVATE')); await assert.rejects(access(join(f.prefix, '.install.lock')), { code: 'ENOENT' });
  await f.binary('npm', "console.error('PRIVATE failure');process.exitCode=3;");
  await assert.rejects(installSubscription('codex', { consent: true }), error => !String(error).includes('PRIVATE') && /installation failed/.test(String(error)));
  await assert.rejects(access(join(f.prefix, '.install.lock')), { code: 'ENOENT' });
});

test('install cancellation kills descendants, rejects concurrent providers, and cleans the shared lock', async t => {
  const f = await fixture(t); await f.binary('codex', codexStatus);
  process.env.SUBS_FIX_STARTED = join(f.root, 'started'); process.env.SUBS_FIX_CHILD_MARKER = join(f.root, 'should-not-exist');
  const descendant = "setTimeout(()=>require('node:fs').writeFileSync(process.env.SUBS_FIX_CHILD_MARKER,'escaped'),600)";
  await f.binary('npm', "require('node:child_process').spawn(process.execPath,['-e'," + JSON.stringify(descendant) + "],{stdio:'ignore'});fs.writeFileSync(process.env.SUBS_FIX_STARTED,'started');setInterval(()=>{},1000);");
  const abort = new AbortController(); const installing = installSubscription('codex', { consent: true, signal: abort.signal }); const rejection = assert.rejects(installing, /cancelled/);
  for (let tries = 0; tries < 100; tries++) { try { await access(process.env.SUBS_FIX_STARTED!); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
  await access(process.env.SUBS_FIX_STARTED!); await assert.rejects(installSubscription('claude', { consent: true }), /Another provider installation/);
  abort.abort(); await rejection; await assert.rejects(access(join(f.prefix, '.install.lock')), { code: 'ENOENT' });
  await new Promise(resolve => setTimeout(resolve, 750)); await assert.rejects(access(process.env.SUBS_FIX_CHILD_MARKER!), { code: 'ENOENT' });
});

test('captured login emits complete allowlisted URLs and contextual device codes without raw diagnostics', async t => {
  const f = await fixture(t);
  const loginOutput = [
    "console.log('PRIVATE raw login logs access_token=hidden');",
    "console.log('https://evil.example/login https://auth.openai.com.evil.example/login http://auth.openai.com/login');",
    "console.log('https://auth.openai.com/oauth?access_token=PRIVATE https://auth.openai.com/oauth?refresh_token=PRIVATE https://auth.openai.com/oauth#id_token=PRIVATE https://user:password@auth.openai.com/oauth');",
    "process.stdout.write('https://auth.openai.com/oauth/authorize?response_');",
    "console.error('PRIVATE interleaved diagnostic');",
    "setTimeout(()=>{console.log('type=code&state=fixture');process.stdout.write('User code: ABCD-');setTimeout(()=>{console.log('EFGH');console.log('User code: ABCD-EFGH');console.log('ZZZZ-YYYY');},15);},15);",
  ].join('\n');
  await f.binary('codex', "if(args[0]==='--version')console.log('1.2.3');else if(args.join(' ')==='login status')console.error('Logged in using ChatGPT');else{" + loginOutput + "}");
  const events: SubscriptionProgress[] = []; const result = await loginSubscription('codex-cli', { device: true, stdio: 'capture', onProgress: event => events.push(event) });
  assert.equal(result.ready, true); assert.equal(result.loginCompleted, true); assert.deepEqual((await f.calls())[0], ['login', '--device-auth']);
  assert.deepEqual(events.filter(event => event.type === 'url'), [{ type: 'url', url: 'https://auth.openai.com/oauth/authorize?response_type=code&state=fixture' }]);
  assert.deepEqual(events.filter(event => event.type === 'device-code'), [{ type: 'device-code', code: 'ABCD-EFGH' }]);
  assert.ok(!JSON.stringify(events).includes('PRIVATE')); assert.ok(!JSON.stringify(events).includes('ZZZZ-YYYY'));
});

test('captured login failure offers fixed terminal argv; successful Grok login stays explicitly unverified', async t => {
  const f = await fixture(t);
  await f.binary('claude', "if(args[0]==='--version')console.log('2.3.4');else if(args.join(' ')==='auth status')console.log(JSON.stringify({loggedIn:false}));else{console.error('PRIVATE failed stdin prompt');process.exitCode=1;}");
  await assert.rejects(loginSubscription('claude', { device: true, stdio: 'capture' }), /no verified device/);
  const fallback = await loginSubscription('claude', { stdio: 'capture' }); assert.equal(fallback.terminalRequired, true); assert.equal(fallback.ready, false); assert.deepEqual(fallback.command?.args, ['auth', 'login']); assert.ok(!JSON.stringify(fallback).includes('PRIVATE'));
  await f.binary('grok', "if(args[0]==='--version')console.log('0.1.2');else console.log('https://auth.x.ai/oauth/authorize?state=fixture');");
  const events: SubscriptionProgress[] = []; const unknown = await loginSubscription('grok', { stdio: 'capture', device: true, onProgress: event => events.push(event) });
  assert.equal(unknown.loginCompleted, true); assert.equal(unknown.ready, false); assert.equal(unknown.authentication.state, 'unknown'); assert.match(unknown.message, /login command completed/);
  assert.ok(events.some(event => event.type === 'url' && event.url.startsWith('https://auth.x.ai/')));
});

test('probe cancellation and oversized diagnostics fail safely', async t => {
  const f = await fixture(t); await f.binary('codex', "console.error('PRIVATE hanging diagnostic');setInterval(()=>{},1000);");
  const abort = new AbortController(); const pending = inspectSubscription('codex', { signal: abort.signal }); const rejected = assert.rejects(pending, /cancelled/); setTimeout(() => abort.abort(), 30); await rejected;
  await f.binary('codex', "console.log('PRIVATE'.repeat(6000));");
  const result = await inspectSubscription('codex'); assert.equal(result.authentication.state, 'error'); assert.equal(result.ready, false); assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('captured login cancellation never reports completed login or leaks pending output', async t => {
  const f = await fixture(t); await f.binary('codex', "console.error('PRIVATE login waiting');setInterval(()=>{},1000);");
  const abort = new AbortController(), events: SubscriptionProgress[] = [];
  const loggingIn = loginSubscription('codex', { stdio: 'capture', signal: abort.signal, onProgress: event => events.push(event) });
  const rejected = assert.rejects(loggingIn, /cancelled/); setTimeout(() => abort.abort(), 30); await rejected;
  assert.ok(!JSON.stringify(events).includes('PRIVATE')); assert.ok(events.every(event => event.type === 'message'));
});

test('status probes enforce their five-second timeout without raw provider error output', { timeout: 10_000 }, async t => {
  const f = await fixture(t); await f.binary('codex', "console.error('PRIVATE timed-out probe');setInterval(()=>{},1000);");
  const started = Date.now(), result = await inspectSubscription('codex');
  assert.ok(Date.now() - started >= 4_900); assert.ok(Date.now() - started < 9_000); assert.equal(result.authentication.state, 'error'); assert.equal(result.ready, false);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
