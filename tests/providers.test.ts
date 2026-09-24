import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildCliInvocation, diagnoseConnection, generate, providerCapabilities, resolveAuth } from '../src/providers.js';
import type { Connection, ProviderKind } from '../src/types.js';

const request = { system: 'Be precise.', prompt: 'Return a greeting.' };
async function fixture(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>) {
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk.toString();
    await handler(req, res, body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
function json(res: ServerResponse, value: unknown, status = 200) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); }
function config(baseUrl: string, kind: ProviderKind = 'gateway'): Connection { return { kind, model: 'test-model', baseUrl, auth: { type: 'none' }, timeoutMs: 1000 }; }

test('OpenAI uses environment auth, JSON mode and native completion-token field', async () => {
  process.env.NB_TEST_KEY = 'test-secret';
  const server = await fixture((req, res, body) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer test-secret');
    const data = JSON.parse(body);
    assert.equal(data.max_completion_tokens, 31);
    assert.deepEqual(data.response_format, { type: 'json_object' });
    assert.match(data.messages[0].content, /Return only valid JSON/);
    json(res, { model: 'actual-model', choices: [{ message: { content: [{ type: 'text', text: '{"hello":"world"}' }] }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8 } });
  });
  try {
    const output = await generate({ ...config(`${server.url}/v1`, 'openai'), auth: { type: 'api-key', env: 'NB_TEST_KEY' } }, { ...request, maxOutputTokens: 31, json: true });
    assert.equal(output.text, '{"hello":"world"}');
    assert.equal(output.model, 'actual-model');
    assert.deepEqual(output.usage, { inputTokens: 12, outputTokens: 8 });
  } finally { delete process.env.NB_TEST_KEY; await server.close(); }
});

