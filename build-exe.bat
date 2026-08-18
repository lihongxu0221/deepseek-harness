@echo off
setlocal
cd /d "%~dp0"

echo Building DeepSeek Harness Web desktop...
call pnpm exec tsx scripts/build-web-exe.ts --targets=node24-win-x64 %*
if errorlevel 1 exit /b 1

echo.
echo Output folder: dist-exe\dsh-web-win-x64
echo Double-click dsh-web.exe in that folder to open the Web UI.
echo Keep the whole folder together; do not copy the exe alone.
echo Close the app window or the console to stop the server.
