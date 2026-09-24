"""Local coordinator protocol; no network and no live fallback on replay errors."""
import asyncio, json, os, sys

durable_enabled = os.environ.get("INSTRILO_DURABLE_RUN") == "1"
_sequence = 0

class DurablePause(Exception):
    def __init__(self, detail):
        super().__init__("Run paused for local approval")
        self.detail = detail

async def _exchange(message):
    # __stdout__ survives the agent's framework-log redirection.
    sys.__stdout__.write("@@INSTRILO_RPC@@" + json.dumps(message, ensure_ascii=False) + "\n")
    sys.__stdout__.flush()
    line = await asyncio.to_thread(sys.stdin.readline)
    if not line: raise RuntimeError("Durable coordinator disconnected; refusing live fallback")
    response = json.loads(line)
    if response.get("action") == "pause": raise DurablePause(response)
    if response.get("action") == "error": raise RuntimeError(response.get("error", "Durable coordinator rejected operation"))
    return response

async def durable_step(kind, request, operation):
    global _sequence
    if not durable_enabled: return await operation()
    seq = _sequence
    _sequence += 1
    before = await _exchange({"phase": "before", "seq": seq, "kind": kind, "request": request})
    if before.get("action") == "replay": return before.get("response")
    if before.get("action") != "execute" or not isinstance(before.get("ticket"), str):
        raise RuntimeError("Invalid coordinator dispatch")
    try:
        response = await operation()
    except DurablePause:
        raise
    except Exception as error:
        await _exchange({"phase": "failure", "seq": seq, "ticket": before["ticket"], "error": str(error)})
        raise
    await _exchange({"phase": "after", "seq": seq, "ticket": before["ticket"], "response": response})
    return response