test('Anthropic sends Messages protocol and parses text blocks', async () => {
  process.env.NB_TEST_ANTHROPIC_KEY = 'anthropic-secret';
  const server = await fixture((req, res, body) => {
    assert.equal(req.url, '/v1/messages');
    assert.equal(req.headers['x-api-key'], 'anthropic-secret');
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers['anthropic-version'], '2023-06-01');
    const data = JSON.parse(body);
    assert.equal(data.system, request.system);
    assert.equal(data.max_tokens, 2048);
    json(res, { content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Hello' }], usage: { input_tokens: 4, output_tokens: 2 } });
  });
  try {
    const output = await generate({ ...config(`${server.url}/v1`, 'anthropic'), auth: { type: 'api-key', env: 'NB_TEST_ANTHROPIC_KEY' } }, request);
    assert.equal(output.text, 'Hello'); assert.deepEqual(output.usage, { inputTokens: 4, outputTokens: 2 });
  } finally { delete process.env.NB_TEST_ANTHROPIC_KEY; await server.close(); }
});

test('bearer-env supports a gateway JWT without treating it as a user session token', async () => {
  process.env.NB_TEST_BEARER = 'header.payload.signature';
  try {
    assert.deepEqual(await resolveAuth({ ...config('https://example.com/v1'), auth: { type: 'bearer-env', env: 'NB_TEST_BEARER' } }), { authorization: 'Bearer header.payload.signature' });
  } finally { delete process.env.NB_TEST_BEARER; }
});

test('client credentials cache distinguishes complete grants and rotated secrets, and expires', async t => {
  let calls = 0;
  const server = await fixture((req, res, body) => {
    calls++;
    assert.equal(req.url, '/oauth/token');
    const form = new URLSearchParams(body);
    assert.equal(form.get('grant_type'), 'client_credentials');
    assert.equal(form.get('client_id'), 'client-id');
    json(res, { access_token: `token-${calls}`, token_type: 'Bearer', expires_in: 3600 });
  });
  process.env.NB_TEST_CLIENT = 'client-id'; process.env.NB_TEST_CLIENT_SECRET = 'secret-one';
  const connection: Connection = { ...config(`${server.url}/v1`), auth: { type: 'oauth-client-credentials', tokenUrl: `${server.url}/oauth/token`, clientIdEnv: 'NB_TEST_CLIENT', clientSecretEnv: 'NB_TEST_CLIENT_SECRET', scope: 'read', audience: 'one' } };
  try {
    assert.deepEqual(await resolveAuth(connection), { authorization: 'Bearer token-1' });
    await resolveAuth(connection); assert.equal(calls, 1);
    await resolveAuth({ ...connection, auth: { ...connection.auth, audience: 'two' } }); assert.equal(calls, 2);
    await resolveAuth({ ...connection, auth: { ...connection.auth, scope: 'write' } }); assert.equal(calls, 3);
    process.env.NB_TEST_CLIENT_SECRET = 'secret-two'; await resolveAuth(connection); assert.equal(calls, 4);
    const later = Date.now() + 3_600_001;
    t.mock.method(Date, 'now', () => later);
    await resolveAuth(connection); assert.equal(calls, 5);
  } finally { t.mock.restoreAll(); delete process.env.NB_TEST_CLIENT; delete process.env.NB_TEST_CLIENT_SECRET; await server.close(); }
});

test('diagnostics validate configuration without token exchanges or model calls', async () => {
  let calls = 0;
  const server = await fixture((_req, res) => { calls++; json(res, {}); });
  process.env.NB_TEST_CLIENT = 'id'; process.env.NB_TEST_CLIENT_SECRET = 'secret';
  try {
    const result = await diagnoseConnection({ ...config(server.url), auth: { type: 'oauth-client-credentials', tokenUrl: `${server.url}/oauth`, clientIdEnv: 'NB_TEST_CLIENT', clientSecretEnv: 'NB_TEST_CLIENT_SECRET' } });
    assert.equal(result.ok, true); assert.match(result.message, /not verified/); assert.equal(calls, 0);
    assert.equal((await diagnoseConnection({ ...config(server.url), auth: { type: 'api-key', env: 'NB_TEST_MISSING_KEY' } })).ok, false);
  } finally { delete process.env.NB_TEST_CLIENT; delete process.env.NB_TEST_CLIENT_SECRET; await server.close(); }
});

test('HTTP failures, success error envelopes, empty and truncated output fail closed without exposing upstream secrets', async () => {
  const outputs = [
    { status: 401, body: { error: 'secret-example-value' } },
    { status: 200, body: { error: { message: 'secret-example-value' } } },
    { status: 200, body: { choices: [{ message: { content: '' } }] } },
    { status: 200, body: { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] } },
  ];
  const server = await fixture((_req, res) => { const next = outputs.shift()!; json(res, next.body, next.status); });
  try {
    for (let i = 0; i < 4; i++) await assert.rejects(generate(config(server.url), request), (error: unknown) => error instanceof Error && !error.message.includes('secret-example-value'));
  } finally { await server.close(); }
});

test('transport rejects redirects, plaintext remote URLs and inline URL credentials', async () => {
  let redirected = false;
  const server = await fixture((req, res) => { if (req.url?.includes('redirected')) redirected = true; res.writeHead(302, { location: '/redirected' }); res.end(); });
  try {
    await assert.rejects(generate(config(server.url), request), /could not connect/);
    assert.equal(redirected, false);
    await assert.rejects(generate(config('http://example.com/v1'), request), /HTTPS/);
    await assert.rejects(generate(config('https://user:password@example.com/v1'), request), /credentials/);
    await assert.rejects(generate(config('https://example.com/v1?key=secret'), request), /query/);
  } finally { await server.close(); }
});

test('request timeout and caller cancellation abort HTTP operations', async () => {
  const server = await fixture((_req, _res) => { /* Deliberately keep the response pending. */ });
  try {
    await assert.rejects(generate({ ...config(server.url), timeoutMs: 40 }, request), /cancelled or timed out/);
    const controller = new AbortController();
    const promise = generate(config(server.url), { ...request, signal: controller.signal });
    controller.abort();
    await assert.rejects(promise, /cancelled or timed out/);
  } finally { await server.close(); }
});

