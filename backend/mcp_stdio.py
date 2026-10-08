"""Local MCP entry point; works from any client working directory."""

import asyncio

from app.mcp_server import serve_stdio

if __name__ == "__main__":
    asyncio.run(serve_stdio())
