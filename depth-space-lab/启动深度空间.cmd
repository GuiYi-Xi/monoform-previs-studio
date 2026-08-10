@echo off
setlocal
cd /d "%~dp0"

set "NPM_CMD="
for /f "delims=" %%I in ('where npm.cmd 2^>nul') do if not defined NPM_CMD set "NPM_CMD=%%I"
if not defined NPM_CMD if exist "D:\nodejs\npm.cmd" set "NPM_CMD=D:\nodejs\npm.cmd"
if not defined NPM_CMD if exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM_CMD=%ProgramFiles%\nodejs\npm.cmd"

if not defined NPM_CMD goto :no_node

if not exist "node_modules\vite\bin\vite.js" (
  echo Installing project dependencies...
  call "%NPM_CMD%" install
  if errorlevel 1 goto :failed
)

echo Starting Depth Space Lab...
echo The browser should open automatically.
echo If it does not, use the Local address shown below.
call "%NPM_CMD%" run dev -- --host 127.0.0.1 --port 4179 --open
if errorlevel 1 goto :failed
goto :done

:no_node
echo Node.js or npm.cmd was not found.
echo Install Node.js, then double-click this file again.
pause
exit /b 1

:failed
echo.
echo Depth Space Lab failed to start. See the error above.
pause
exit /b 1

:done
endlocal