test('large API responses are bounded', async () => {
  const server = await fixture((_req, res) => json(res, { choices: [{ message: { content: 'a'.repeat(4 * 1024 * 1024) } }] }));
  try { await assert.rejects(generate(config(server.url), request), /size limit/); }
  finally { await server.close(); }
});

test('CLI invocations are read-only/tool-disabled and leave login to the provider', () => {
  const codex = buildCliInvocation('codex-cli', request);
  assert.equal(codex.args[codex.args.indexOf('--sandbox') + 1], 'read-only');
  assert(codex.args.includes('approval_policy="never"'));
  assert(codex.args.includes('--ignore-user-config'));
  assert.match(codex.stdin, /Return a greeting/);
  for (const kind of ['claude-code', 'grok-cli'] as const) {
    const invocation = buildCliInvocation(kind, request);
    assert.equal(invocation.args[invocation.args.indexOf('--tools') + 1], '');
    assert(!invocation.args.includes('--dangerously-skip-permissions'));
    assert(!invocation.args.includes('--bare'));
  }
  assert(buildCliInvocation('grok-cli', request).args.includes('--deny'));
});

test('installed CLI contract is exercised with fake executables, never a live model', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nb-provider-test-'));
  const previousPath = process.env.PATH;
  const script = `#!${process.execPath}\nif (process.argv.includes('--version')) { console.log('fixture 1.0.0'); } else if (process.argv.includes('status')) { console.log(process.argv.includes('auth') ? JSON.stringify({loggedIn:true,authMethod:'oauth'}) : 'Logged in using ChatGPT'); } else { process.stdin.resume(); process.stdin.on('end', () => { if (process.env.NB_FAKE_HANG) setInterval(() => {}, 1000); else if (process.env.NB_FAKE_BIG) process.stdout.write('x'.repeat(5 * 1024 * 1024)); else process.stdout.write(process.env.NB_FAKE_OUTPUT || ''); }); }\n`;
  for (const command of ['codex', 'claude', 'grok']) await writeFile(join(directory, command), script, { mode: 0o755 });
  process.env.PATH = `${directory}:${previousPath}`;
  try {
    for (const kind of ['codex-cli', 'claude-code', 'grok-cli'] as const) {
      const connection: Connection = { kind, auth: { type: 'none' }, timeoutMs: 1000 };
      process.env.NB_FAKE_OUTPUT = kind === 'codex-cli'
        ? '{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}\n{"type":"turn.completed","usage":{"input_tokens":4,"output_tokens":2}}\n'
        : '{"type":"result","result":"hello","usage":{"input_tokens":4,"output_tokens":2}}';
      assert.equal((await diagnoseConnection(connection)).ok, kind !== 'grok-cli');
      const output = await generate(connection, request);
      assert.equal(output.text, 'hello'); assert.deepEqual(output.usage, { inputTokens: 4, outputTokens: 2 });
      process.env.NB_FAKE_OUTPUT = kind === 'codex-cli' ? '{"type":"turn.failed","error":{"message":"do-not-echo-secret"}}' : '{"type":"result","is_error":true,"result":"do-not-echo-secret"}';
      await assert.rejects(generate(connection, request), (error: unknown) => error instanceof Error && !error.message.includes('do-not-echo-secret'));
      process.env.NB_FAKE_OUTPUT = '{}';
      await assert.rejects(generate(connection, request), /no assistant text/);
    }
    process.env.NB_FAKE_HANG = '1';
    await assert.rejects(generate({ kind: 'claude-code', auth: { type: 'none' }, timeoutMs: 70 }, request), /cancelled or timed out/);
    delete process.env.NB_FAKE_HANG;
    process.env.NB_FAKE_OUTPUT = '{bad json';
    await assert.rejects(generate({ kind: 'claude-code', auth: { type: 'none' } }, request), /invalid JSON/);
    process.env.NB_FAKE_BIG = '1';
    await assert.rejects(generate({ kind: 'claude-code', auth: { type: 'none' } }, request), /size limit/);
  } finally {
    process.env.PATH = previousPath;
    delete process.env.NB_FAKE_OUTPUT; delete process.env.NB_FAKE_HANG; delete process.env.NB_FAKE_BIG;
    await rm(directory, { recursive: true, force: true });
  }
});

