"""GateKeep backend: the server that will scan code for security issues.

Run it with:
    .venv/Scripts/uvicorn backend.main:app --reload
Then open http://127.0.0.1:8000/docs in the browser.
"""

from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.scanner import ScannerError, run_semgrep

MAX_CODE_CHARS = 50_000  # keep scans fast and stop huge uploads

# `app` is our web application. Every URL (endpoint) gets attached to it.
app = FastAPI(
    title="GateKeep",
    description="AI Code Security Gate: Semgrep + AI review for Python and JavaScript code.",
    version="0.2.0",
)


class ScanRequest(BaseModel):
    """What the user sends to /scan."""
    code: str = Field(..., min_length=1, max_length=MAX_CODE_CHARS, description="Source code to check")
    language: Literal["python", "javascript"]


@app.get("/health")
def health():
    """Simple check that the server is alive."""
    return {"status": "ok", "app": "GateKeep"}


@app.post("/scan")
async def scan(request: ScanRequest):
    """Scan code with Semgrep and return the findings."""
    try:
        # Semgrep is slow-ish, so run it in a worker thread and keep the server responsive.
        findings = await run_in_threadpool(run_semgrep, request.code, request.language)
    except ScannerError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    summary = {level: sum(f["severity"] == level for f in findings) for level in ("high", "medium", "low")}
    return {
        "language": request.language,
        "total": len(findings),
        "summary": summary,
        "findings": findings,
    }
