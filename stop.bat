@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo ========================================
echo   Phone Tennis - Stop
echo ========================================
echo.

net session >nul 2>&1
if not "%errorLevel%"=="0" (
  echo Administrator approval required to stop the server...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-game.ps1"

echo.
pause