test('demo is explicitly marked, deterministic and does not invent judgement scores or usage', async () => {
  const connection: Connection = { kind: 'demo', auth: { type: 'none' } };
  const first = await generate(connection, { ...request, json: true });
  const second = await generate(connection, { ...request, json: true });
  assert.equal(first.text, second.text);
  const data = JSON.parse(first.text);
  assert.equal(data.demo, true); assert.equal(data.score, undefined); assert.equal(first.usage, undefined);
  assert(providerCapabilities.every(capability => capability.notes.length > 0));
});

test('provider cancellation and timeout kill a CLI descendant that ignores SIGTERM', { skip: process.platform === 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'nb-provider-tree-'));
  const previousPath = process.env.PATH;
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  process.env.PATH = `${directory}:${previousPath}`;
  try {
    for (const mode of ['cancel', 'timeout']) {
      const launcherReady = join(directory, `${mode}-launcher`);
      const ready = join(directory, `${mode}-ready`);
      const probe = join(directory, `${mode}-probe`);
      const marker = join(directory, `${mode}-late-write`);
      const descendant = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{if(fs.existsSync(${JSON.stringify(probe)}))fs.writeFileSync(${JSON.stringify(marker)},'escaped cancellation');},10);`;
      const launcher = `#!${process.execPath}\nprocess.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(launcherReady)},String(process.pid));require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});process.stdin.resume();setInterval(()=>{},1000);\n`;
      await writeFile(join(directory, 'claude'), launcher, { mode: 0o755 });
      const controller = new AbortController();
      const timeoutController = new AbortController();
      // Two Node processes may take longer than 350 ms to start on a busy CI runner.
      // Gate this test's deadline on readiness, then expire it using the real timer.
      const timeoutMock = mode === 'timeout' ? t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
        assert.equal(milliseconds, 350);
        return timeoutController.signal;
      }) : undefined;
      let settled = false;
      const result = generate({ kind: 'claude-code', auth: { type: 'none' }, timeoutMs: mode === 'timeout' ? 350 : 30_000 }, { ...request, signal: controller.signal }).then(
        () => ({ error: undefined }), error => ({ error }),
      ).finally(() => { settled = true; });
      let completionTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        let childReady = false;
        const readinessDeadline = Date.now() + 10_000;
        while (!settled && Date.now() < readinessDeadline) {
          try { await access(ready); childReady = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); }
        }
        assert(childReady, `The ${mode} child must start before checking cancellation (10 second startup budget)`);
        if (mode === 'cancel') controller.abort();
        else {
          assert.equal(timeoutMock!.mock.callCount(), 1, 'The provider must request its configured timeout.');
          const timeout = realTimeout(350);
          timeout.addEventListener('abort', () => timeoutController.abort(timeout.reason), { once: true });
        }
        const outcome = await Promise.race([result, new Promise<never>((_resolve, reject) => {
          completionTimer = setTimeout(() => reject(new Error(`Provider did not finish after ${mode}`)), 5000);
        })]);
        assert(outcome.error instanceof Error && /cancelled or timed out/.test(outcome.error.message));
        // Only invite the late write after termination has completed, so slow startup
        // cannot write the failure marker before cancellation is even requested.
        await writeFile(probe, 'check for a surviving descendant');
        await new Promise(resolve => setTimeout(resolve, 950));
        await assert.rejects(access(marker), { code: 'ENOENT' });
      } finally {
        clearTimeout(completionTimer);
        timeoutMock?.mock.restore();
        controller.abort();
        try { process.kill(-Number(await readFile(launcherReady, 'utf8')), 'SIGKILL'); } catch { /* Already terminated. */ }
        try { process.kill(Number(await readFile(ready, 'utf8')), 'SIGKILL'); } catch { /* Already terminated. */ }
        await result;
      }
    }
  } finally { process.env.PATH = previousPath; await rm(directory, { recursive: true, force: true }); }
});
