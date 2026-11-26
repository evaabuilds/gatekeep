"""GateKeep backend: the server that will scan code for security issues.

Run it with:
    .venv/Scripts/uvicorn backend.main:app --reload
Then open http://127.0.0.1:8000/docs in the browser.
"""

from typing import Literal

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend import ai_reviewer
from backend.scanner import PROJECT_ROOT, ScannerError, run_semgrep

# Load secrets/settings from the .env file into environment variables.
load_dotenv(PROJECT_ROOT / ".env")

MAX_CODE_CHARS = 50_000  # keep scans fast and stop huge uploads
FRONTEND_DIR = PROJECT_ROOT / "frontend"
SAMPLE_FILES = {
    "python": PROJECT_ROOT / "samples" / "vulnerable.py",
    "javascript": PROJECT_ROOT / "samples" / "vulnerable.js",
}

# `app` is our web application. Every URL (endpoint) gets attached to it.
app = FastAPI(
    title="GateKeep",
    description="AI Code Security Gate: Semgrep + AI review for Python and JavaScript code.",
    version="0.3.0",
)

# Serve the CSS/JS files of the web page under /static/...
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/", include_in_schema=False)
def home():
    """The web page."""
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/samples/{language}", response_class=PlainTextResponse)
def sample(language: Literal["python", "javascript"]):
    """Intentionally insecure demo code for the 'Load sample' button."""
    return SAMPLE_FILES[language].read_text(encoding="utf-8")


class ScanRequest(BaseModel):
    """What the user sends to /scan."""
    code: str = Field(..., min_length=1, max_length=MAX_CODE_CHARS, description="Source code to check")
    language: Literal["python", "javascript"]
    use_ai: bool = Field(True, description="Also run the AI review (needs AI_API_KEY in .env)")


@app.get("/health")
def health():
    """Simple check that the server is alive."""
    return {"status": "ok", "app": "GateKeep"}


@app.post("/scan")
async def scan(request: ScanRequest):
    """Layer 1: Semgrep. Layer 2: AI review. Returns all findings together."""
    try:
        # Semgrep is slow-ish, so run it in a worker thread and keep the server responsive.
        findings = await run_in_threadpool(run_semgrep, request.code, request.language)
    except ScannerError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    ai = {"enabled": False, "status": "skipped", "message": "AI review was not requested."}
    if request.use_ai:
        try:
            result = await run_in_threadpool(ai_reviewer.review, request.code, request.language, findings)
            # Attach the AI's plain-language explanation + fix to each Semgrep finding.
            for index, note in result["semgrep_notes"].items():
                findings[index].update(note)
            findings += result["ai_findings"]
            ai = {"enabled": True, "status": "ok",
                  "message": f"AI found {len(result['ai_findings'])} extra issue(s)."}
        except ai_reviewer.AIReviewError as exc:
            # The scan still works without AI; we just tell the user why AI was skipped.
            ai = {"enabled": False, "status": "error", "message": str(exc)}
        except Exception:  # safety net: an AI problem must never break the whole scan
            ai = {"enabled": False, "status": "error", "message": "Unexpected problem in the AI review."}

    order = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: (order[f["severity"]], f["line_start"]))
    summary = {level: sum(f["severity"] == level for f in findings) for level in order}
    return {
        "language": request.language,
        "total": len(findings),
        "summary": summary,
        "ai": ai,
        "findings": findings,
    }
