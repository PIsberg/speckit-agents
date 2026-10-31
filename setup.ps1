# Windows PowerShell. Checks for Node 18 or newer, then hands every argument to install.mjs.
# Run: powershell -ExecutionPolicy Bypass -File setup.ps1 [flags]; setup.ps1 --help lists them.
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error 'node not found. Install Node 18+ (https://nodejs.org); the hooks run on it.'
    exit 1
}
$version = (& node --version 2>$null) | Select-Object -First 1
if (-not ($version -match '^v(\d+)\.') -or [int]$Matches[1] -lt 18) {
    $found = if ($version) { $version } else { 'no version from node --version' }
    Write-Error "Node 18 or newer is needed; found $found. Install it (https://nodejs.org); the hooks run on it."
    exit 1
}
& node (Join-Path $PSScriptRoot 'install.mjs') @args
exit $LASTEXITCODE
