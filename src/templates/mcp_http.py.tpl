"""Stateless MCP resource server; the configured external issuer owns login and consent."""
import json, os, re
from urllib.parse import urlsplit
import anyio
import httpx
import jwt
from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http import StreamableHTTPServerTransport
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from agent import run_agent
from runtime import SPEC, context

security = SPEC["security"]
inbound = security["inbound"]
local_development = os.environ.get("MCP_ALLOW_LOCAL_HTTP") == "1"

def endpoint(value, name):
    if not value: raise RuntimeError(name + " is required")
    url = urlsplit(value)
    local = local_development and url.hostname in ("localhost", "127.0.0.1", "::1")
    if not url.hostname or url.username or url.password or url.query or url.fragment or (url.scheme != "https" and not (local and url.scheme == "http")):
        raise RuntimeError(name + " must use HTTPS without credentials, query or fragment")
    return url

if inbound["mode"] != "jwt": raise RuntimeError("Remote MCP requires security.inbound.mode=jwt")
public_url = os.environ.get("PUBLIC_MCP_URL", "")
public = endpoint(public_url, "PUBLIC_MCP_URL")
if public.path != "/mcp": raise RuntimeError("PUBLIC_MCP_URL must end with /mcp")
if inbound.get("audience") != public_url: raise RuntimeError("JWT audience must equal PUBLIC_MCP_URL")
endpoint(inbound.get("issuer"), "JWT issuer")
endpoint(inbound.get("jwksUrl"), "JWT JWKS URL")
algorithms = inbound.get("algorithms", [])
if not algorithms or not set(algorithms).issubset({"RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"}):
    raise RuntimeError("Configure asymmetric JWT signature algorithms")
public_origin = public.scheme + "://" + public.netloc
allowed_origins = {public_origin}
for value in filter(None, os.environ.get("MCP_ALLOWED_ORIGINS", "").split(",")):
    origin = endpoint(value.strip(), "MCP_ALLOWED_ORIGINS")
    if origin.path not in ("", "/"): raise RuntimeError("MCP_ALLOWED_ORIGINS accepts origins only")
    allowed_origins.add(origin.scheme + "://" + origin.netloc)
metadata_url = public_origin + "/.well-known/oauth-protected-resource/mcp"
scopes = list(dict.fromkeys(security["requiredScopes"] + [scope for tool in SPEC["agent"]["tools"] for scope in tool["requiredScopes"]]))
if any(not re.fullmatch(r'[\x21\x23-\x5B\x5D-\x7E]+', scope) for scope in scopes): raise RuntimeError("Invalid OAuth scope")
metadata = {"resource": public_url, "authorization_servers": [inbound["issuer"]], "scopes_supported": scopes, "bearer_methods_supported": ["header"]}
transport_security = TransportSecuritySettings(enable_dns_rebinding_protection=True, allowed_hosts=[public.netloc], allowed_origins=list(allowed_origins))

class SafeJWKClient(jwt.PyJWKClient):
    """Use bounded HTTPS retrieval without redirects, preserving PyJWT's public-key cache."""
    def fetch_data(self):
        data = None
        try:
            with httpx.Client(timeout=5, follow_redirects=False) as client:
                with client.stream("GET", self.uri) as response:
                    if response.status_code != 200: raise ValueError("JWKS request failed")
                    chunks, size = [], 0
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > 1048576: raise ValueError("JWKS response too large")
                        chunks.append(chunk)
                    data = json.loads(b"".join(chunks))
                    return data
        finally:
            if self.jwk_set_cache is not None: self.jwk_set_cache.put(data)

jwks = SafeJWKClient(inbound["jwksUrl"])

def challenge(error=None):
    value = 'Bearer resource_metadata="' + metadata_url + '"'
    if scopes: value += ', scope="' + " ".join(scopes) + '"'
    if error:
        description = "Additional scopes are required" if error == "insufficient_scope" else "A valid access token is required"
        value += ', error="' + error + '", error_description="' + description + '"'
    return value

class AuthFailure(Exception):
    def __init__(self, status=401, code=None): self.status, self.code = status, code

def authenticate(header):
    if not header or not header.startswith("Bearer "): raise AuthFailure()
    try:
        token = header[7:]
        key = jwks.get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=algorithms, issuer=inbound["issuer"], audience=inbound["audience"], options={"require": ["exp", "iss", "aud", "sub"]})
        raw = claims.get("scope", claims.get("scp", []))
        verified_scopes = raw.split() if isinstance(raw, str) else raw
        approvals = claims.get("agent_approvals", [])
        if not isinstance(verified_scopes, list) or not all(isinstance(s, str) for s in verified_scopes): raise ValueError("Invalid scope claim")
        if not isinstance(approvals, list) or not all(isinstance(a, str) and re.fullmatch(r"[a-f0-9]{64}", a) for a in approvals): raise ValueError("Invalid approval claim")
    except Exception: raise AuthFailure(401, "invalid_token") from None
    if not set(security["requiredScopes"]).issubset(verified_scopes): raise AuthFailure(403, "insufficient_scope")
    if security.get("tenantClaim") and not claims.get(security["tenantClaim"]): raise AuthFailure(403, "invalid_token")
    return verified_scopes, approvals

