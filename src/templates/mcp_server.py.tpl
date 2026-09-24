"""Local stdio connector only. Host controls inherited credentials and approvals."""
from mcp.server.fastmcp import FastMCP
from agent import run_agent
from runtime import SPEC
mcp = FastMCP(SPEC["name"])

@mcp.tool()
async def invoke_agent(input: str) -> dict:
    """Run the configured agent. Review its scope and tools before granting access."""
    return await run_agent(input)

if __name__ == "__main__": mcp.run(transport="stdio")
