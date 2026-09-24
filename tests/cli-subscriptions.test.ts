import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { createProject } from '../src/workbench.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const cli = join(repository, 'src/cli.ts'), tsxLoader = import.meta.resolve('tsx');
const options = { skip: process.platform === 'win32' ? 'POSIX fake executables exercise the WSL-supported onboarding flow.' : false, timeout: 30000 };
type Result = { code: number | null; stdout: string; stderr: string };
type Event = { binary: string; args: string[] };
const fakeProvider = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const binary = path.basename(process.argv[1]), args = process.argv.slice(2);
fs.appendFileSync(process.env.INSTRILO_FIXTURE_EVENTS, JSON.stringify({binary,args})+'\\n');
const state = path.join(process.env.INSTRILO_FIXTURE_STATE,binary);
if(args[0]==='--version') { console.log('2.1.259'); process.exit(0); }
const status = binary==='claude' ? args.join(' ')==='auth status' : args.join(' ')==='login status';
if(status) {
 const loggedIn = fs.existsSync(state);
 if(process.env.INSTRILO_FIXTURE_STATUS_ERROR==='1') { console.error('private-status-diagnostic'); process.exit(7); }
 if(binary==='claude') console.log(JSON.stringify({loggedIn,authMethod:loggedIn?'oauth':'none',email:'private@example.test'}));
 else console.error(loggedIn ? 'Logged in using ChatGPT' : 'Not logged in');
 process.exit(loggedIn?0:1);
}
const login = binary==='claude' ? args[0]==='auth'&&args[1]==='login' : args[0]==='login';
if(login) {
 if(process.env.INSTRILO_FIXTURE_LOGIN_FAIL==='1') process.exit(9);
 if(process.env.INSTRILO_FIXTURE_LOGIN_RELEASE) {
  setInterval(()=>{if(fs.existsSync(process.env.INSTRILO_FIXTURE_LOGIN_RELEASE)){fs.writeFileSync(state,'authenticated');process.exit(0);}},20);
 } else if(process.env.INSTRILO_FIXTURE_LOGIN_WAIT==='1') {
  const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  fs.writeFileSync(process.env.INSTRILO_FIXTURE_PIDS, JSON.stringify([process.pid,child.pid]));
  setInterval(()=>{},1000);
 } else { fs.writeFileSync(state,'authenticated'); process.exit(0); }
} else {
 const prompt = binary==='grok' ? args[args.indexOf('-p')+1] : fs.readFileSync(0,'utf8');
 if(!prompt.includes('INSTRILO_READY')) throw new Error('Unexpected model call');
 const text=process.env.INSTRILO_FIXTURE_VERIFY_FAIL==='1'?'wrong response':'INSTRILO_READY';
 console.log(JSON.stringify(binary==='codex'?{type:'item.completed',item:{type:'agent_message',text}}:{result:text}));
}
`;

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-cli-subscriptions-'));
  const home = join(root, 'home'), bin = join(root, 'bin'), managed = join(root, 'managed providers'), state = join(root, 'state'), events = join(root, 'events.jsonl'), source = join(root, 'fake-provider.cjs');
  const preload = join(root, 'fixture-home.cjs');
  await Promise.all([mkdir(home), mkdir(bin), mkdir(state)]);
  await writeFile(preload, `require('node:os').homedir = () => ${JSON.stringify(home)};
const childProcess = require('node:child_process'), originalSpawn = childProcess.spawn;
childProcess.spawn = function(command, ...args) {
  if (command !== process.execPath && command !== ${JSON.stringify(join(repository, 'node_modules/@esbuild', process.platform + '-' + process.arch, 'bin/esbuild'))} && !command.startsWith(${JSON.stringify(root)} + require('node:path').sep)) throw new Error('Fixture refused an executable outside its isolated directory');
  return originalSpawn.call(this, command, ...args);
};
require('node:module').syncBuiltinESMExports();`);
  await writeFile(events, ''); await writeFile(source, fakeProvider);
  await writeFile(join(bin, 'npm'), `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);
