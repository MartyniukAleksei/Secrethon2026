import os
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Built frontend (frontend/dist). In Docker it is copied to /app/static.
DEFAULT_STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
STATIC_DIR = Path(os.getenv("STATIC_DIR", DEFAULT_STATIC_DIR))

app = FastAPI(title="Secrethon 2026 API")

api = APIRouter(prefix="/api")


@api.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api)

if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        # Serve real files from the build (favicon etc.), otherwise index.html for SPA routing.
        file = (STATIC_DIR / path).resolve()
        if path and file.is_file() and file.is_relative_to(STATIC_DIR.resolve()):
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")
