@echo off
chcp 65001 >nul
title MONOFORM · 素形启动器
cd /d "%~dp0"

echo.
echo 正在启动 MONOFORM...
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先从 https://nodejs.org/ 安装。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 首次启动：正在安装运行依赖，请保持网络连接...
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络连接后重试。
    pause
    exit /b 1
  )
)

echo 浏览器将自动打开。
echo 使用期间请勿关闭此窗口；需要停止时可在这里按 Ctrl+C。
echo.

call npm run dev -- --host 127.0.0.1 --port 5173 --open

echo.
echo MONOFORM 已停止。
pause
