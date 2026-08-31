@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ========================================
echo   Phone Tennis - Start
echo ========================================
echo.

net session >nul 2>&1
if not "%errorLevel%"=="0" (
  echo Administrator approval required - firewall and clean start...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 1
)

echo [0/3] Stopping any old server/tunnel on port 3000...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-game.ps1" -Quiet -SkipFirewallRestore
timeout /t 2 /nobreak >nul

echo [1/3] Opening Windows Firewall for ports 3000, 8080, 3443...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\firewall-open.ps1"
if not "%errorLevel%"=="0" (
  echo Firewall setup failed.
  pause
  exit /b 1
)

echo.
echo [2/3] Starting server + Cloudflare tunnel...
echo [3/3] Wait for trycloudflare.com URL, then refresh the lobby with Ctrl+F5.
echo Close this window or press Ctrl+C to stop. Firewall restores on exit.
echo.

node start-with-tunnel.js
set "EXIT_CODE=%errorLevel%"

echo.
echo Restoring Windows Firewall...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\firewall-restore.ps1"

if exist "public\tunnel.json" del /f /q "public\tunnel.json"

echo Done.
exit /b %EXIT_CODE%
