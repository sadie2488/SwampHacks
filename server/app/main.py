"""Server entry point: health, public config, demo songs, upload, and song analysis."""
import logging
import re
from pathlib import PurePosixPath
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config, store
from .sessions_api import router as sessions_router

log = logging.getLogger("music.server")

app = FastAPI(title="SwampHacks Music")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(sessions_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


class Auth0Public(BaseModel):
    domain: str | None
    client_id: str | None


class PublicConfig(BaseModel):
    auth0: Auth0Public


@app.get("/api/config", response_model=PublicConfig)
def public_config() -> dict:
    """What the website needs to start login. Only these two public values, never a key."""
    return {"auth0": config.public_auth0()}


@app.get("/api/demo-songs")
def demo_songs() -> list[dict]:
    return store.demo_songs()


@app.get("/api/songs/{song_id}/analysis")
def song_analysis(song_id: str) -> dict:
    analysis = store.get_analysis(song_id)
    if analysis is None:
        raise HTTPException(404, "We could not find that song. Try uploading it again.")
    return analysis


def _is_audio(file_name: str, content_type: str | None) -> bool:
    extension = PurePosixPath(file_name).suffix.lower()
    return (content_type or "").lower().startswith("audio/") or extension in config.AUDIO_EXTENSIONS


async def _read_limited(file: UploadFile) -> bytes:
    data = bytearray()
    while chunk := await file.read(1024 * 1024):
        data += chunk
        if len(data) > config.MAX_UPLOAD_BYTES:
            limit_mb = config.MAX_UPLOAD_BYTES // (1024 * 1024)
            raise HTTPException(413, f"That file is too big. Please use an audio file under {limit_mb} MB.")
    return bytes(data)


@app.post("/api/songs")
async def upload_song(file: Annotated[UploadFile | None, File()] = None) -> dict:
    if file is None:
        raise HTTPException(400, "Choose an audio file to upload.")
    # Browsers may send a Windows-style path; keep only the file name itself.
    file_name = re.split(r"[\\/]", file.filename or "")[-1] or "upload"
    if not _is_audio(file_name, file.content_type):
        raise HTTPException(415, "That does not look like an audio file. Try an MP3, WAV, FLAC, OGG, M4A or AAC file.")
    data = await _read_limited(file)
    if not data:
        raise HTTPException(400, "That file is empty. Choose a different audio file.")
    try:
        return await run_in_threadpool(store.save_upload, file_name, data)
    except Exception:
        log.exception("Analysis failed for %s", file_name)
        raise HTTPException(500, "We could not analyze that song. Please try another file.") from None
