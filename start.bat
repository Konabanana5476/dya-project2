@echo off
cd /d "%~dp0"

echo ================================
echo  Dynamite Baseball Proxy
echo  http://localhost:8080/
echo ================================
echo.

if not exist "proxy.js" (
  echo [ERROR] proxy.js not found.
  echo Place proxy.js in the same folder as start.bat.
  pause
  exit /b 1
)
if not exist "dya_online.html" (
  echo [ERROR] dya_online.html not found.
  echo Place dya_online.html in the same folder as start.bat.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Install it from https://nodejs.org
  pause
  exit /b 1
)

echo  Press Ctrl+C to stop
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8080/"

node proxy.js

pause
