@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   Complaints System - Desktop (Electron)
echo   Local only on this computer
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js 22 LTS from https://nodejs.org then retry.
  pause
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number); if(v[0]<22||v[0]>=26) process.exit(1)"
if errorlevel 1 (
  echo ERROR: Use Node.js 22 or 24 LTS. Node 26 is too new for native modules.
  node --version
  echo Download Node 22 LTS, uninstall Node 26, then open a NEW cmd window.
  pause
  exit /b 1
)

echo %CD% | findstr /C:" " >nul
if not errorlevel 1 (
  echo ERROR: Project path contains spaces. node-gyp cannot build better-sqlite3.
  echo Move the folder to a path without spaces, e.g. E:\Complaints-System
  echo Current: %CD%
  pause
  exit /b 1
)

if not exist "node_modules\express\package.json" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\package.json" (
  echo Installing Electron desktop shell...
  call npm install --save-dev electron electron-builder
  if errorlevel 1 (
    echo ERROR: could not install Electron.
    pause
    exit /b 1
  )
)

echo Starting desktop application...
echo Close the window to stop the local server.
echo.
call npx electron .
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Application exited with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
