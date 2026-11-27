# GateKeep one-click start.
# Run from PowerShell:   .\start.ps1
# It checks the setup, starts the server and opens the web page in your browser.

$ErrorActionPreference = "Stop"   # stop at the first error instead of carrying on
Set-Location $PSScriptRoot        # always work from the project folder

$port = 8000
$url  = "http://127.0.0.1:$port"

# 1. Check that the two environments exist.
if (-not (Test-Path ".\.venv\Scripts\uvicorn.exe")) {
    Write-Host "App environment missing. Run the setup steps in README.md first." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path ".\tools\semgrep-env\Scripts\semgrep.exe")) {
    Write-Host "Semgrep missing. Run the setup steps in README.md first." -ForegroundColor Red
    exit 1
}

# 2. AI is optional: just tell the user if it's off.
if (-not (Test-Path ".\.env") -or -not (Select-String -Path ".\.env" -Pattern "^AI_API_KEY=\S+" -Quiet)) {
    Write-Host "Note: no AI key in .env, so only Semgrep will run. (See README to add one.)" -ForegroundColor Yellow
}

# 3. Open the browser a few seconds after the server starts (in the background).
Start-Job -ScriptBlock { param($u) Start-Sleep -Seconds 4; Start-Process $u } -ArgumentList $url | Out-Null

# 4. Start the server. It keeps running in this window; press Ctrl+C to stop it.
Write-Host "Starting GateKeep at $url  (press Ctrl+C to stop)" -ForegroundColor Green
& ".\.venv\Scripts\uvicorn.exe" backend.main:app --port $port
