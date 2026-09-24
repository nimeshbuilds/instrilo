"""Shared bounded provider and HTTP-tool runtime. Secrets are read only at runtime."""
import asyncio, hashlib, json, os, signal, time
from pathlib import Path
from urllib.parse import urlparse
import httpx
from jsonschema import Draft7Validator
from session import durable_enabled, durable_step

ROOT = Path(__file__).resolve().parent
SPEC = json.loads((ROOT / "agent-spec.json").read_text())
CONNECTION = SPEC["connections"][SPEC["roles"]["runtime"]]
GUIDANCE = (ROOT / "guidance.md").read_text()
SYSTEM = SPEC["agent"]["systemPrompt"]
if GUIDANCE.strip() and GUIDANCE.strip() not in SYSTEM:
    SYSTEM += "\n\n" + GUIDANCE
MAX_BYTES = 1024 * 1024

def resolve_provider_executable(provider):
    if provider not in ("codex", "claude", "grok"): raise ValueError("Choose codex, claude, or grok.")
    override = os.environ.get("INSTRILO_PROVIDER_HOME")
    if override is not None and (not override or not os.path.isabs(override) or "\0" in override):
        raise ValueError("INSTRILO_PROVIDER_HOME must be an absolute directory path.")
    home = Path.home()
    managed = Path(os.path.abspath(override)) if override else home / ".local/share/instrilo/providers"
    directories = [*os.environ.get("PATH", "").split(os.pathsep), str(managed / "bin"), str(home / ".local/bin"), str(home / ".bun/bin")]
    names = [provider + ".exe", provider + ".cmd", provider] if os.name == "nt" else [provider]
    for directory in dict.fromkeys(directories):
        if not directory or not os.path.isabs(directory): continue
        for name in names:
            path = Path(directory) / name
            try:
                if os.access(path, os.X_OK) and path.is_file(): return str(path)
            except OSError:
                pass
    raise RuntimeError("The " + provider + " CLI was not found. Run instrilo setup " + provider + " to install and sign in.")

def env(name):
    value = os.environ.get(name or "", "")
    # AWS_SECRET_RESOLUTION
    if not value: raise RuntimeError("Missing environment variable: " + str(name))
    return value

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def approval_digest(name, args):
    return hashlib.sha256(canonical({"tool": name, "arguments": args}).encode()).hexdigest()

def context(scopes=None, approvals=None):
    return {"scopes": set(scopes if scopes is not None else os.environ.get("AGENT_SCOPES", "").split()),
            "approvals": set(approvals if approvals is not None else json.loads(os.environ.get("AGENT_APPROVALS_JSON", "[]"))),
            "deadline": time.monotonic() + SPEC["agent"]["limits"]["timeoutMs"] / 1000,
            "trace": [], "tool_calls": 0, "usage_known": False, "usage": {"inputTokens": 0, "outputTokens": 0}}

def remaining(ctx):
    seconds = ctx["deadline"] - time.monotonic()
    if seconds <= 0: raise TimeoutError("Agent timeout exceeded")
    return seconds

def validate_url(url):
    parsed = urlparse(url)
    if parsed.username or parsed.password: raise ValueError("Credentials must not be embedded in URLs")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")):
        raise ValueError("Use HTTPS, or HTTP loopback for local development")
    return url

async def request_json(method, url, ctx, **kwargs):
    if os.environ.get("INSTRILO_REPLAY") == "1": raise RuntimeError("Network dispatch is forbidden during replay")
    validate_url(url)
    async with httpx.AsyncClient(timeout=min(remaining(ctx), CONNECTION.get("timeoutMs", 60000) / 1000), follow_redirects=False) as client:
        async with client.stream(method, url, **kwargs) as response:
            if not 200 <= response.status_code < 300:
                raise RuntimeError("HTTP request failed (" + str(response.status_code) + ")")
            chunks, size = [], 0
            async for chunk in response.aiter_bytes():
                remaining(ctx)
                size += len(chunk)
                if size > MAX_BYTES: raise ValueError("Response exceeds 1 MiB")
                chunks.append(chunk)
            return json.loads(b"".join(chunks))

async def token(ctx):
    auth = CONNECTION["auth"]
    if auth["type"] == "none": return ""
    if auth["type"] in ("api-key", "bearer-env"): return env(auth["env"])
    form = {"grant_type": "client_credentials", "client_id": env(auth["clientIdEnv"]), "client_secret": env(auth["clientSecretEnv"])}
    if auth.get("scope"): form["scope"] = auth["scope"]
    if auth.get("audience"): form["audience"] = auth["audience"]
    result = await request_json("POST", auth["tokenUrl"], ctx, data=form)
    value = result.get("access_token")
    if not isinstance(value, str) or not value: raise RuntimeError("OAuth response has no access_token")
    return value

