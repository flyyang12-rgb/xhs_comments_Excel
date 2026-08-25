@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-collector.ps1"
exit /b %ERRORLEVEL%
