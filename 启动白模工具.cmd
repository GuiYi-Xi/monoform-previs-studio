@echo off
setlocal
title MONOFORM Launcher
cd /d "%~dp0"

echo.
echo ========================================
echo   MONOFORM Previs Studio
echo ========================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1"
if errorlevel 1 (
  echo.
  echo [STARTUP FAILED] See the error above.
  echo Online version:
  echo https://guiyi-xi.github.io/monoform-previs-studio/
)

echo.
echo Press any key to close this window.
pause >nul
exit /b %ERRORLEVEL%
