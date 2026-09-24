import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { Command } from 'commander';
import { browserCommands, expandWebWorkspace, openBrowser, parseWebPort, registerWebCommands } from '../src/cli-web.js';

const cliPath = resolve('src/cli.ts');
const tsxLoader = import.meta.resolve('tsx');
const posix = { skip: process.platform === 'win32', timeout: 20_000 };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function eventually<T>(read: () => Promise<T | undefined>, label: string, timeout = 10_000): Promise<T> {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = await read(); if (value !== undefined) return value; await delay(20); }
  throw new Error(`Timed out waiting for ${label}`);
}
async function fixture(t: TestContext, mode = 'success') {
  const root = await mkdtemp(join(tmpdir(), 'instrilo-web-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'), log = join(root, 'handoff.json');
  await mkdir(bin);
  const source = `#!${process.execPath}
const fs = require('node:fs');
const url = process.argv[2];
if (process.env.INSTRILO_TEST_BROWSER_MODE === 'failure') { console.error('PRIVATE-OPENER-ERROR ' + url); process.exit(17); }
if (process.env.INSTRILO_TEST_BROWSER_MODE === 'wait') { fs.writeFileSync(process.env.INSTRILO_TEST_BROWSER_LOG, JSON.stringify({ pid: process.pid })); setTimeout(() => {}, 30000); }
else (async () => {
  const address = new URL(url);
  const token = new URLSearchParams(address.hash.slice(1)).get('token');
  const response = await fetch(new URL('/api/meta', address), { headers: { 'x-studio-token': token } });
  fs.writeFileSync(process.env.INSTRILO_TEST_BROWSER_LOG, JSON.stringify({ url, pid: process.pid, status: response.status, body: await response.json() }));
  process.exit(response.status === 200 ? 0 : 19);
})().catch(() => process.exit(20));
`;
  for (const name of ['open', 'xdg-open', 'wslview', 'explorer.exe']) await writeFile(join(bin, name), source, { mode: 0o700 });
  const env = { ...process.env, PATH: bin + delimiter + process.env.PATH, INSTRILO_TEST_BROWSER_LOG: log, INSTRILO_TEST_BROWSER_MODE: mode };
  delete env.WSL_DISTRO_NAME; delete env.WSL_INTEROP;
  const record = () => eventually(async () => { try { return JSON.parse(await readFile(log, 'utf8')); } catch { return undefined; } }, 'browser handoff record');
  return { root, bin, log, env, record };
}
async function launch(t: TestContext, f: Awaited<ReturnType<typeof fixture>>, args: string[]) {
  const child = spawn(process.execPath, ['--import', tsxLoader, cliPath, ...args], { cwd: f.root, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', closed = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', code => { closed = true; resolve(code); }); });
  t.after(async () => { if (!closed) { child.kill('SIGKILL'); await exited; } });
  const url = () => eventually(async () => { const value = stdout.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]{64}/)?.[0]; if (!value && closed) throw new Error(`CLI exited before startup: ${stderr || stdout}`); return value; }, 'listening application');
  const stop = async (signal: NodeJS.Signals = 'SIGINT') => {
    child.kill(signal);
    let timer: NodeJS.Timeout;
    try { return await Promise.race([exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Web app did not stop after signal.')), 5000); })]); }
    finally { clearTimeout(timer!); }
  };
  return { child, url, stop, exited, output: () => ({ stdout, stderr }) };
}
async function meta(url: string) {
  const address = new URL(url), token = new URLSearchParams(address.hash.slice(1)).get('token')!;
  return fetch(new URL('/api/meta', address), { headers: { 'x-studio-token': token }, signal: AbortSignal.timeout(3000) });
}

test('web launch defaults are stable and app compatibility defaults remain unchanged', () => {
  const program = new Command(); registerWebCommands(program);
  const web = program.commands.find(command => command.name() === 'web')!;
  const app = program.commands.find(command => command.name() === 'app')!;
  assert.deepEqual(web.opts(), { workspace: '~/Instrilo/projects', port: '0', open: true });
  assert.equal(expandWebWorkspace(web.opts().workspace), join(homedir(), 'Instrilo', 'projects'));
  assert.equal(expandWebWorkspace('~'), homedir());
  assert.equal(expandWebWorkspace('./projects'), './projects');
  assert.ok(!web.helpInformation().includes(homedir()));
  assert.deepEqual(web.commands[0].opts(), web.opts());
  assert.deepEqual(app.opts(), { workspace: '.studio/projects', port: '4317', open: false });
  for (const value of ['', ' ', '-1', '65536', '1.5', '1e3', 'Infinity', '0x10']) assert.throws(() => parseWebPort(value), /whole number/);
  for (const value of ['0', '4317', '65535']) assert.equal(parseWebPort(value), Number(value));
});

test('browser handoffs pass one literal URL argument or a separate Windows environment value', () => {
  const url = 'http://127.0.0.1:1234/#token=literal&$(do-not-execute)';
  assert.deepEqual(browserCommands(url, 'darwin', {}, '')[0].args, [url]);
  assert.deepEqual(browserCommands(url, 'linux', {}, '').map(item => item.command), ['xdg-open']);
  assert.deepEqual(browserCommands(url, 'linux', { WSL_INTEROP: '/fixture' }, '').map(item => item.command), ['wslview', 'explorer.exe', 'xdg-open']);
  const windows = browserCommands(url, 'win32', {}, '')[0];
  assert.equal(windows.env.INSTRILO_BROWSER_URL, url);
  assert.ok(!windows.args.some(arg => arg.includes(url)));
  assert.deepEqual(browserCommands(url, 'aix', {}, ''), []);
});

test('web enable opens the authenticated app only after it is reachable and Ctrl-C stops the server', posix, async t => {
  const f = await fixture(t), p = await launch(t, f, ['web', 'enable', '--workspace', join(f.root, 'projects'), '--port', '0']);
  const url = await p.url(), record = await f.record();
  assert.equal(record.url, url); assert.equal(record.status, 200); assert.ok(record.body.defaultSpec);
  assert.equal((await meta(url)).status, 200);
  assert.match(p.output().stdout, /Keep this terminal open.*Ctrl-C/);
  assert.equal(p.output().stdout.split(url).length - 1, 1);
  assert.equal(await p.stop(), 0);
  await assert.rejects(() => meta(url));
});

test('web shortcut and options before enable support headless use; app stays headless by default', posix, async t => {
  for (const args of [['web', '--no-open'], ['web', '--no-open', '--port', '0', '--workspace', 'before-enable', 'enable'], ['app']]) {
    const f = await fixture(t);
    const command = args.includes('enable') ? args : [...args, '--workspace', join(f.root, 'projects'), '--port', '0'];
    const p = await launch(t, f, command), url = await p.url();
    assert.equal((await meta(url)).status, 200);
    if (args.includes('enable')) assert.match(p.output().stdout, new RegExp(join(f.root, 'before-enable')));
    assert.equal(await p.stop('SIGTERM'), 0);
    await assert.rejects(() => stat(f.log), { code: 'ENOENT' });
  }
});

test('legacy app can explicitly open its browser', posix, async t => {
  const f = await fixture(t), p = await launch(t, f, ['app', '--open', '--workspace', join(f.root, 'projects'), '--port', '0']);
  assert.equal((await f.record()).url, await p.url());
  assert.equal(await p.stop(), 0);
});

test('opener failure keeps the server usable and does not repeat private opener output', posix, async t => {
  const f = await fixture(t, 'failure'), p = await launch(t, f, ['web', 'enable', '--workspace', join(f.root, 'projects')]);
  const url = await p.url();
  await eventually(async () => p.output().stderr.includes('could not be opened automatically') ? true : undefined, 'nonfatal fallback message');
  assert.equal((await meta(url)).status, 200);
  assert.ok(!p.output().stderr.includes(url)); assert.ok(!p.output().stderr.includes('PRIVATE-OPENER-ERROR'));
  assert.equal(await p.stop(), 0);
});

test('invalid ports fail before workspace creation or browser invocation', posix, async t => {
  const f = await fixture(t), workspace = join(f.root, 'never-created');
  const p = await launch(t, f, ['web', 'enable', '--workspace', workspace, '--port', '65536']);
  assert.equal(await p.exited, 1); assert.match(p.output().stderr, /whole number/);
  await assert.rejects(() => stat(workspace), { code: 'ENOENT' });
  await assert.rejects(() => stat(f.log), { code: 'ENOENT' });
});

test('browser helpers have bounded waits and cancellation never terminates a dispatched desktop browser', posix, async t => {
  const f = await fixture(t, 'wait'), controller = new AbortController();
  let helperPid: number | undefined;
  t.after(() => { if (helperPid) { try { process.kill(helperPid, 'SIGKILL'); } catch { /* fixture already exited */ } } });
  const started = Date.now();
  const result = await openBrowser('http://127.0.0.1:1234/#token=fixture', { signal: controller.signal, env: f.env, timeoutMs: 1000 });
  assert.equal(result, 'timed-out'); assert.ok(Date.now() - started < 5000);
  const record = await f.record(); helperPid = record.pid; assert.doesNotThrow(() => process.kill(record.pid, 0));
  controller.abort();
  assert.equal(await openBrowser('http://127.0.0.1:1234/', { signal: controller.signal, env: f.env }), 'cancelled');
  assert.equal(await openBrowser('http://127.0.0.1:1234/', { signal: new AbortController().signal, env: { PATH: join(f.root, 'missing') }, platform: 'linux', osRelease: '' }), 'unavailable');
});
