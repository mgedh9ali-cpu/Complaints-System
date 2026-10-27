@echo off
setlocal
cd /d "%~dp0"
title شعبة الاستفسارات والشكاوى

if not exist "node.exe" (
  echo تعذر العثور على محرك التشغيل المحلي.
  pause
  exit /b 1
)

if not exist ".env" (
  echo إعداد النظام لأول مرة...
  node.exe "scripts\initialize-local-config.js"
  if errorlevel 1 (
    echo تعذر إنشاء الإعدادات المحلية.
    pause
    exit /b 1
  )
  echo.
  echo احفظ كلمة مرور المدير التي ظهرت أعلاه في مكان آمن.
  echo لن تظهر كلمة المرور الأولية مرة أخرى.
  echo.
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$c=New-Object Net.Sockets.TcpClient; try {$c.Connect('127.0.0.1',3000); exit 0} catch {exit 1} finally {if($c){$c.Close()}}" >nul 2>nul
if not errorlevel 1 (
  start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-browser-new-window.ps1"
  exit /b 0
)

start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-browser-new-window.ps1"
echo يتم تشغيل النظام محلياً. اترك هذه النافذة مفتوحة أثناء الاستخدام.
echo لا يتم إرسال بيانات الشكاوى إلى خادم خارجي.
echo.
node.exe --env-file=.env server.js
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo توقف النظام برمز: %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
