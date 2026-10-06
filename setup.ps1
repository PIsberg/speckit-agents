# Windows PowerShell. Checks for Node, then hands every argument to install.mjs.
# Run: powershell -ExecutionPolicy Bypass -File setup.ps1 [--uninstall|--dry-run|--force|--claude-dir DIR]
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'node not found. Install Node 18+ (https://nodejs.org); the hooks run on it.'
    exit 1
}
& node (Join-Path $PSScriptRoot 'install.mjs') @args
exit $LASTEXITCODE
