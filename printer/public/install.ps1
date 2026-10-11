# Club Label Printer -- one-line installer
# Usage: irm https://awana.kvbchurch.org/install.ps1 | iex
#
# This used to download the old PowerShell install from the Print-TwoTimTwo-Labels
# repo. That repo is archived (2026-10-11): the script install it fetched can no
# longer update, and it predates the sync service every screen now uses. So this
# command now installs the current Windows app instead, from the same link as the
# Download button on awana.kvbchurch.org. The app finds an old C:\output install
# and imports it the first time it runs.

$ErrorActionPreference = "Stop"
$InstallerUrl = "https://awana.kvbchurch.org/download/club-label-printer"
$InstallerPath = Join-Path $env:TEMP "Club-Label-Printer-Setup.exe"

Write-Host ""
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "  Club Label Printer -- Installer" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Downloading the Club Label Printer app..." -ForegroundColor Gray
try {
    Invoke-WebRequest -Uri $InstallerUrl -OutFile $InstallerPath -UseBasicParsing
    Write-Host "[OK] Downloaded." -ForegroundColor Green
} catch {
    Write-Host "[FAIL] Could not download the app: $_" -ForegroundColor Red
    Write-Host "  Check your internet connection, or download it from" -ForegroundColor Yellow
    Write-Host "  https://awana.kvbchurch.org and run it." -ForegroundColor Yellow
    exit 1
}

Write-Host "Starting the installer. If Windows SmartScreen appears, click" -ForegroundColor Gray
Write-Host "'More info', then 'Run anyway'." -ForegroundColor Gray
Write-Host ""
Start-Process -FilePath $InstallerPath
