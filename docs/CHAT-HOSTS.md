# Connect the generated agent to a chat host

Hosting runs the agent. A chat-host connection lets a client discover and invoke it. Building a project creates source and configuration examples; it does not deploy, publish, register an OAuth client, or install a connection into an account.

| Surface | Generated entrypoint | Connection |
| --- | --- | --- |
| Codex, Claude Code, Claude Desktop | `mcp_server.py` or `mcp_server.ts` | Local MCP over stdio; adapt the files under `hosts/` with absolute paths |
| ChatGPT, or another remote MCP client | `mcp_http.py` or `mcp_http.ts` | Authenticated Streamable HTTP at a public HTTPS `/mcp` URL |
| Direct HTTP callers and default cloud runtime | `server.py` or `server.ts` | JSON `POST /invocations`; this is a separate REST interface |

The remote entrypoint is emitted when `delivery.hosts` contains `chatgpt`. Keep the stdio entrypoint for local Claude Desktop use. The local process inherits its operator's environment, so review the project and its tools before configuring a host to launch it. Runtime model credentials belong in the server environment or a secret manager. Connecting ChatGPT or Claude Desktop does not supply model-provider credentials to a hosted agent.

## Configure the remote resource

Choose a stable resource URL, for example `https://agents.example.com/mcp`. In the source manifest, configure:

```yaml
security:
  inbound:
    mode: jwt
    issuer: https://identity.example.com/
    audience: https://agents.example.com/mcp
    jwksUrl: https://identity.example.com/.well-known/jwks.json
    algorithms: [RS256]
  requiredScopes: [agent:run]
```

Use your identity provider's actual issuer and JWKS URL. Add any `tenantClaim` only when your identity model uses one. Its presence check does not implement tenant-specific data filtering; tool backends must enforce data access rules. Rebuild after changing the source manifest.

The generated server requires `PUBLIC_MCP_URL` to equal the configured JWT audience and end exactly with `/mcp`. Start from the generated project directory:

```sh
# Python
PUBLIC_MCP_URL=https://agents.example.com/mcp uv run python mcp_http.py

# TypeScript, after npm install
PUBLIC_MCP_URL=https://agents.example.com/mcp npm run mcp:http
```

`HOST` and `PORT` control the listen address. Terminate TLS at your hosting ingress and preserve the public `Host` header. The application rejects any other host and does not trust forwarded-host headers. Health checks use `GET /ping` with the same public host. Cloud hosting scripts default to the REST service; use `Dockerfile.mcp` and a separate endpoint when deploying this MCP entrypoint.

Requests without an Origin header, such as server clients, are accepted after the usual authentication checks. Browser origins must match the public origin or a comma-separated `MCP_ALLOWED_ORIGINS` allowlist. Wildcards are not supported. For isolated local tests, `MCP_ALLOW_LOCAL_HTTP=1` permits HTTP only for literal loopback public, issuer and JWKS URLs. It never disables JWT verification.

## Set up OAuth and connect the account

The remote adapter is an OAuth resource server. It advertises the configured external issuer through `/.well-known/oauth-protected-resource/mcp`, also available at `/.well-known/oauth-protected-resource`, and through `WWW-Authenticate` challenges. It does not proxy issuer metadata or issue tokens.

Configure the external authorization server with discovery metadata, authorization-code flow with PKCE `S256`, and a client-registration method supported by the destination host. It must bind the requested resource to the access token's audience. Use the exact callback URL presented by the host's connection setup. These are identity-provider tasks; see [OpenAI's authentication requirements](https://developers.openai.com/plugins/build/auth).

In a supported ChatGPT account, enable Developer mode under Settings → Security and login, then use the plus button in [ChatGPT Plugins](https://chatgpt.com/plugins) to add the public `/mcp` connection. Complete OAuth and inspect the discovered `invoke_agent` tool. Workspace policy may limit availability. Start a conversation with the connection enabled and test representative inputs. Refresh the connection after changing tool metadata. See [the current connection and testing guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

## Permissions and protocol behavior

Every MCP request requires a verified bearer JWT with an allowed asymmetric signature, issuer, audience, expiration and subject. Global required scopes are checked before MCP dispatch; individual tool scopes are checked again by the generated runtime. Advertised OAuth scopes include both sets.

The token's optional `agent_approvals` claim is an array of lowercase SHA-256 digests for exact tool-name/argument pairs. These verified values reach the runtime approval checks. Tool arguments accept only `input`; request JSON, MCP metadata, and server environment variables cannot grant remote scopes or approvals. A host confirmation click does not mint an approval claim. Approval-sensitive tools need a trusted review/issuance workflow; add an application ledger if approvals must be single-use, because digest claims can be reused until their token expires.

Each HTTP request gets a fresh MCP server, transport and verified identity. The adapter supports JSON MCP POST responses and rejects session IDs and persistent GET streams. It returns the agent output and optional usage, without internal traces. Input bodies are bounded at 128 KB and the input string at 100,000 characters. Tool execution respects the generated runtime's step and timeout limits.

## Verification performed

Both adapters were tested locally with real MCP SDK transports, a local JWKS server and signed test JWTs. Checks covered initialization, tool discovery/invocation, OAuth metadata, incorrect audience and scopes, Host/Origin rejection, bounded payloads, environment-permission isolation, verified approval propagation and sanitized errors. TypeScript was checked in strict mode. SDK versions exercised: `@modelcontextprotocol/sdk` 1.30.1 and Python `mcp` 1.30.0 and 1.28.1. CrewAI's dependency constraints use the tested 1.28.1 line.

The initial protocol fixture used a stub agent and did not call a model. No ChatGPT account connection, OAuth consent screen, public TLS deployment or cloud resource was created during these checks. Those end-to-end deployment checks remain necessary for a real account and identity provider.

The reproducible optional suite is `tests/mcp-http-smoke.mjs`. It is separate from `npm test` because it needs both language environments. After installing the repository dependencies with `npm install`, prepare isolated smoke dependencies:

```sh
MCP_SMOKE_DEPS=$(mktemp -d)
npm install --prefix "$MCP_SMOKE_DEPS/node" @modelcontextprotocol/sdk@1.30.1 jose@6 @types/node@22
python3 -m venv "$MCP_SMOKE_DEPS/venv"
"$MCP_SMOKE_DEPS/venv/bin/python" -m pip install 'mcp==1.30.0' 'PyJWT[crypto]>=2.10,<3' httpx uvicorn
NB_SMOKE_NODE_MODULES="$MCP_SMOKE_DEPS/node/node_modules" \
NB_SMOKE_PYTHON="$MCP_SMOKE_DEPS/venv/bin/python" \
node tests/mcp-http-smoke.mjs
```

Alternatively, reuse dependencies installed by `tests/generator-runtime-smoke.mjs --install`: set `NB_SMOKE_NODE_MODULES` to `$AGENT_SMOKE_ROOT/typescript-native/node_modules` and `NB_SMOKE_PYTHON` to `$AGENT_SMOKE_ROOT/python-native/.venv/bin/python`. The MCP suite creates and removes its own temporary fixtures; `NB_SMOKE_KEEP=1` preserves them for inspection. It reports 35 assertions when successful.
