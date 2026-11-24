$ErrorActionPreference = 'Stop'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 22 or later is required. Install it from https://nodejs.org/ and reopen PowerShell.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm was not found. Reinstall Node.js and make sure npm is added to PATH.'
}

$nodeVersion = (node -p "process.versions.node").Split('.')[0]
if ([int]$nodeVersion -lt 22) {
    throw "Node.js 22 or later is required. Detected Node.js $(node --version)."
}

Write-Host 'Installing OWGP Launcher dependencies...' -ForegroundColor Cyan
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }

Write-Host 'Running launcher tests...' -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { throw 'Launcher tests failed.' }

Write-Host 'Building the OWGP Launcher Windows x64 installer...' -ForegroundColor Cyan
npm run dist
if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }

$installer = Get-ChildItem -Path '.\release' -Filter 'OWGP-Launcher-Setup-*.exe' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw 'Build finished but the installer EXE was not found in .\release.' }

Write-Host "`nBuild completed successfully:" -ForegroundColor Green
Write-Host $installer.FullName -ForegroundColor Green
