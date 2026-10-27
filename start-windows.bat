@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   Local Complaints System - Windows
echo   Runs on this computer only (127.0.0.1)
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js 20.6 or newer using an approved installer, then retry.
  pause
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number); if(v[0]<20||(v[0]===20&&v[1]<6)) process.exit(1)"
if errorlevel 1 (
  echo ERROR: Node.js 20.6 or newer is required.
  node --version
  pause
  exit /b 1
)

if not exist ".env" (
  echo ERROR: .env is missing.
  echo Copy .env.example to .env and configure unique local credentials first.
  pause
  exit /b 1
)

if not exist "node_modules\express\package.json" (
  echo ERROR: Required dependencies are not installed.
  echo This launcher will NOT download packages or access the internet.
  echo Prepare dependencies from a trusted package cache or installation media first.
  pause
  exit /b 1
)

if not exist "open-local-browser.ps1" (
  echo ERROR: The local browser readiness helper is missing.
  pause
  exit /b 1
)

echo Running automated tests before startup...
call npm test
if errorlevel 1 (
  echo ERROR: Tests failed. The server will not be started.
  pause
  exit /b 1
)

echo.
echo Starting the local server.
echo The browser will open automatically when http://127.0.0.1:3000 is ready.
echo Keep this window open. Press Ctrl+C to stop the server.
echo.
start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-local-browser.ps1"
call npm start
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Server stopped with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
