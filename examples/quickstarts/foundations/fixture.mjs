/** Deterministic, loopback-only tutorial service. No model, account or cloud calls.
 * Commands: serve STATE, wait STATE, files STATE DIRECTORY, stats STATE.
 * A random available port avoids collisions. The shell owns and stops this process.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const [command, filename, directory] = process.argv.slice(2);
if (!filename || !['serve', 'wait', 'files', 'stats'].includes(command)) throw new Error('Use serve|wait|files|stats STATE [DIRECTORY].');
const statePath = resolve(filename);
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const readState = async () => JSON.parse(await readFile(statePath, 'utf8'));
if (command === 'serve') {
  const counts = { builder: 0, runtime: 0, judge: 0, token: 0, toolModel: 0, lookup: 0 };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') return json(res, { ready: true, fixture: true });
      if (req.method === 'GET' && url.pathname === '/stats') return json(res, counts);
      if (req.method === 'GET' && url.pathname === '/lookup') {
        assert.equal(url.searchParams.get('orderId'), 'ORD-1042'); counts.lookup++;
        return json(res, { orderId: 'ORD-1042', status: 'shipped', tracking: 'LOCAL-123' });
      }
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) throw new Error('Request too large.'); }
      if (req.method === 'POST' && url.pathname === '/oauth/token') {
        const form = new URLSearchParams(body);
        assert.equal(form.get('grant_type'), 'client_credentials');
        assert.equal(form.get('client_id'), 'tutorial-client'); assert.equal(form.get('client_secret'), 'tutorial-client-secret');
        assert.equal(form.get('scope'), 'tutorial:judge'); assert.equal(form.get('audience'), 'tutorial-gateway');
        counts.token++; return json(res, { access_token: 'tutorial-oauth-token', token_type: 'Bearer', expires_in: 300 });
      }
      assert.equal(req.method, 'POST'); assert.equal(url.pathname, '/v1/chat/completions');
      const payload = JSON.parse(body); let message;
      if (payload.model === 'tutorial-builder') {
        assert.equal(req.headers.authorization, 'Bearer tutorial-api-key'); counts.builder++;
        message = { role: 'assistant', content: JSON.stringify({ description: 'A return-policy assistant for a tutorial shop.', systemPrompt: 'Answer return-policy questions using the supplied guidance. Returns are accepted within 30 days. Ask a human when evidence is missing.', questions: [], rationale: 'Deterministic fixture: demonstrates builder transport and JSON validation only.' }) };
      } else if (payload.model === 'tutorial-judge') {
        assert.equal(req.headers.authorization, 'Bearer tutorial-oauth-token'); counts.judge++;
        const assessment = JSON.parse(payload.messages.at(-1).content);
        const passed = assessment.output.includes('30 days');
        message = { role: 'assistant', content: JSON.stringify({ score: passed ? 1 : 0, rationale: 'Deterministic fixture checks the literal phrase 30 days; this is not an LLM quality judgment.' }) };
      } else if (payload.model === 'tutorial-tool') {
        assert.equal(req.headers.authorization, 'Bearer tutorial-bearer'); counts.toolModel++;
        const result = payload.messages.findLast(item => item.role === 'tool');
        if (!result) {
          assert.ok(payload.tools.some(item => item.function.name === 'lookup_order'));
          message = { role: 'assistant', content: null, tool_calls: [{ id: 'tutorial-call-1', type: 'function', function: { name: 'lookup_order', arguments: JSON.stringify({ orderId: 'ORD-1042' }) } }] };
        } else {
          const order = JSON.parse(result.content); assert.equal(order.status, 'shipped');
          message = { role: 'assistant', content: `Order ${order.orderId} is ${order.status}. Tracking: ${order.tracking}.` };
        }
      } else {
        assert.equal(payload.model, 'tutorial-runtime'); assert.equal(req.headers.authorization, 'Bearer tutorial-bearer'); counts.runtime++;
        message = { role: 'assistant', content: 'Fixture answer: returns are accepted within 30 days.' };
      }
      json(res, { id: 'tutorial-completion', object: 'chat.completion', model: payload.model, choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 8 } });
    } catch (error) { json(res, { error: { message: 'Tutorial fixture rejected the request: ' + error.message } }, 400); }
  });
  server.requestTimeout = 5000;
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ baseUrl: `http://127.0.0.1:${server.address().port}`, fixture: true }), { flag: 'wx', mode: 0o600 });
  const stop = () => { server.closeAllConnections(); server.close(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  setTimeout(stop, 15 * 60_000).unref();
} else if (command === 'wait') {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const state = await readState(); const response = await fetch(state.baseUrl + '/health', { signal: AbortSignal.timeout(500) }); assert.equal((await response.json()).fixture, true); ready = true; break; }
    catch { await new Promise(done => setTimeout(done, 100)); }
  }
  assert.ok(ready, 'Tutorial fixture did not become ready in ten seconds.'); console.log('Local deterministic fixture is ready.');
} else if (command === 'files') {
  if (!directory) throw new Error('files requires an output directory.');
  const { baseUrl } = await readState(); await mkdir(directory, { recursive: true });
  const gateway = model => ({ kind: 'gateway', model, baseUrl: baseUrl + '/v1', auth: { type: 'bearer-env', env: 'INSTRILO_TUTORIAL_BEARER' } });
  const files = {
    'builder.json': { kind: 'openai', model: 'tutorial-builder', baseUrl: baseUrl + '/v1', auth: { type: 'api-key', env: 'INSTRILO_TUTORIAL_API_KEY' } },
    'runtime.json': gateway('tutorial-runtime'),
    'tool-runtime.json': gateway('tutorial-tool'),
    'judge.json': { kind: 'gateway', model: 'tutorial-judge', baseUrl: baseUrl + '/v1', auth: { type: 'oauth-client-credentials', tokenUrl: baseUrl + '/oauth/token', clientIdEnv: 'INSTRILO_TUTORIAL_CLIENT_ID', clientSecretEnv: 'INSTRILO_TUTORIAL_CLIENT_SECRET', scope: 'tutorial:judge', audience: 'tutorial-gateway' } },
    'lookup-tool.json': { name: 'lookup_order', description: 'Read the tutorial order status. This endpoint only contains synthetic tutorial data.', kind: 'http', url: baseUrl + '/lookup', method: 'GET', requiresApproval: false, requiredScopes: [], inputSchema: { type: 'object', properties: { orderId: { type: 'string', enum: ['ORD-1042'] } }, required: ['orderId'], additionalProperties: false } },
  };
  for (const [name, value] of Object.entries(files)) await writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  console.log('Wrote five connection/tool documents using the fixture’s actual loopback port.');
} else {
  const { baseUrl } = await readState(); const response = await fetch(baseUrl + '/stats', { signal: AbortSignal.timeout(5000) }); assert.ok(response.ok); console.log(JSON.stringify(await response.json(), null, 2));
}
