"""HTTP entrypoint. Never accept scopes/approvals from an unverified request body."""
import os
import jwt
from fastapi import FastAPI, HTTPException, Request
from starlette.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from agent import run_agent
from runtime import SPEC, context

app = FastAPI()
security = SPEC["security"]
inbound = security["inbound"]
jwks = jwt.PyJWKClient(inbound["jwksUrl"]) if inbound["mode"] == "jwt" else None

@app.middleware("http")
async def http_boundary(request, call_next):
    if request.url.path == "/invocations":
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
            return JSONResponse({"error": "application/json required"}, status_code=415)
        if inbound["mode"] == "none" and os.environ.get("PLATFORM_AUTH") != "aws-iam":
            port = str(os.environ.get("PORT", SPEC["delivery"]["port"]))
            authorities = {"localhost:" + port, "127.0.0.1:" + port, "[::1]:" + port}
            if request.headers.get("host", "") not in authorities:
                return JSONResponse({"error": "Invalid local Host"}, status_code=403)
            origin = request.headers.get("origin")
            if origin and origin not in {"http://" + a for a in authorities}:
                return JSONResponse({"error": "Cross-origin requests denied"}, status_code=403)
        if int(request.headers.get("content-length", "0")) > 128000:
            return JSONResponse({"error": "Request too large"}, status_code=413)
    return await call_next(request)

class Invocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input: str

def authenticate(header):
    if inbound["mode"] == "none": return context([], [])
    if not header or not header.startswith("Bearer "): raise HTTPException(401, "Bearer token required")
    token = header[7:]
    try:
        key = jwks.get_signing_key_from_jwt(token).key
        claims = jwt.decode(token, key, algorithms=inbound["algorithms"], issuer=inbound["issuer"], audience=inbound["audience"], options={"require": ["exp", "iss", "aud", "sub"]})
        raw = claims.get("scope", claims.get("scp", []))
        scopes = raw.split() if isinstance(raw, str) else raw
        if not isinstance(scopes, list) or not all(isinstance(s, str) for s in scopes): raise ValueError("invalid scope claim")
        if not set(security["requiredScopes"]).issubset(scopes): raise HTTPException(403, "Missing required scopes")
        if security.get("tenantClaim") and not claims.get(security["tenantClaim"]): raise HTTPException(403, "Missing tenant claim")
        approvals = claims.get("agent_approvals", [])
        if not isinstance(approvals, list) or not all(isinstance(s, str) for s in approvals): raise ValueError("invalid approvals")
        return context(scopes, approvals)
    except HTTPException: raise
    except Exception: raise HTTPException(401, "Invalid bearer token")

@app.get("/ping")
async def ping(): return {"status": "Healthy"}

@app.post("/invocations")
async def invoke(body: Invocation, request: Request):
    ctx = authenticate(request.headers.get("Authorization"))
    try:
        return await run_agent(body.input, ctx)
    except PermissionError as error: raise HTTPException(403, str(error))
    except ValueError as error: raise HTTPException(400, str(error))
    except TimeoutError: raise HTTPException(504, "Agent timeout")
    except Exception: raise HTTPException(502, "Agent execution failed; inspect protected server logs")

if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("HOST", "127.0.0.1" if inbound["mode"] == "none" else "0.0.0.0")
    if inbound["mode"] == "none" and host not in ("127.0.0.1", "localhost", "::1") and os.environ.get("PLATFORM_AUTH") != "aws-iam":
        raise RuntimeError("Public binding requires JWT authentication; AgentCore can explicitly use PLATFORM_AUTH=aws-iam behind IAM")
    uvicorn.run(app, host=host, port=int(os.environ.get("PORT", SPEC["delivery"]["port"])))
