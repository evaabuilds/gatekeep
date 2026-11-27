"""Tests for the Semgrep layer (scanner.py) and the /scan endpoint."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import main, scanner

SAMPLES = Path(__file__).resolve().parent.parent / "samples"

# A tiny fake of what Semgrep prints with --json (only the fields we use).
FAKE_SEMGREP_OUTPUT = {
    "results": [
        {
            "check_id": "python.lang.security.audit.eval-detected.eval-detected",
            "start": {"line": 2}, "end": {"line": 2},
            "extra": {"severity": "WARNING", "message": "eval is dangerous",
                      "metadata": {"cwe": "CWE-95: Eval Injection"}},
        },
        {   # same rule, same line, from another rule pack -> should be removed
            "check_id": "python.other-pack.eval-detected",
            "start": {"line": 2}, "end": {"line": 2},
            "extra": {"severity": "WARNING", "message": "eval again", "metadata": {}},
        },
        {
            "check_id": "python.lang.security.audit.subprocess-shell-true",
            "start": {"line": 3}, "end": {"line": 3},
            "extra": {"severity": "ERROR", "message": "shell=True", "metadata": {"cwe": ["CWE-78"]}},
        },
    ]
}
FAKE_CODE = "import subprocess\nresult = eval(user_input)\nsubprocess.call(cmd, shell=True)\n"


# ---------- Fast unit tests (no Semgrep, no internet) ----------

def test_to_findings_cleans_semgrep_output():
    findings = scanner._to_findings(FAKE_SEMGREP_OUTPUT, FAKE_CODE)

    assert len(findings) == 2                          # duplicate removed
    first, second = findings
    assert first["severity"] == "high"                 # ERROR -> high, sorted first
    assert first["line_start"] == 3
    assert second["severity"] == "medium"              # WARNING -> medium
    assert second["title"] == "Dangerous eval() call"  # rule id -> readable title
    assert first["title"] == "Command injection risk"
    assert second["code"] == "result = eval(user_input)"
    assert second["cwe"] == ["CWE-95: Eval Injection"]  # single string -> list


def test_friendly_title_fallback():
    assert scanner.friendly_title("python.x.some-new-rule") == "Some new rule"
    assert scanner.friendly_title("python.lang.security.audit.md5-used-as-password") == "Weak hashing (MD5)"


def test_unsupported_language_is_rejected():
    with pytest.raises(ValueError):
        scanner.run_semgrep("puts 'hi'", "ruby")


def test_scan_endpoint_without_ai(monkeypatch):
    # Replace the real Semgrep with a fake, so this test is fast and offline.
    monkeypatch.setattr(main, "run_semgrep",
                        lambda code, lang: scanner._to_findings(FAKE_SEMGREP_OUTPUT, code))
    response = TestClient(main.app).post(
        "/scan", json={"code": FAKE_CODE, "language": "python", "use_ai": False})

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2
    assert data["summary"] == {"high": 1, "medium": 1, "low": 0}
    assert data["ai"]["status"] == "skipped"


def test_scan_endpoint_rejects_empty_code():
    response = TestClient(main.app).post("/scan", json={"code": "", "language": "python"})
    assert response.status_code == 422


# ---------- Slow integration test (real Semgrep, needs internet) ----------

@pytest.mark.skipif(not scanner.SEMGREP_PATH.exists(), reason="Semgrep is not installed")
def test_real_semgrep_on_python_sample():
    code = (SAMPLES / "vulnerable.py").read_text(encoding="utf-8")
    findings = scanner.run_semgrep(code, "python")

    found_lines = {f["line_start"] for f in findings}
    assert 15 in found_lines   # SQL injection
    assert 21 in found_lines   # subprocess shell=True
    assert 36 in found_lines   # eval
