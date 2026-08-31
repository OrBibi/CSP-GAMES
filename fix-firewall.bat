@echo off
:: Opens Windows Firewall for Phone Tennis (ports 3000, 8080, 3443).
:: Prefer start.bat — it opens the firewall and starts the game server together.
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Requesting Administrator privileges...
  powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Fixing Windows Firewall for Phone Tennis...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\firewall-open.ps1"

echo.
echo Firewall is ready. To start the game, run start.bat
echo.
pause
