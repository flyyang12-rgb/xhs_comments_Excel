@echo off
cd /d "%~dp0"
title XHS Sign Server

echo Checking XHS sign server...
echo.

set "NODE_EXE=%~dp0node.exe"
if not exist "%NODE_EXE%" (
  set "NODE_EXE=%~dp0node\node.exe"
)
if not exist "%NODE_EXE%" (
  set "NODE_EXE=%~dp0xhs_chrome_extension\node\node.exe"
)
if not exist "%NODE_EXE%" (
  set "NODE_EXE=node"
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found.
    echo.
    echo To make this package work on a clean computer, put node.exe here:
    echo   %~dp0node.exe
    echo or:
    echo   %~dp0node\node.exe
    echo or:
    echo   %~dp0xhs_chrome_extension\node\node.exe
    echo.
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 18765 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo Sign server is already running: http://127.0.0.1:18765
  echo You can go back to Chrome extension and start collection.
  echo.
  pause
  exit /b 0
)

echo Starting XHS sign server...
echo Keep this window open while collecting data.
echo.
"%NODE_EXE%" xhs_sign_server.js

echo.
echo Sign server exited. If you did not close it manually, send the error above to developer.
echo.
pause
