$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
$venvCaBundle = Join-Path $projectRoot '.venv\Lib\site-packages\certifi\cacert.pem'
$runtimeCaBundle = Join-Path $env:TEMP 'xhs-rpa-cacert.pem'
Copy-Item -LiteralPath $venvCaBundle -Destination $runtimeCaBundle -Force
$env:CURL_CA_BUNDLE = $runtimeCaBundle

& $pythonExe refresh_links.py
$taskExit = $LASTEXITCODE
Read-Host 'Press Enter to close'
exit $taskExit
