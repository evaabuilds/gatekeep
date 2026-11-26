"""Send a code file to the running GateKeep server and print the findings.

Usage (server must be running):
    .venv/Scripts/python scripts/try_scan.py samples/vulnerable.py python
"""

import json
import sys
import time
import urllib.request

path, language = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    body = json.dumps({"code": f.read(), "language": language}).encode()

req = urllib.request.Request(
    "http://127.0.0.1:8000/scan", data=body, headers={"Content-Type": "application/json"}
)
start = time.time()
with urllib.request.urlopen(req, timeout=200) as resp:
    result = json.load(resp)

print(f"{path}: {result['total']} findings in {time.time() - start:.1f}s {result['summary']}")
for f in result["findings"]:
    print(f"  [{f['severity'].upper():6}] line {f['line_start']:>3}  {f['title']}")
