# GateKeep: AI Code Security Gate

Paste Python or JavaScript code and GateKeep checks it for security problems in two layers:

1. **Semgrep** finds known vulnerable patterns (SQL injection, hardcoded secrets, unsafe eval, ...).
2. **AI review** (Gemini) finds logic and context issues a pattern scanner misses.

Each finding comes with a severity, a plain-language explanation, and a suggested fix. Results can be downloaded as a report.

> Status: work in progress (Milestone 1 of 6: project setup).

## Tech stack

- Python + FastAPI backend
- Semgrep Community Edition (free)
- Google Gemini API (free tier), Ollama as a local option later
- Plain HTML/CSS/JavaScript frontend

## Run locally (Windows)

```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt

# Semgrep lives in its own environment to avoid dependency clashes
python -m venv tools\semgrep-env
.\tools\semgrep-env\Scripts\pip install semgrep

.\.venv\Scripts\uvicorn backend.main:app --reload
```

Open http://127.0.0.1:8000/docs to try the API.

## Roadmap

- [x] 1. Project setup + health endpoint
- [ ] 2. Semgrep scan endpoint
- [ ] 3. Web page to paste code and see findings
- [ ] 4. AI layer for logic issues, explanations and fixes
- [ ] 5. Downloadable report
- [ ] 6. Polish: tests, screenshots, sample vulnerable code