def agent_server(identity):
    server = Server(SPEC["name"], version="0.1.0")
    security_schemes = [{"type": "oauth2", "scopes": scopes}]

    @server.list_tools()
    async def list_tools():
        return [types.Tool(name="invoke_agent", description=SPEC.get("description") or "Run the configured agent.",
            inputSchema={"type": "object", "properties": {"input": {"type": "string", "minLength": 1, "maxLength": 100000}}, "required": ["input"], "additionalProperties": False},
            securitySchemes=security_schemes, _meta={"securitySchemes": security_schemes},
            annotations=types.ToolAnnotations(readOnlyHint=all(tool["method"] == "GET" for tool in SPEC["agent"]["tools"]), destructiveHint=any(tool["method"] != "GET" for tool in SPEC["agent"]["tools"]), openWorldHint=True))]

    def failure(message, meta=None):
        return types.CallToolResult(isError=True, content=[types.TextContent(type="text", text=message)], _meta=meta)

    @server.call_tool(validate_input=False)
    async def call_tool(name, arguments):
        if name != "invoke_agent" or not isinstance(arguments, dict) or set(arguments) != {"input"} or not isinstance(arguments["input"], str) or not arguments["input"].strip() or len(arguments["input"]) > 100000:
            return failure("Expected invoke_agent with one non-empty input string (maximum 100000 characters).")
        try:
            # Explicit verified arrays prevent environment permissions or request metadata from being inherited.
            result = await run_agent(arguments["input"], context(identity[0], identity[1]))
            output = {"output": result["output"]}
            if result.get("usage") is not None: output["usage"] = result["usage"]
            return types.CallToolResult(content=[types.TextContent(type="text", text=json.dumps(output))], structuredContent=output)
        except Exception as error:
            message = str(error)
            if message == "Missing tool scopes": return failure("Additional tool scopes are required.", {"mcp/www_authenticate": [challenge("insufficient_scope")]})
            if re.fullmatch(r"Approval required for exact call SHA256=[a-f0-9]{64}", message): return failure(message)
            return failure("Agent execution failed; consult protected server logs.")
    return server

async def app(scope, receive, send):
    if scope["type"] == "lifespan":
        while True:
            event = await receive()
            if event["type"] == "lifespan.startup": await send({"type": "lifespan.startup.complete"})
            elif event["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
    if scope["type"] != "http": return
    request = Request(scope, receive)
    headers = {"Cache-Control": "no-store", "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Protocol-Version"}
    async def respond(status, body):
        await JSONResponse(body, status_code=status, headers=headers)(scope, receive, send)
    if request.headers.get("host") != public.netloc: return await respond(421, {"error": "Unexpected Host"})
    origin = request.headers.get("origin")
    if origin and origin not in allowed_origins: return await respond(403, {"error": "Origin not allowed"})
    if origin: headers.update({"Access-Control-Allow-Origin": origin, "Vary": "Origin"})
    if request.method == "OPTIONS":
        headers.update({"Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version"})
        return await Response(status_code=204, headers=headers)(scope, receive, send)
    if request.method == "GET" and request.url.path == "/ping": return await respond(200, {"status": "Healthy"})
    if request.method == "GET" and request.url.path in ("/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"):
        return await respond(200, metadata)
    if request.url.path != "/mcp": return await respond(404, {"error": "Not found"})
    try: identity = await anyio.to_thread.run_sync(authenticate, request.headers.get("authorization"), abandon_on_cancel=True)
    except AuthFailure as error:
        headers["WWW-Authenticate"] = challenge(error.code)
        return await respond(error.status, {"error": "Unauthorized"})
    if request.headers.get("mcp-session-id"): return await respond(400, {"error": "This server is stateless; omit MCP-Session-Id"})
    if request.method != "POST":
        headers["Allow"] = "POST"
        return await respond(405, {"error": "Use a stateless MCP POST request"})
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json": return await respond(415, {"error": "application/json required"})
    chunks, size = [], 0
    try:
        async for chunk in request.stream():
            size += len(chunk)
            if size > 128000: return await respond(413, {"error": "Request too large"})
            chunks.append(chunk)
        body = b"".join(chunks)
        json.loads(body)
    except Exception: return await respond(400, {"error": "Invalid JSON request"})
    body_delivered, started = False, False
    async def replay_receive():
        nonlocal body_delivered
        if not body_delivered:
            body_delivered = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()
    async def response_send(message):
        nonlocal started
        if message["type"] == "http.response.start":
            started = True
            message["headers"] = list(message.get("headers", [])) + [(key.lower().encode(), value.encode()) for key, value in headers.items()]
        await send(message)
    server = agent_server(identity)
    transport = StreamableHTTPServerTransport(mcp_session_id=None, is_json_response_enabled=True, security_settings=transport_security)
    try:
        with anyio.fail_after(SPEC["agent"]["limits"]["timeoutMs"] / 1000 + 5):
            async with transport.connect() as (read, write):
                async with anyio.create_task_group() as group:
                    group.start_soon(server.run, read, write, server.create_initialization_options(), False, True)
                    await transport.handle_request(scope, replay_receive, response_send)
                    group.cancel_scope.cancel()
    except Exception:
        if not started: await respond(500, {"error": "MCP request failed"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "127.0.0.1" if public.scheme == "http" else "0.0.0.0"), port=int(os.environ.get("PORT", SPEC["delivery"]["port"])), proxy_headers=False)
