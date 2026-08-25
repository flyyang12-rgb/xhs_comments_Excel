@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-xhs-collector.ps1" -Mode "%~1"
exit /b %errorlevel%
