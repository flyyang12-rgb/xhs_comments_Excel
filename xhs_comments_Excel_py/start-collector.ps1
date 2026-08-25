$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot
$vendorMain = Join-Path $projectRoot 'vendor\Spider_XHS\main.py'

Write-Host '========================================'
Write-Host 'XHS public-opinion collector'
Write-Host '========================================'

function Stop-WithMessage([string]$message) {
    Write-Host "[ERROR] $message" -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    Stop-WithMessage 'Python Launcher was not found. Install Python 3.10 or newer.'
}

if (-not (Test-Path -LiteralPath $vendorMain)) {
    Stop-WithMessage '缺少 Spider_XHS 子模块。请在项目目录运行：git submodule update --init --recursive'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Stop-WithMessage 'Node.js was not found. Install Node.js 20 or newer.'
}

$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) {
    Write-Host '[SETUP] Creating an isolated Python environment...'
    & py -3.10 -m venv .venv
    if ($LASTEXITCODE -ne 0) {
        & py -3 -m venv .venv
    }
    if ($LASTEXITCODE -ne 0) {
        Stop-WithMessage 'Failed to create the Python environment.'
    }
}

# Keep terminal QR output and curl certificate loading reliable when the
# project path contains non-ASCII characters.
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
$venvCaBundle = Join-Path $projectRoot '.venv\Lib\site-packages\certifi\cacert.pem'
$runtimeCaBundle = Join-Path $env:TEMP 'xhs-rpa-cacert.pem'
if (Test-Path -LiteralPath $venvCaBundle) {
    Copy-Item -LiteralPath $venvCaBundle -Destination $runtimeCaBundle -Force
    $env:CURL_CA_BUNDLE = $runtimeCaBundle
}

& $pythonExe -c 'import curl_cffi, dotenv, loguru, openai, openpyxl, PIL, qrcode, yaml' 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host '[SETUP] Installing Python dependencies...'
    & $pythonExe -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'Failed to update pip.' }
    & $pythonExe -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'Failed to install Python dependencies.' }
}

$nodeModules = Join-Path $projectRoot 'vendor\Spider_XHS\node_modules'
if (-not (Test-Path -LiteralPath $nodeModules)) {
    Write-Host '[SETUP] Installing Spider_XHS Node.js dependencies...'
    Push-Location (Join-Path $projectRoot 'vendor\Spider_XHS')
    & npm install
    $npmExit = $LASTEXITCODE
    Pop-Location
    if ($npmExit -ne 0) { Stop-WithMessage 'Failed to install Node.js dependencies.' }
}

Write-Host ''
Write-Host 'A QR code will appear. Scan it with the Xiaohongshu app and confirm login.'
Write-Host ''
& $pythonExe app.py
$taskExit = $LASTEXITCODE

if ($taskExit -eq 0) {
    $outputDir = Join-Path $projectRoot 'output'
    if (Test-Path -LiteralPath $outputDir) {
        Start-Process -FilePath 'explorer.exe' -ArgumentList $outputDir
    }
    Write-Host ''
    Write-Host 'Collection completed. The output folder has been opened.' -ForegroundColor Green
} else {
    Write-Host ''
    Write-Host 'The task did not finish. Check the messages above and _runtime\logs\collector.log.' -ForegroundColor Yellow
}

Read-Host 'Press Enter to close'
exit $taskExit
