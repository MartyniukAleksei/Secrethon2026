import base64
import os
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api import router
from app.config import settings
from app.db import engine
from app.mcp_server import create_server
from app.mcp_server import http_app as mcp_http_app
from app.reviews import engine as review_engine

# Built frontend (frontend/dist). In Docker it is copied to /app/static.
DEFAULT_STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
STATIC_DIR = Path(os.getenv("STATIC_DIR", DEFAULT_STATIC_DIR))


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    try:
        # SDK HTTP session managers are single-use; make one for each app lifespan.
        server = create_server()
        mcp_http_app.app = server.streamable_http_app()
        async with server.session_manager.run():
            yield
    finally:
        await engine.dispose()
        await review_engine.dispose()


app = FastAPI(title="Secrethon 2026 API", lifespan=lifespan)
# The employer list is a few hundred KB of JSON; compress it.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.include_router(router)
app.mount("/mcp", mcp_http_app)


@app.api_route("/mcp", methods=["GET", "POST", "DELETE"], include_in_schema=False)
async def mcp_endpoint() -> RedirectResponse:
    return RedirectResponse("/mcp/", status_code=307)


def _authorized(header: str | None) -> bool:
    if not header or not header.startswith("Basic "):
        return False
    try:
        user, _, password = base64.b64decode(header[6:]).decode().partition(":")
    except ValueError:
        return False
    user_ok = secrets.compare_digest(user.encode(), settings.site_user.encode())
    password_ok = secrets.compare_digest(password.encode(), settings.site_password.encode())
    return user_ok & password_ok


@app.middleware("http")
async def basic_auth(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    # MCP authenticates its own Bearer key; a second Basic header cannot coexist.
    path = request.url.path
    if (
        not settings.site_password
        or path == "/api/health"
        or path == "/mcp"
        or path.startswith("/mcp/")
    ):
        return await call_next(request)
    if _authorized(request.headers.get("authorization")):
        return await call_next(request)
    return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Secrethon"'})


if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        # Serve real files from the build (favicon etc.), otherwise index.html for SPA routing.
        file = (STATIC_DIR / path).resolve()
        if path and file.is_file() and file.is_relative_to(STATIC_DIR.resolve()):
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")
