@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "node_modules" (
  echo 正在安装独立项目依赖...
  call npm install
  if errorlevel 1 goto :error
)

echo 正在启动 Depth Space Lab...
call npm run dev
exit /b %errorlevel%

:error
echo.
echo 启动失败，请确认已经安装 Node.js。
pause
exit /b 1
