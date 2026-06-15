@echo off
REM AirRO Water — double-click launcher. Runs start.ps1 with the right policy.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
echo.
pause
