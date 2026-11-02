@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   نظام الشكاوى - تطبيق سطح المكتب
echo   Local desktop shell (Electron)
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js 22.0+ then run npm install and retry.
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