def base_url():
    return CONNECTION.get("baseUrl", {"openai": "https://api.openai.com/v1", "xai": "https://api.x.ai/v1", "anthropic": "https://api.anthropic.com/v1", "ollama": "http://127.0.0.1:11434/v1"}.get(CONNECTION["kind"], "")).rstrip("/")

async def execute_tool(name, args, ctx):
    remaining(ctx)
    tool = next((t for t in SPEC["agent"]["tools"] if t["name"] == name), None)
    if tool is None: raise ValueError("Unknown tool")
    Draft7Validator(tool["inputSchema"]).validate(args)
    if not set(tool["requiredScopes"]).issubset(ctx["scopes"]): raise PermissionError("Missing tool scopes")
    digest = approval_digest(name, args)
    if not durable_enabled and tool["requiresApproval"] and digest not in ctx["approvals"]:
        raise PermissionError("Approval required for exact call SHA256=" + digest)
    if ctx["tool_calls"] >= SPEC["agent"]["limits"]["maxSteps"]: raise RuntimeError("Tool call budget exhausted")
    ctx["tool_calls"] += 1
    if tool["requiresApproval"]: ctx["approvals"].discard(digest)
    async def dispatch():
        headers = {"Authorization": "Bearer " + env(tool["authEnv"])} if tool.get("authEnv") else {}
        kwargs = {"params": {k: str(v) if not isinstance(v, (dict, list)) else canonical(v) for k, v in args.items()}} if tool["method"] == "GET" else {"json": args}
        value = await request_json(tool["method"], tool["url"], ctx, headers=headers, **kwargs)
        ctx["trace"].append({"event": "tool", "name": name, "approvalDigest": digest, "status": "ok"})
        return value
    return await durable_step("tool", {"name": name, "arguments": args}, dispatch)

async def model_step(messages, ctx):
    prior = dict(ctx["usage"])
    async def dispatch():
        before = dict(ctx["usage"])
        message = await live_model_step(messages, ctx)
        return {"message": message, "usageKnown": ctx["usage_known"], "usage": {"inputTokens": ctx["usage"]["inputTokens"] - before["inputTokens"], "outputTokens": ctx["usage"]["outputTokens"] - before["outputTokens"]}}
    packet = await durable_step("model", {"messages": messages}, dispatch)
    ctx["usage_known"] = packet["usageKnown"]
    ctx["usage"] = {"inputTokens": prior["inputTokens"] + packet["usage"]["inputTokens"], "outputTokens": prior["outputTokens"] + packet["usage"]["outputTokens"]}
    return packet["message"]

