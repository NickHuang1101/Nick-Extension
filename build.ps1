param([switch]$SkipInstall, [switch]$SkipLint, [switch]$Clean)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "   VS Code Extension Auto Build Tool" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

$pkg = Get-Content "package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host "[1] Extension Info" -ForegroundColor Green
Write-Host "    Name: $($pkg.displayName)"
Write-Host "    Version: $($pkg.version)"
Write-Host "    Output: $($pkg.name)-$($pkg.version).vsix`n"

if ($Clean -and (Test-Path "out")) {
    Write-Host "[2] Cleaning out folder..." -ForegroundColor Green
    Remove-Item -Recurse -Force "out"
    Write-Host "    Done`n"
}

if (-not $SkipInstall) {
    Write-Host "[3] Installing dependencies..." -ForegroundColor Green
    $ErrorActionPreference = "Continue"
    npm install 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { Write-Host "[Error] npm install failed" -ForegroundColor Red; exit 1 }
    Write-Host ""
} else { Write-Host "[3] Skipped npm install`n" -ForegroundColor Yellow }

if (-not $SkipLint) {
    Write-Host "[4] Running ESLint..." -ForegroundColor Green
    $ErrorActionPreference = "Continue"
    npm run lint 2>&1 | Out-Null
    Write-Host "    ESLint check completed`n"
} else { Write-Host "[4] Skipped ESLint`n" -ForegroundColor Yellow }

Write-Host "[5] Compiling TypeScript..." -ForegroundColor Green
$ErrorActionPreference = "Continue"
npm run compile 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "[Error] Compile failed" -ForegroundColor Red; exit 1 }
Write-Host "    Done`n"

Write-Host "[6] Checking vsce..." -ForegroundColor Green
$vsceCmd = Get-Command vsce -ErrorAction SilentlyContinue
if (-not $vsceCmd) {
    Write-Host "    Installing vsce..."
    npm install -g @vscode/vsce 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { Write-Host "[Error] vsce install failed" -ForegroundColor Red; exit 1 }
}
Write-Host "    vsce ready`n"

Write-Host "[7] Packaging VSIX..." -ForegroundColor Green
# 只刪除當前版本的 VSIX，保留舊版本
$currentVsix = "$($pkg.name)-$($pkg.version).vsix"
if (Test-Path $currentVsix) { Remove-Item $currentVsix -Force }
vsce package --allow-missing-repository 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "[Error] Package failed" -ForegroundColor Red; exit 1 }
Write-Host ""

$vsix = Get-ChildItem -Filter "*.vsix" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($vsix) {
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "   Build Success!" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "`n    File: $($vsix.Name)"
    Write-Host "    Size: $([math]::Round($vsix.Length / 1KB, 2)) KB"
    Write-Host "    Path: $($vsix.FullName)"
    Write-Host "`nInstall:"
    Write-Host "    code --install-extension $($vsix.Name)`n"
} else { Write-Host "[Error] VSIX not found" -ForegroundColor Red; exit 1 }
