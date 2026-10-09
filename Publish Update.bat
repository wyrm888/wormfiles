@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title WormFiles - publish to GitHub
set "REPO=wormfiles"
echo.
echo  ==========================================
echo    WormFiles - publish an update to GitHub
echo  ==========================================
echo.

rem ---------- Tools (installed once, with winget) ----------
call :need node OpenJS.NodeJS.LTS "%ProgramFiles%\nodejs" || goto restart_needed
call :need git Git.Git "%ProgramFiles%\Git\cmd" || goto restart_needed
call :need gh GitHub.cli "%ProgramFiles%\GitHub CLI" || goto restart_needed

rem ---------- Sign in to GitHub (first time only) ----------
gh auth status >nul 2>nul
if not errorlevel 1 goto signed_in
echo  Sign in to GitHub. Press Enter when asked, then approve WormFiles in your browser.
echo.
gh auth login --hostname github.com --git-protocol https --web
if errorlevel 1 goto fail
:signed_in
gh auth setup-git >nul 2>nul
set "OWNER="
for /f "usebackq delims=" %%u in (`gh api user -q .login`) do set "OWNER=%%u"
for /f "usebackq delims=" %%u in (`gh api user -q .id`) do set "GHID=%%u"
if not defined OWNER goto fail
echo  Signed in as %OWNER%
echo.

rem ---------- Version number (must be new for each release) ----------
:readver
set "VER="
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set "VER=%%v"
if not defined VER goto fail
gh release view v%VER% --repo %OWNER%/%REPO% >nul 2>nul
if errorlevel 1 goto ver_ok
echo  Version %VER% is already on GitHub.
choice /c YN /n /m "  Bump the version number and publish anyway? [Y/N] "
if errorlevel 2 goto cancelled
call npm version patch --no-git-tag-version >nul
goto readver
:ver_ok
echo  Publishing WormFiles %VER%
echo.

rem ---------- Repository (created the first time) ----------
echo  [1/4] Checking github.com/%OWNER%/%REPO% ...
gh repo view %OWNER%/%REPO% >nul 2>nul
if not errorlevel 1 goto repo_ok
echo        Creating the public repository...
gh repo create %REPO% --public --description "WormFiles - a customizable file explorer for Windows 11 with Worm, a built-in privacy browser"
if errorlevel 1 goto fail
:repo_ok

rem ---------- Upload the code ----------
echo.
echo  [2/4] Uploading the code...
if not exist .gitignore (
  > .gitignore echo node_modules/
  >> .gitignore echo dist/
)
if not exist .git git init -b main >nul
git config user.name "%OWNER%"
git config user.email "%GHID%+%OWNER%@users.noreply.github.com"
git remote get-url origin >nul 2>nul || git remote add origin https://github.com/%OWNER%/%REPO%.git
git add -A
git commit -q -m "WormFiles %VER%" >nul 2>nul
rem Bring in anything edited on the GitHub website (like the README) before uploading
git ls-remote --exit-code --heads origin main >nul 2>nul
if errorlevel 1 goto push
git pull -q --rebase origin main
if errorlevel 1 goto pull_failed
:push
git push -q -u origin main
if errorlevel 1 goto push_failed

rem ---------- Build, with update info pointing at this repository ----------
echo.
echo  [3/4] Building the installer...
call npm install --no-fund --no-audit
if errorlevel 1 goto fail
if exist dist del /q "dist\WormFiles Setup *.exe" "dist\WormFiles Setup *.exe.blockmap" "dist\WormFiles-Setup-*.exe" "dist\WormFiles-Setup-*.exe.blockmap" "dist\WormFiles-Portable-*.exe" "dist\latest.yml" 2>nul
call npx electron-builder --win nsis portable --publish never -c.publish.provider=github -c.publish.owner=%OWNER% -c.publish.repo=%REPO%
if not errorlevel 1 goto built
echo  Retrying the build without editing the .exe icon...
call npx electron-builder --win nsis portable --publish never -c.publish.provider=github -c.publish.owner=%OWNER% -c.publish.repo=%REPO% -c.win.signAndEditExecutable=false
if errorlevel 1 goto fail
:built
set "SETUP=dist\WormFiles-Setup-%VER%.exe"
if not exist "%SETUP%" goto fail
if not exist "dist\latest.yml" goto fail

rem ---------- Publish the release ----------
echo.
echo  [4/4] Publishing release v%VER%...
gh release create v%VER% "%SETUP%" "%SETUP%.blockmap" "dist\latest.yml" "dist\WormFiles-Portable-%VER%.exe" --repo %OWNER%/%REPO% --target main --title "WormFiles %VER%" --notes "Download **WormFiles-Setup-%VER%.exe** below and run it. If you already have WormFiles installed from here, it updates itself."
if errorlevel 1 goto fail

set "LINK=https://github.com/%OWNER%/%REPO%/releases/latest"
echo %LINK%| clip
echo.
echo  ==========================================
echo    Done! WormFiles %VER% is published.
echo  ==========================================
echo.
echo  Link for your friends (copied - just paste it):
echo    %LINK%
echo.
echo  Anyone who installs from that link gets future updates automatically.
echo.
choice /c YN /n /m "  Install WormFiles %VER% on this PC now? [Y/N] "
if errorlevel 2 goto finish
echo  If WormFiles is open, the installer will ask you to close it first.
start "" "%SETUP%"
:finish
echo.
pause
exit /b 0

rem ---------- helpers ----------
:need
where %1 >nul 2>nul && exit /b 0
echo  Installing %1 (one time only)...
winget install -e --id %2 --accept-package-agreements --accept-source-agreements >nul
set "PATH=%PATH%;%~3"
where %1 >nul 2>nul && exit /b 0
exit /b 1

:restart_needed
echo.
echo  Something was just installed. Close this window and double-click this file again.
pause
exit /b 1

:pull_failed
git rebase --abort >nul 2>nul
echo.
echo  A file was changed both here and on the GitHub website, so Git doesn't know
echo  which version to keep. Nothing was uploaded - tell Claude which file it was.
pause
exit /b 1

:push_failed
echo.
echo  Couldn't upload the code. If you edited files on the GitHub website,
echo  those changes conflict with this copy - tell Claude what happened.
pause
exit /b 1

:cancelled
echo  Cancelled - nothing was published.
pause
exit /b 1

:fail
echo.
echo  Something went wrong - scroll up to see the error.
pause
exit /b 1