fs.appendFileSync(process.env.INSTRILO_FIXTURE_EVENTS,JSON.stringify({binary:'npm',args})+'\\n');
if(process.env.INSTRILO_FIXTURE_INSTALL_FAIL==='1') process.exit(11);
const prefix=args[args.indexOf('--prefix')+1];
const packages={'@openai/codex':'codex','@anthropic-ai/claude-code':'claude','@xai-official/grok':'grok'};
const name=Object.entries(packages).find(([p])=>args.includes(p))?.[1];
if(!name || args[args.indexOf('--registry')+1]!=='https://registry.npmjs.org') throw new Error('Unexpected package installation');
fs.mkdirSync(path.join(prefix,'bin'),{recursive:true});
fs.copyFileSync(process.env.INSTRILO_FIXTURE_PROVIDER_SOURCE,path.join(prefix,'bin',name));
fs.chmodSync(path.join(prefix,'bin',name),0o755);
`, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: bin, INSTRILO_PROVIDER_HOME: managed,
    INSTRILO_FIXTURE_EVENTS: events, INSTRILO_FIXTURE_STATE: state, INSTRILO_FIXTURE_PROVIDER_SOURCE: source };
  const children = new Set<ChildProcess>();
  t.after(async () => { for (const child of children) child.kill('SIGKILL'); await rm(root, { recursive: true, force: true }); });
  function start(args: string[], overrides: NodeJS.ProcessEnv = {}) {
    const child = spawn(process.execPath, ['--require', preload, '--import', tsxLoader, cli, ...args], { cwd: root, env: { ...env, ...overrides }, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child); let stdout = '', stderr = '';
    const result = new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
      child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', error => { clearTimeout(timer); children.delete(child); reject(error); });
      child.once('close', code => { clearTimeout(timer); children.delete(child); resolve({ code, stdout, stderr }); });
    });
    return { child, result };
  }
  const run = (args: string[], overrides?: NodeJS.ProcessEnv) => start(args, overrides).result;
  async function installFake(provider: string, authenticated = false) {
    await mkdir(join(managed, 'bin'), { recursive: true }); await writeFile(join(managed, 'bin', provider), fakeProvider, { mode: 0o755 });
    if (authenticated) await writeFile(join(state, provider), 'authenticated');
  }
  return { root, home, managed, state, events, run, start, installFake,
    calls: async (): Promise<Event[]> => (await readFile(events, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)),
    clear: () => writeFile(events, '') };
}
function json(result: Result): any { assert.equal(result.code, 0, result.stderr + '\n' + result.stdout); return JSON.parse(result.stdout); }
const inference = (event: Event) => event.binary !== 'npm' && (event.args[0] === 'exec' || event.args.includes('-p'));
const login = (event: Event) => event.binary === 'claude' ? event.args[0] === 'auth' && event.args[1] === 'login' : event.args[0] === 'login' && event.args[1] !== 'status';
async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
  const until = Date.now() + 7000;
  while (Date.now() < until) { const value = await read(); if (value !== undefined) return value; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('CLI fixture did not become ready');
}

test('subscription CLI plans and noninteractive missing consent are side-effect free', options, async t => {
  const f = await fixture(t);
  for (const [provider, pkg] of [['codex', '@openai/codex'], ['claude', '@anthropic-ai/claude-code'], ['grok', '@xai-official/grok']]) {
    const plan = json(await f.run(['auth', 'install', provider, '--plan']));
    assert.equal(plan.package, pkg); assert.equal(plan.destination, f.managed); assert.equal(plan.requiresConsent, true);
    assert.deepEqual(plan.args, ['install', '--global', '--prefix', f.managed, pkg, '--registry', 'https://registry.npmjs.org', '--no-audit', '--no-fund']);
  }
  for (const args of [['setup', 'codex'], ['auth', 'install', 'claude'], ['setup'], ['auth', 'login', 'grok', '--install']]) {
    const denied = await f.run(args); assert.equal(denied.code, 1); assert.match(denied.stderr, /Interactive input is unavailable/);
  }
  assert.deepEqual(await f.calls(), []); assert.deepEqual(await readdir(f.home), []);
  await assert.rejects(access(f.managed), { code: 'ENOENT' });
});

test('subscription setup --yes installs, signs in, probes status and never calls a model', options, async t => {
  const f = await fixture(t);
  for (const provider of ['codex', 'claude', 'grok']) {
    await f.clear();
    const status = json(await f.run(['setup', provider, '--yes']));
    assert.equal(status.provider, provider); assert.equal(status.installed, true); assert.equal(status.path, join(f.managed, 'bin', provider));
    assert.equal(status.authentication.state, provider === 'grok' ? 'unknown' : 'authenticated'); assert.equal(status.ready, provider !== 'grok');
    const calls = await f.calls(); assert.equal(calls.filter(event => event.binary === 'npm').length, 1); assert.equal(calls.filter(login).length, 1); assert.equal(calls.filter(inference).length, 0);
    assert.doesNotMatch(JSON.stringify(status), /private@example|private-status/);
    await assert.rejects(access(join(f.managed, '.install.lock')), { code: 'ENOENT' });
  }
  await f.clear(); json(await f.run(['setup', 'codex', '--yes']));
  assert.equal((await f.calls()).filter(event => event.binary === 'npm' || login(event) || inference(event)).length, 0, 'Ready providers must not be reinstalled, logged in again, or billed.');
});

test('subscription login --install is explicit and unsupported device login fails before installation', options, async t => {
  const f = await fixture(t);
  const missing = await f.run(['auth', 'login', 'codex']); assert.equal(missing.code, 1); assert.match(missing.stderr, /instrilo setup codex|--install/);
  const unsupported = await f.run(['auth', 'login', 'claude', '--device', '--install', '--yes']); assert.equal(unsupported.code, 1); assert.match(unsupported.stderr, /device/); assert.deepEqual(await f.calls(), []);
  const status = json(await f.run(['auth', 'login', 'codex', '--device', '--install', '--yes'])); assert.equal(status.ready, true);
  const calls = await f.calls(); assert.equal(calls.filter(event => event.binary === 'npm').length, 1);
  assert.deepEqual(calls.find(login)?.args, ['login', '--device-auth']); assert.equal(calls.filter(inference).length, 0);
});

test('connect preserves independent roles and existing model settings; incompatible roles fail before onboarding', options, async t => {
  const f = await fixture(t), project = await createProject(f.root, { name: 'connect-fixture' }), manifest = join(project.dir, 'agent-studio.yaml');
  const initial = parse(await readFile(manifest, 'utf8'));
  json(await f.run(['connect', 'codex', project.dir, '--yes', '--role', 'builder', '--connection', 'coder', '--model', 'model-one']));
  let saved = parse(await readFile(manifest, 'utf8'));
  assert.deepEqual(saved.roles, { ...initial.roles, builder: 'coder' }); assert.equal(saved.connections.coder.model, 'model-one'); assert.deepEqual(saved.connections.demo, initial.connections.demo);
  saved.connections.coder.timeoutMs = 12345; await writeFile(manifest, stringify(saved));
  await f.clear(); json(await f.run(['connect', 'codex', project.dir, '--yes', '--role', 'judge', '--connection', 'coder']));
  saved = parse(await readFile(manifest, 'utf8')); assert.deepEqual(saved.roles, { builder: 'coder', runtime: initial.roles.runtime, judge: 'coder' });
  assert.equal(saved.connections.coder.model, 'model-one'); assert.equal(saved.connections.coder.timeoutMs, 12345);
  assert.equal((await f.calls()).filter(event => event.binary === 'npm' || login(event) || inference(event)).length, 0);
  saved.agent.tools = [{ name: 'lookup', kind: 'http', description: 'A local read tool', url: 'http://127.0.0.1:12345/tool', method: 'GET', requiresApproval: false, requiredScopes: [], inputSchema: { type: 'object' } }];
  await writeFile(manifest, stringify(saved)); const before = await readFile(manifest, 'utf8'); await f.clear();
  const incompatible = await f.run(['connect', 'claude', project.dir, '--yes', '--role', 'runtime']);
  assert.equal(incompatible.code, 1); assert.match(incompatible.stderr, /portable HTTP tool/); assert.deepEqual(await f.calls(), []); assert.equal(await readFile(manifest, 'utf8'), before);
  const collision = await f.run(['connect', 'claude', project.dir, '--yes', '--connection', 'coder']);
  assert.equal(collision.code, 1); assert.match(collision.stderr, /another provider/); assert.deepEqual(await f.calls(), []); assert.equal(await readFile(manifest, 'utf8'), before);
});

test('failed provider installation/login remains unsuccessful and status does not expose diagnostics', options, async t => {
  const f = await fixture(t);
  const failedInstall = await f.run(['setup', 'codex', '--yes'], { INSTRILO_FIXTURE_INSTALL_FAIL: '1' });
  assert.equal(failedInstall.code, 1); assert.match(failedInstall.stderr, /installation failed/i); await assert.rejects(access(join(f.managed, '.install.lock')), { code: 'ENOENT' });
  await f.installFake('claude'); await f.clear();
  const failedLogin = await f.run(['auth', 'login', 'claude'], { INSTRILO_FIXTURE_LOGIN_FAIL: '1' });
  assert.equal(failedLogin.code, 1); const status = JSON.parse(failedLogin.stdout); assert.equal(status.ready, false); assert.equal(status.terminalRequired, true);
  assert.equal(status.authentication.state, 'unauthenticated'); assert.equal((await f.calls()).filter(inference).length, 0);
  const errored = json(await f.run(['auth', 'status', 'claude'], { INSTRILO_FIXTURE_STATUS_ERROR: '1' }));
  assert.equal(errored.authentication.state, 'error'); assert.equal(errored.ready, false); assert.doesNotMatch(JSON.stringify(errored), /private-status|private@example/);
});

test('SIGINT cancels the official login and reaps its descendant before CLI completion', options, async t => {
  const f = await fixture(t), pidsFile = join(f.root, 'login-pids.json'); await f.installFake('codex');
  const pending = f.start(['auth', 'login', 'codex'], { INSTRILO_FIXTURE_LOGIN_WAIT: '1', INSTRILO_FIXTURE_PIDS: pidsFile });
  const pids = await waitFor<number[]>(async () => { try { return JSON.parse(await readFile(pidsFile, 'utf8')); } catch { return undefined; } });
  t.after(async () => { for (const pid of pids) if (pid > 1) try { process.kill(pid, 'SIGKILL'); } catch {} });
  assert.ok(pids.every(pid => Number.isInteger(pid) && pid > 1)); pending.child.kill('SIGINT');
  const result = await pending.result; assert.equal(result.code, 1); assert.match(result.stderr, /cancelled/i);
  for (const pid of pids) await waitFor(async () => { try { process.kill(pid, 0); return undefined; } catch (error: any) { if (error.code === 'ESRCH') return true; throw error; } });
  await assert.rejects(access(join(f.state, 'codex')), { code: 'ENOENT' }); assert.equal((await f.calls()).filter(inference).length, 0);
});

test('only explicit auth verify invokes a model and a mismatched answer exits unsuccessfully', options, async t => {
  const f = await fixture(t); await f.installFake('codex', true);
  const status = json(await f.run(['auth', 'status', 'codex'])); assert.equal(status.ready, true);
  json(await f.run(['setup', 'codex', '--yes'])); assert.equal((await f.calls()).filter(inference).length, 0);
  const verified = json(await f.run(['auth', 'verify', 'codex', '--model', 'fixture-model'])); assert.equal(verified.verified, true); assert.equal(verified.model, 'fixture-model');
  const calls = (await f.calls()).filter(inference); assert.equal(calls.length, 1); assert.ok(calls[0].args.includes('--sandbox')); assert.deepEqual(calls[0].args.slice(-2), ['--model', 'fixture-model']);
  const rejected = await f.run(['auth', 'verify', 'codex'], { INSTRILO_FIXTURE_VERIFY_FAIL: '1' });
  assert.equal(rejected.code, 1); assert.equal(JSON.parse(rejected.stdout).verified, false); assert.equal((await f.calls()).filter(inference).length, 2);
});


test('connect refuses to overwrite a project edited while official login is pending', options, async t => {
  const f = await fixture(t); await f.installFake('codex');
  const { dir } = await createProject(f.root, { name: 'concurrent-connect' });
  const manifest = join(dir, 'agent-studio.yaml'), release = join(f.root, 'release-login');
  const pending = f.start(['connect', 'codex', dir, '--role', 'judge', '--yes'], { INSTRILO_FIXTURE_LOGIN_RELEASE: release });
  await waitFor(async () => (await f.calls()).some(login) ? true : undefined);
  const changed = parse(await readFile(manifest, 'utf8')); changed.description = 'Concurrent project owner edit';
  await writeFile(manifest, stringify(changed)); await writeFile(release, 'finish');
  const result = await pending.result; assert.equal(result.code, 1); assert.match(result.stderr, /changed|hash/i);
  const retained = parse(await readFile(manifest, 'utf8')); assert.equal(retained.description, changed.description);
  assert.equal(retained.roles.judge, changed.roles.judge); assert.equal(retained.connections.codex, undefined);
});
