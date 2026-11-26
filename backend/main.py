"""GateKeep backend: the server that will scan code for security issues.

Run it with:
    .venv/Scripts/uvicorn backend.main:app --reload
Then open http://127.0.0.1:8000/docs in the browser.
"""

from fastapi import FastAPI

# `app` is our web application. Every URL (endpoint) gets attached to it.
app = FastAPI(
    title="GateKeep",
    description="AI Code Security Gate: Semgrep + AI review for Python and JavaScript code.",
    version="0.1.0",
)


@app.get("/health")
def health():
    """Simple check that the server is alive."""
    return {"status": "ok", "app": "GateKeep"}
