/** Remote MCP resource server. The configured external issuer owns login and consent. */
import { createServer } from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { runAgent } from './agent.js';
import { SPEC, context } from './runtime.js';

const security = SPEC.security;
const inbound = security.inbound;
const localDevelopment = process.env.MCP_ALLOW_LOCAL_HTTP === '1';
function endpoint(value: string | undefined, name: string): URL {
  if (!value) throw new Error(name + ' is required');
  const url = new URL(value);
  const local = localDevelopment && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || url.search || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error(name + ' must use HTTPS without credentials, query or fragment');
  }
  return url;
}
if (inbound.mode !== 'jwt') throw new Error('Remote MCP requires security.inbound.mode=jwt');
const publicUrl = endpoint(process.env.PUBLIC_MCP_URL, 'PUBLIC_MCP_URL');
if (publicUrl.pathname !== '/mcp') throw new Error('PUBLIC_MCP_URL must end with /mcp');
if (inbound.audience !== publicUrl.href) throw new Error('JWT audience must equal PUBLIC_MCP_URL');
endpoint(inbound.issuer, 'JWT issuer');
const jwksUrl = endpoint(inbound.jwksUrl, 'JWT JWKS URL');
const asymmetricAlgorithms = new Set(['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA']);
if (!Array.isArray(inbound.algorithms) || !inbound.algorithms.length || inbound.algorithms.some((a: string) => !asymmetricAlgorithms.has(a))) throw new Error('Configure asymmetric JWT signature algorithms');
const allowedOrigins = new Set([publicUrl.origin]);
for (const value of (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)) {
  const origin = endpoint(value.trim(), 'MCP_ALLOWED_ORIGINS');
  if (origin.pathname !== '/') throw new Error('MCP_ALLOWED_ORIGINS accepts origins only');
  allowedOrigins.add(origin.origin);
}
const metadataUrl = publicUrl.origin + '/.well-known/oauth-protected-resource/mcp';
const scopes = [...new Set<string>([...security.requiredScopes, ...SPEC.agent.tools.flatMap((tool: any) => tool.requiredScopes)])];
if (scopes.some(scope => !/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(scope))) throw new Error('Invalid OAuth scope');
const metadata = { resource: publicUrl.href, authorization_servers: [inbound.issuer], scopes_supported: scopes, bearer_methods_supported: ['header'] };
const jwks = createRemoteJWKSet(jwksUrl, { timeoutDuration: 5000 });
function challenge(error?: 'invalid_token' | 'insufficient_scope') {
  return 'Bearer resource_metadata="' + metadataUrl + '"' + (scopes.length ? ', scope="' + scopes.join(' ') + '"' : '') + (error ? ', error="' + error + '", error_description="' + (error === 'insufficient_scope' ? 'Additional scopes are required' : 'A valid access token is required') + '"' : '');
}
class AuthFailure extends Error {
  constructor(readonly status: number, readonly code?: 'invalid_token' | 'insufficient_scope') { super('Authorization failed'); }
}
async function authenticate(header: string | undefined): Promise<{ scopes: string[]; approvals: string[] }> {
  if (!header?.startsWith('Bearer ')) throw new AuthFailure(401);
  let payload;
  try {
    ({ payload } = await jwtVerify(header.slice(7), jwks, { issuer: inbound.issuer, audience: inbound.audience, algorithms: inbound.algorithms, requiredClaims: ['exp', 'iss', 'aud', 'sub'] }));
  } catch { throw new AuthFailure(401, 'invalid_token'); }
  const rawScopes = payload.scope ?? payload.scp ?? [];
  const verifiedScopes = typeof rawScopes === 'string' ? rawScopes.split(/\s+/).filter(Boolean) : rawScopes;
  const approvals = payload.agent_approvals ?? [];
  if (!Array.isArray(verifiedScopes) || !verifiedScopes.every(s => typeof s === 'string') || !Array.isArray(approvals) || !approvals.every(a => typeof a === 'string' && /^[a-f0-9]{64}$/.test(a))) throw new AuthFailure(401, 'invalid_token');
  if (!security.requiredScopes.every((s: string) => verifiedScopes.includes(s))) throw new AuthFailure(403, 'insufficient_scope');
  if (security.tenantClaim && !payload[security.tenantClaim]) throw new AuthFailure(403, 'invalid_token');
  return { scopes: verifiedScopes as string[], approvals: approvals as string[] };
}
function agentServer(identity: { scopes: string[]; approvals: string[] }) {
  const server = new Server({ name: SPEC.name, version: '0.1.0' }, { capabilities: { tools: {} } });
  const securitySchemes = [{ type: 'oauth2', scopes }];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
    name: 'invoke_agent', description: SPEC.description || 'Run the configured agent.',
    inputSchema: { type: 'object', properties: { input: { type: 'string', minLength: 1, maxLength: 100000 } }, required: ['input'], additionalProperties: false },
    securitySchemes, _meta: { securitySchemes },
    annotations: { readOnlyHint: SPEC.agent.tools.every((tool: any) => tool.method === 'GET'), destructiveHint: SPEC.agent.tools.some((tool: any) => tool.method !== 'GET'), openWorldHint: true },
  }] }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const args = request.params.arguments;
    if (request.params.name !== 'invoke_agent' || !args || Object.keys(args).some(key => key !== 'input') || typeof args.input !== 'string' || !args.input.trim() || args.input.length > 100000) {
      return { isError: true, content: [{ type: 'text', text: 'Expected invoke_agent with one non-empty input string (maximum 100000 characters).' }] };
    }
    try {
      // Explicit verified arrays prevent environment permissions or request metadata from being inherited.
      const ctx = context(identity.scopes, identity.approvals);
      ctx.signal = AbortSignal.any([ctx.signal, extra.signal]);
      const result = await runAgent(args.input, ctx);
      const output = { output: result.output, ...(result.usage ? { usage: result.usage } : {}) };
      return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'Missing tool scopes') return { isError: true, content: [{ type: 'text', text: 'Additional tool scopes are required.' }], _meta: { 'mcp/www_authenticate': [challenge('insufficient_scope')] } };
      const approval = /^Approval required for exact call SHA256=[a-f0-9]{64}$/.test(message);
      return { isError: true, content: [{ type: 'text', text: approval ? message : 'Agent execution failed; consult protected server logs.' }] };
    }
  });
  return server;
}

