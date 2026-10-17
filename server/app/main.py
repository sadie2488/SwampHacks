"""Server entry point. The server-core lane (L4) builds this out: upload, analysis, demo songs, database."""
from fastapi import FastAPI

app = FastAPI(title="SwampHacks Music")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