async def live_model_step(messages, ctx):
    """Return a normalized Chat Completions-style assistant message."""
    remaining(ctx)
    kind = CONNECTION["kind"]
    if kind == "demo": return {"role": "assistant", "content": "[DEMO ONLY] " + str(messages[-1].get("content", ""))}
    if kind in ("codex-cli", "claude-code", "grok-cli"):
        if SPEC["agent"]["tools"]: raise ValueError("CLI runtime does not implement portable HTTP tool calls")
        commands = {
            "codex-cli": ["codex", "exec", "--json", "--sandbox", "read-only", "-c", 'approval_policy="never"', "--ignore-user-config", "--skip-git-repo-check", "--ephemeral", "-"],
            "claude-code": ["claude", "-p", "--output-format", "json", "--tools", "", "--safe-mode", "--no-session-persistence", "--permission-mode", "dontAsk"],
            "grok-cli": ["grok", "--output-format", "json", "--tools", "", "--deny", "*", "--disable-web-search", "--no-subagents", "--no-memory", "--permission-mode", "dontAsk", "--max-turns", "1"]}
        prompt = SYSTEM + "\n\nUse only the supplied text. Do not execute tools, inspect files or change the environment.\n\n" + str(messages[-1].get("content", ""))
        command = commands[kind]
        provider = command[0]
        command[0] = resolve_provider_executable(provider)
        if os.name == "nt" and command[0].lower().endswith(".cmd"):
            raise RuntimeError("Use WSL and run instrilo setup " + provider + " for npm command shims. No shell command is run automatically.")
        if CONNECTION.get("model"): command += ["--model", CONNECTION["model"]]
        if kind == "grok-cli": command += ["-p", prompt]
        child = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=ROOT, start_new_session=(os.name != "nt"))
        chunks, total = [], [0]
        async def drain(stream, capture):
            while True:
                chunk = await stream.read(8192)
                if not chunk: break
                total[0] += len(chunk)
                if total[0] > MAX_BYTES: raise ValueError("CLI output too large")
                if capture: chunks.append(chunk)
        try:
            child.stdin.write(("" if kind == "grok-cli" else prompt).encode())
            await child.stdin.drain()
            child.stdin.close()
            await asyncio.wait_for(asyncio.gather(drain(child.stdout, True), drain(child.stderr, False), child.wait()), remaining(ctx))
            if child.returncode != 0: raise RuntimeError("CLI returned a nonzero exit status")
        finally:
            if child.returncode is None:
                if os.name != "nt": os.killpg(child.pid, signal.SIGKILL)
                else: child.kill()
                await child.wait()
        raw = b"".join(chunks).decode()
        if kind == "codex-cli":
            output = []
            for line in raw.splitlines():
                if not line.strip(): continue
                event = json.loads(line)
                if event.get("type") in ("error", "turn.failed"): raise RuntimeError("Codex CLI reported failure")
                item = event.get("item", {})
                if event.get("type") == "item.completed" and item.get("type") == "agent_message": output.append(item["text"])
            result = "\n".join(output)
        else:
            event = json.loads(raw)
            if event.get("is_error") or str(event.get("subtype", "")).startswith("error"): raise RuntimeError("CLI reported failure")
            result = event.get("result", event.get("response", event.get("text")))
        if not isinstance(result, str) or not result.strip(): raise RuntimeError("CLI returned no assistant text")
        return {"role": "assistant", "content": result}
    key = await token(ctx)
    tools = SPEC["agent"]["tools"]
    if kind == "anthropic":
        converted = []
        for msg in messages:
            if msg["role"] == "system": continue
            if msg["role"] == "tool":
                converted.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": msg["tool_call_id"], "content": msg["content"]}]})
            elif msg.get("tool_calls"):
                blocks = [{"type": "text", "text": msg["content"]}] if msg.get("content") else []
                blocks += [{"type": "tool_use", "id": c["id"], "name": c["function"]["name"], "input": json.loads(c["function"]["arguments"])} for c in msg["tool_calls"]]
                converted.append({"role": "assistant", "content": blocks})
            else: converted.append(msg)
        payload = {"model": CONNECTION["model"], "system": SYSTEM, "messages": converted, "max_tokens": SPEC["agent"]["limits"]["maxOutputTokens"]}
        if tools: payload["tools"] = [{"name": t["name"], "description": t["description"], "input_schema": t["inputSchema"]} for t in tools]
        headers = {"anthropic-version": "2023-06-01", "x-api-key": key} if CONNECTION["auth"]["type"] == "api-key" else {"anthropic-version": "2023-06-01", "Authorization": "Bearer " + key}
        data = await request_json("POST", base_url() + "/messages", ctx, json=payload, headers=headers)
        usage = data.get("usage", {})
        ctx["usage_known"] = "input_tokens" in usage and "output_tokens" in usage
        ctx["usage"]["inputTokens"] += usage.get("input_tokens", 0)
        ctx["usage"]["outputTokens"] += usage.get("output_tokens", 0)
        return {"role": "assistant", "content": "".join(b["text"] for b in data["content"] if b["type"] == "text"), "tool_calls": [{"id": b["id"], "type": "function", "function": {"name": b["name"], "arguments": json.dumps(b["input"])}} for b in data["content"] if b["type"] == "tool_use"]}
    payload = {"model": CONNECTION["model"], "messages": messages, "max_completion_tokens": SPEC["agent"]["limits"]["maxOutputTokens"]}
    if tools: payload["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["inputSchema"]}} for t in tools]
    data = await request_json("POST", base_url() + "/chat/completions", ctx, json=payload, headers={"Authorization": "Bearer " + key} if key else {})
    usage = data.get("usage", {})
    ctx["usage_known"] = "prompt_tokens" in usage and "completion_tokens" in usage
    ctx["usage"]["inputTokens"] += usage.get("prompt_tokens", 0)
    ctx["usage"]["outputTokens"] += usage.get("completion_tokens", 0)
    return data["choices"][0]["message"]

async def apply_tools(message, ctx):
    outputs = []
    for call in message.get("tool_calls", []):
        args = json.loads(call["function"]["arguments"])
        value = await execute_tool(call["function"]["name"], args, ctx)
        outputs.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(value)})
    return outputs

async def run_native(text, ctx):
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}]
    for step in range(SPEC["agent"]["limits"]["maxSteps"]):
        message = await model_step(messages, ctx)
        ctx["trace"].append({"event": "model", "step": step + 1})
        messages.append(message)
        if not message.get("tool_calls"): return str(message.get("content") or "")
        messages.extend(await apply_tools(message, ctx))
    raise RuntimeError("Agent step budget exhausted")
