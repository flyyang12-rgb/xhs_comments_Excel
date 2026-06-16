@echo off
setlocal
cd /d "%~dp0"
title XHS Collection Tool

set "APP_DIR=%~dp0"
set "EXT_DIR=%APP_DIR%xhs_chrome_extension"
set "NODE_EXE=%EXT_DIR%\node\node.exe"
set "SIGN_SERVER=%APP_DIR%xhs_sign_server.js"
set "SIGN_JS=%APP_DIR%xhs_main_260411.js"
set "SERVICE_URL=http://127.0.0.1:18765"

echo ==========================================
echo XHS Collection Tool
echo ==========================================
echo.

if not exist "%EXT_DIR%\" (
  echo [ERROR] Missing folder:
  echo   %EXT_DIR%
  echo.
  echo Please unzip the whole package and do not move files separately.
  echo.
  pause
  exit /b 1
)

if not exist "%NODE_EXE%" (
  echo [ERROR] Missing portable Node runtime:
  echo   %NODE_EXE%
  echo.
  echo Please make sure xhs_chrome_extension\node\node.exe exists.
  echo.
  pause
  exit /b 1
)

if not exist "%SIGN_SERVER%" (
  echo [ERROR] Missing sign server file:
  echo   %SIGN_SERVER%
  echo.
  pause
  exit /b 1
)

if not exist "%SIGN_JS%" (
  echo [ERROR] Missing signer file:
  echo   %SIGN_JS%
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Uri '%SERVICE_URL%/health' -TimeoutSec 2; if ($r.ok) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo [OK] Sign service is already running:
  echo   %SERVICE_URL%
  echo.
  echo Chrome extension folder:
  echo   %EXT_DIR%
  echo.
  echo You can open Chrome, load the extension, login XHS, then start collection.
  echo Keep this window open while collecting data.
  echo.
  pause
  exit /b 0
)

echo [START] Starting local sign service...
echo Service URL:
echo   %SERVICE_URL%
echo.
echo Chrome extension folder:
echo   %EXT_DIR%
echo.
echo Keep this window open while collecting data.
echo If Chrome has not loaded the extension yet, open chrome://extensions/ and load xhs_chrome_extension.
echo.

"%NODE_EXE%" "%SIGN_SERVER%"

echo.
echo [STOPPED] Sign service exited.
echo If you did not close it manually, send this window screenshot to developer.
echo.
pause
