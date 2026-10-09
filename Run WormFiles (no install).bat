@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Run "Install WormFiles.bat" first.
  pause
  exit /b 1
)
if not exist node_modules\electron call npm install --no-fund --no-audit
start "" /min cmd /c "npx electron ."