const httpServer = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (req.headers.host !== publicUrl.host) return send(421, { error: 'Unexpected Host' });
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) return send(403, { error: 'Origin not allowed' });
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, MCP-Protocol-Version');
    res.writeHead(204); return res.end();
  }
  const path = (req.url ?? '').split('?')[0];
  if (req.method === 'GET' && path === '/ping') return send(200, { status: 'Healthy' });
  if (req.method === 'GET' && ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(path)) return send(200, metadata);
  if (path !== '/mcp') return send(404, { error: 'Not found' });
  let identity;
  try { identity = await authenticate(req.headers.authorization); }
  catch (error) {
    const failure = error instanceof AuthFailure ? error : new AuthFailure(401, 'invalid_token');
    res.setHeader('WWW-Authenticate', challenge(failure.code));
    return send(failure.status, { error: 'Unauthorized' });
  }
  // No shared session, SSE subscription or client-provided session identifier can carry identity across calls.
  if (req.headers['mcp-session-id']) return send(400, { error: 'This server is stateless; omit MCP-Session-Id' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(405, { error: 'Use a stateless MCP POST request' }); }
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return send(415, { error: 'application/json required' });
  let body: unknown;
  try {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 128000) return send(413, { error: 'Request too large' }); chunks.push(chunk); }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return send(400, { error: 'Invalid JSON request' }); }
  const server = agentServer(identity);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, enableDnsRebindingProtection: true, allowedHosts: [publicUrl.host], allowedOrigins: [...allowedOrigins] });
  res.on('close', () => { void server.close().catch(() => {}); });
  try { await server.connect(transport); await transport.handleRequest(req, res, body); }
  catch { if (!res.headersSent) send(500, { error: 'MCP request failed' }); else res.destroy(); }
  finally { await server.close().catch(() => {}); }
});
httpServer.requestTimeout = SPEC.agent.limits.timeoutMs + 10000;
httpServer.headersTimeout = 10000;
httpServer.listen(Number(process.env.PORT ?? SPEC.delivery.port), process.env.HOST ?? (publicUrl.protocol === 'http:' ? '127.0.0.1' : '0.0.0.0'), () => console.error('Authenticated MCP HTTP server started'));
