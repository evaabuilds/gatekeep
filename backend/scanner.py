"""Runs Semgrep on a piece of code and turns its output into simple findings.

Semgrep lives in its own virtual environment (tools/semgrep-env), so we run it
as a separate program with `subprocess`, the same way you would type a command
in the terminal, and read the JSON it prints.
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Where the semgrep program is. On Windows venvs keep programs in "Scripts",
# on Mac/Linux in "bin".
_bin_dir = "Scripts" if sys.platform == "win32" else "bin"
_exe = "semgrep.exe" if sys.platform == "win32" else "semgrep"
SEMGREP_PATH = Path(os.getenv("SEMGREP_PATH", PROJECT_ROOT / "tools" / "semgrep-env" / _bin_dir / _exe))

# Languages we support -> file extension Semgrep uses to detect the language.
LANGUAGE_EXTENSIONS = {
    "python": ".py",
    "javascript": ".js",
}

# Free community rule packs from the Semgrep Registry.
RULE_PACKS = ["p/default", "p/security-audit", "p/secrets"]

# Semgrep's words -> our simpler severity scale.
SEVERITY_MAP = {
    "ERROR": "high",
    "WARNING": "medium",
    "INFO": "low",
}

TIMEOUT_SECONDS = 120


class ScannerError(Exception):
    """Raised when Semgrep could not run properly."""


def run_semgrep(code: str, language: str) -> list[dict]:
    """Scan `code` with Semgrep and return a list of findings."""
    if language not in LANGUAGE_EXTENSIONS:
        raise ValueError(f"Unsupported language: {language}")
    if not SEMGREP_PATH.exists():
        raise ScannerError(f"Semgrep not found at {SEMGREP_PATH}. See README for setup.")

    # Semgrep scans files, not text, so we save the code to a temporary file.
    with tempfile.TemporaryDirectory() as tmp_dir:
        code_file = Path(tmp_dir) / f"snippet{LANGUAGE_EXTENSIONS[language]}"
        code_file.write_text(code, encoding="utf-8")

        command = [str(SEMGREP_PATH), "scan", "--json", "--quiet", "--metrics=off"]
        for pack in RULE_PACKS:
            command += ["--config", pack]
        command.append(str(code_file))

        # PYTHONUTF8 avoids Windows text-encoding errors inside Semgrep.
        env = {**os.environ, "PYTHONUTF8": "1"}
        try:
            result = subprocess.run(
                command, capture_output=True, text=True, encoding="utf-8",
                timeout=TIMEOUT_SECONDS, env=env,
            )
        except subprocess.TimeoutExpired as exc:
            raise ScannerError("Semgrep took too long.") from exc

    try:
        output = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ScannerError(f"Semgrep failed: {result.stderr.strip()[:500]}") from exc

    return _to_findings(output, code)


def _to_findings(output: dict, code: str) -> list[dict]:
    """Convert raw Semgrep JSON into our own clean finding format."""
    lines = code.splitlines()
    findings = []
    seen = set()

    for item in output.get("results", []):
        start = item["start"]["line"]
        end = item["end"]["line"]
        extra = item.get("extra", {})
        metadata = extra.get("metadata", {})
        rule_id = item.get("check_id", "")

        # Several rule packs can flag the same thing; keep one per rule+line.
        key = (rule_id.split(".")[-1], start)
        if key in seen:
            continue
        seen.add(key)

        cwe = metadata.get("cwe", [])
        if isinstance(cwe, str):
            cwe = [cwe]

        findings.append({
            "source": "semgrep",
            "rule_id": rule_id,
            "title": rule_id.split(".")[-1].replace("-", " ").capitalize(),
            "severity": SEVERITY_MAP.get(extra.get("severity", ""), "low"),
            "line_start": start,
            "line_end": end,
            "code": "\n".join(lines[start - 1:end]),
            "message": extra.get("message", "").strip(),
            "cwe": cwe,
            "owasp": metadata.get("owasp", []),
            "references": metadata.get("references", []),
        })

    order = {"high": 0, "medium": 1, "low": 2}
    findings.sort(key=lambda f: (order[f["severity"]], f["line_start"]))
    return findings
