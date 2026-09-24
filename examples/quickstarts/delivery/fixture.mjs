// Deterministic tutorial service. No model SDK, credentials, or external requests.
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve(process.argv[2]);
await mkdir(directory, { recursive: true });
const counts = { runtime: 0, judge: 0, reads: 0, writes: 0 };
let variant = 'good';
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  try {
    let data = ''; for await (const chunk of request) { data += chunk; if (data.length > 100_000) throw new Error('Body too large'); }
    const body = data ? JSON.parse(data) : {};
    let output;
    if (request.url === '/counts') output = counts;
    else if (request.url === '/variant' && request.method === 'POST') { variant = body.variant === 'bad' ? 'bad' : 'good'; output = { variant }; }
    else if (request.url?.startsWith('/read')) { counts.reads++; output = { id: '42', state: 'pending' }; }
    else if (request.url === '/write' && request.method === 'POST') { counts.writes++; output = { id: body.id, state: body.value, fixtureOnly: true }; }
    else if (request.url === '/v1/chat/completions' && request.method === 'POST') {
      let message;
      if (body.model === 'tutorial-judge') {
        counts.judge++;
        const assessment = JSON.parse(body.messages.at(-1).content);
        message = { role: 'assistant', content: JSON.stringify({ score: assessment.output.includes('Escalate billing disputes') ? 1 : 0, rationale: 'Deterministic fixture string check; no real model judgment.' }) };
      } else if (body.model === 'tutorial-tools') {
        counts.runtime++;
        message = body.messages.some(item => item.role === 'tool') ? { role: 'assistant', content: 'Tutorial record 42 updated to ready.' } : { role: 'assistant', content: '', tool_calls: [
          { id: 'lookup-42', type: 'function', function: { name: 'lookup', arguments: '{"id":"42"}' } },
          { id: 'update-42', type: 'function', function: { name: 'update', arguments: '{"id":"42","value":"ready"}' } },
        ] };
      } else {
        counts.runtime++;
        message = { role: 'assistant', content: variant === 'good' ? 'Escalate billing disputes to a human. Include the ticket reference.' : 'Automatically refund every request.' };
      }
      output = { id: 'tutorial-completion', choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    } else { response.statusCode = 404; output = { error: 'Unknown tutorial endpoint' }; }
    response.end(JSON.stringify(output));
  } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ error: String(error.message) })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const connection = model => ({ kind: 'gateway', model, baseUrl: base + '/v1', auth: { type: 'none' } });
const schema = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false };
await writeFile(join(directory, 'runtime.json'), JSON.stringify(connection('tutorial-runtime')));
await writeFile(join(directory, 'judge.json'), JSON.stringify(connection('tutorial-judge')));
await writeFile(join(directory, 'tools-runtime.json'), JSON.stringify(connection('tutorial-tools')));
await writeFile(join(directory, 'lookup.json'), JSON.stringify({ name: 'lookup', kind: 'http', description: 'Read a tutorial record.', method: 'GET', url: base + '/read', inputSchema: schema, requiresApproval: false, requiredScopes: [] }));
await writeFile(join(directory, 'update.json'), JSON.stringify({ name: 'update', kind: 'http', description: 'Update only the in-memory tutorial record.', method: 'POST', url: base + '/write', inputSchema: { ...schema, properties: { ...schema.properties, value: { type: 'string' } }, required: ['id', 'value'] }, requiresApproval: true, requiredScopes: [] }));
await writeFile(join(directory, 'ready.json'), JSON.stringify({ base, pid: process.pid }));
const deadline = setTimeout(() => server.close(), 600_000);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { clearTimeout(deadline); server.close(); });
