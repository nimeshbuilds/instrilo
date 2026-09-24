import argparse, asyncio, contextlib, json, sys
from runtime import SPEC, context, remaining, run_native

async def framework_run(text, ctx):
    # FRAMEWORK_IMPLEMENTATION

async def run_agent(text, ctx=None):
    if not isinstance(text, str) or not text.strip() or len(text) > 100000:
        raise ValueError("input must be a non-empty string of at most 100000 characters")
    ctx = ctx or context()
    # Framework logs must not corrupt the CLI's machine-readable stdout.
    with contextlib.redirect_stdout(sys.stderr):
        output = await asyncio.wait_for(framework_run(text, ctx), timeout=remaining(ctx))
    return {"output": str(output), "trace": ctx["trace"], **({"usage": ctx["usage"]} if ctx["usage_known"] else {})}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(asyncio.run(run_agent(args.input))))
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(1)
