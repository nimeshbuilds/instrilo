import { createServer } from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { runAgent } from './agent.js';
import { SPEC, context } from './runtime.js';
const security = SPEC.security; const inbound = security.inbound;
const jwks = inbound.mode === 'jwt' ? createRemoteJWKSet(new URL(inbound.jwksUrl)) : null;
async function authenticate(header?: string) {
  if (inbound.mode === 'none') return context([], []);
  if (!header?.startsWith('Bearer ')) throw new Error('Bearer token required');
  const { payload } = await jwtVerify(header.slice(7), jwks!, { issuer: inbound.issuer, audience: inbound.audience, algorithms: inbound.algorithms, requiredClaims: ['exp', 'iss', 'aud', 'sub'] });
  const raw = payload.scope ?? payload.scp ?? []; const scopes = typeof raw === 'string' ? raw.split(/\s+/) : raw;
  if (!Array.isArray(scopes) || !scopes.every(s => typeof s === 'string')) throw new Error('Invalid scope claim');
  if (!security.requiredScopes.every((s: string) => scopes.includes(s))) throw new Error('Missing required scopes');
  if (security.tenantClaim && !payload[security.tenantClaim]) throw new Error('Missing tenant claim');
  const approvals = payload.agent_approvals ?? [];
  if (!Array.isArray(approvals) || !approvals.every(s => typeof s === 'string')) throw new Error('Invalid approvals');
  return context(scopes, approvals as string[]);
}
const host = process.env.HOST ?? (inbound.mode === 'none' ? '127.0.0.1' : '0.0.0.0');
if (inbound.mode === 'none' && !['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.PLATFORM_AUTH !== 'aws-iam') throw new Error('Public binding requires JWT, or PLATFORM_AUTH=aws-iam behind AgentCore IAM');
const port = Number(process.env.PORT ?? SPEC.delivery.port);
const loopbackAuthorities = new Set(['localhost:' + port, '127.0.0.1:' + port, '[::1]:' + port]);
const server = createServer(async (req, res) => {
  const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (req.method === 'GET' && req.url === '/ping') return send(200, { status: 'Healthy' });
  if (req.method !== 'POST' || req.url !== '/invocations') return send(404, { error: 'Not found' });
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return send(415, { error: 'application/json required' });
  if (inbound.mode === 'none' && process.env.PLATFORM_AUTH !== 'aws-iam') {
    if (!loopbackAuthorities.has(req.headers.host ?? '')) return send(403, { error: 'Invalid local Host' });
    const origin = req.headers.origin;
    if (origin && ![...loopbackAuthorities].some(authority => origin === 'http://' + authority)) return send(403, { error: 'Cross-origin requests denied' });
  }
  let ctx;
  try { ctx = await authenticate(req.headers.authorization); } catch { return send(401, { error: 'Unauthorized' }); }
  try {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > 128000) return send(413, { error: 'Request too large' }); chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (Object.keys(body).some(k => k !== 'input')) return send(400, { error: 'Only input is accepted; permissions come from verified identity' });
    send(200, await runAgent(body.input, ctx));
  } catch (error) { console.error(error instanceof Error ? error.name : 'ExecutionError'); send(502, { error: 'Agent execution failed' }); }
});
server.requestTimeout = SPEC.agent.limits.timeoutMs + 5000;
server.listen(port, host, () => console.error('Agent HTTP server started'));
