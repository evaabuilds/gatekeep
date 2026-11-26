"""Tests for the HTML report builder."""

from backend.report import build_report

FAKE_RESULT = {
    "language": "python",
    "summary": {"high": 1, "medium": 0, "low": 0},
    "ai": {"message": "AI found 1 extra issue(s)."},
    "findings": [{
        "source": "ai",
        "title": "Hardcoded API key",
        "severity": "high",
        "line_start": 8,
        "line_end": 8,
        "code": 'API_KEY = "<script>alert(1)</script>"',
        "explanation": "Secrets in code can leak.",
        "fix": 'API_KEY = os.environ.get("API_KEY")',
        "cwe": ["CWE-798"],
    }],
}


def test_report_contains_the_finding():
    html = build_report(FAKE_RESULT)
    assert "GateKeep Security Report" in html
    assert "Hardcoded API key" in html
    assert "CWE-798" in html
    assert "Suggested fix" in html


def test_report_escapes_user_code():
    # The user's code must show as text, never run as HTML (no XSS in our own report!).
    html = build_report(FAKE_RESULT)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


def test_report_endpoint_downloads_a_file():
    from fastapi.testclient import TestClient
    from backend.main import app

    client = TestClient(app)
    response = client.post("/report", json=FAKE_RESULT)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["content-disposition"].startswith('attachment; filename="gatekeep-report-')
    assert "Hardcoded API key" in response.text


def test_report_endpoint_rejects_wrong_input():
    from fastapi.testclient import TestClient
    from backend.main import app

    response = TestClient(app).post("/report", json={"hello": "world"})
    assert response.status_code == 422


def test_report_with_no_findings():
    html = build_report({"language": "javascript", "summary": {}, "findings": []})
    assert "No issues were found" in html
