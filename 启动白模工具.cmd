@echo off
title StageFrame Launcher
cd /d "%~dp0"

echo.
echo Starting StageFrame...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install it from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First launch: installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed. Check your network connection.
    pause
    exit /b 1
  )
)

echo The browser will open automatically.
echo Keep this window open while using StageFrame.
echo Press Ctrl+C here when you want to stop.
echo.

call npm run dev -- --host 127.0.0.1 --port 5173 --open

echo.
echo StageFrame stopped.
pause
