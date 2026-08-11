@echo off
chcp 65001 >nul
title MONOFORM · 素形启动器
cd /d "%~dp0"

echo.
echo ========================================
echo   MONOFORM · 素形白模预演工作台
echo ========================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1"
set "MONOFORM_EXIT=%ERRORLEVEL%"

if not "%MONOFORM_EXIT%"=="0" (
  echo.
  echo [启动未完成] 请查看上方错误信息。
  echo 也可以直接使用在线版：
  echo https://guiyi-xi.github.io/monoform-previs-studio/
)

echo.
echo 按任意键关闭窗口...
pause
exit /b %MONOFORM_EXIT%
