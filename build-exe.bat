@echo off
setlocal
cd /d "%~dp0"

rem A production NODE_ENV makes pnpm skip devDependencies, including tsx.
set NODE_ENV=

if not exist "node_modules\tsx\dist\cli.mjs" (
  echo Installing workspace dependencies including tsx...
  call pnpm.cmd install --config.confirmModulesPurge=false
  if errorlevel 1 exit /b 1
)

if not exist "node_modules\tsx\dist\cli.mjs" (
  echo tsx is not installed. Run: pnpm install
  echo Do not use --prod; the desktop build needs devDependencies.
  exit /b 1
)

echo Building DeepSeek Harness Web desktop...
node "node_modules\tsx\dist\cli.mjs" scripts/build-web-exe.ts --targets=node24-win-x64 %*
if errorlevel 1 exit /b 1

echo.
echo Output folder: dist-exe\dsh-web-win-x64
echo Double-click dsh-web.exe in that folder to open the Web UI.
echo Keep the whole folder together; do not copy the exe alone.
echo Close the tray icon to stop the server.
