@echo off
setlocal
cd /d "%~dp0"
title WormFiles - build and share
echo.
echo  ===================================
echo    WormFiles - build and share
echo  ===================================
echo.

where node >nul 2>nul
if not errorlevel 1 goto have_node

echo  Node.js is needed to build WormFiles (one time only).
echo  Installing it with winget...
echo.
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto no_node
set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>nul
if errorlevel 1 goto restart_needed

:have_node
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set "VER=%%v"
if not defined VER goto fail
echo  Building WormFiles %VER%
echo.

echo  [1/4] Getting Electron and the ad blocker (fast after the first time)...
call npm install --no-fund --no-audit
if errorlevel 1 goto fail

echo.
echo  [2/4] Clearing out old installers...
if exist dist del /q "dist\WormFiles Setup *.exe" "dist\WormFiles Setup *.exe.blockmap" "dist\WormFiles-Setup-*.exe" "dist\WormFiles-Setup-*.exe.blockmap" "dist\WormFiles-Portable-*.exe" "dist\latest.yml" 2>nul

echo.
echo  [3/4] Building the installer...
call npm run build
if not errorlevel 1 goto built
echo.
echo  Retrying the build without editing the .exe icon...
call npx electron-builder --win nsis portable -c.win.signAndEditExecutable=false
if errorlevel 1 goto fail

:built
set "SETUP=dist\WormFiles-Setup-%VER%.exe"
if not exist "%SETUP%" goto fail

echo.
echo  [4/4] Putting the installer in OneDrive for your friends...
set "OD=%OneDrive%"
if not defined OD set "OD=%OneDriveConsumer%"
if not defined OD set "OD=%USERPROFILE%\OneDrive"
set "SHARED="
if not exist "%OD%" goto no_onedrive
if not exist "%OD%\WormFiles" mkdir "%OD%\WormFiles"
rem Same file name every time, so a link you've already shared keeps working and always gets the newest version
copy /y "%SETUP%" "%OD%\WormFiles\WormFiles Setup.exe" >nul
if errorlevel 1 goto no_onedrive
set "SHARED=%OD%\WormFiles\WormFiles Setup.exe"
echo        Updated: %SHARED%
goto ask_install

:no_onedrive
echo        Couldn't find OneDrive - skipped. The installer is in the dist folder.

:ask_install
echo.
echo  ===================================
echo    Done! WormFiles %VER% is ready.
echo  ===================================
echo.
if defined SHARED (
  echo  To share: right-click "WormFiles Setup.exe" in OneDrive\WormFiles, choose Share, copy the link.
  echo  You only need to do that once - the same link gets every future update.
  echo.
)
choice /c YN /n /m "  Install WormFiles %VER% on this PC now? [Y/N] "
if errorlevel 2 goto finish
echo.
echo  If WormFiles is open, the installer will ask you to close it first.
start "" "%SETUP%"

:finish
echo.
pause
exit /b 0

:no_node
echo.
echo  Couldn't install Node.js automatically.
echo  Please install the LTS version from https://nodejs.org and run this file again.
start "" https://nodejs.org
pause
exit /b 1

:restart_needed
echo.
echo  Node.js was installed. Please close this window and double-click this file again.
pause
exit /b 1

:fail
echo.
echo  Something went wrong - scroll up to see the error.
pause
exit /b 1
