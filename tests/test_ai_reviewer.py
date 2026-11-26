"""Tests for the AI layer that don't need a real API key.

Run with:  .venv/Scripts/python -m pytest
"""

import httpx

from backend.ai_reviewer import _clean, _parse_json, _short_error, get_settings


def test_short_error_handles_list_body():
    # Gemini can return the error wrapped in a list; this once crashed the server.
    response = httpx.Response(503, json=[{"error": {"message": "The model is overloaded."}}])
    assert _short_error(response) == "The model is overloaded."


def test_short_error_rate_limit():
    response = httpx.Response(429, json={"error": {"message": "quota"}})
    assert "rate limit" in _short_error(response)

CODE = "\n".join(f"line {i}" for i in range(1, 11))  # 10 lines


def test_parse_json_strips_markdown_fence():
    text = '```json\n{"semgrep_notes": [], "ai_findings": []}\n```'
    assert _parse_json(text) == {"semgrep_notes": [], "ai_findings": []}


def test_parse_json_finds_object_inside_text():
    assert _parse_json('Sure! Here it is: {"ai_findings": []} Hope it helps.') == {"ai_findings": []}


def test_clean_drops_bad_items_and_fixes_values():
    raw = {
        "semgrep_notes": [{"id": 0, "explanation": "x", "fix": "y"}, {"id": 99}],
        "ai_findings": [
            {"title": "Hardcoded key", "severity": "HIGH", "line_start": 8, "line_end": 500, "cwe": "CWE-798"},
            {"no_title": True},
            {"title": "Weird", "severity": "critical!!", "line_start": "abc"},
        ],
    }
    result = _clean(raw, CODE, semgrep_count=2)

    assert list(result["semgrep_notes"]) == [0]            # id 99 does not exist -> dropped
    first, second = result["ai_findings"]                  # item without title -> dropped
    assert first["severity"] == "high"                     # "HIGH" -> lowercase
    assert (first["line_start"], first["line_end"]) == (8, 10)  # 500 clamped to last line
    assert first["cwe"] == ["CWE-798"]
    assert second["severity"] == "medium"                  # unknown severity -> medium
    assert second["line_start"] == 1                       # bad line number -> 1


def test_ai_disabled_without_key(monkeypatch):
    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.setenv("AI_PROVIDER", "mimo")
    assert get_settings() is None


def test_gemini_is_default(monkeypatch):
    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.delenv("AI_MODEL", raising=False)
    monkeypatch.delenv("AI_BASE_URL", raising=False)
    settings = get_settings()
    assert settings["provider"] == "gemini"
    assert settings["base_url"] == "https://generativelanguage.googleapis.com/v1beta/openai"
    assert settings["max_tokens_field"] == "max_tokens"


def test_mimo_defaults(monkeypatch):
    monkeypatch.setenv("AI_API_KEY", "sk-test")
    monkeypatch.setenv("AI_PROVIDER", "mimo")
    monkeypatch.delenv("AI_MODEL", raising=False)
    monkeypatch.delenv("AI_BASE_URL", raising=False)
    settings = get_settings()
    assert settings["base_url"] == "https://api.xiaomimimo.com/v1"
    assert settings["model"] == "mimo-v2.6-flash"
