@echo off
REM One-step setup for Windows: double-click this file.
cd /d "%~dp0"
echo == AI Content Studio setup ==
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Opening the download page - install the LTS version, then double-click setup.bat again.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)
echo Installing (FFmpeg is bundled - nothing else to install)...
call npm install --no-audit --no-fund --omit=dev
if errorlevel 1 ( echo Install failed - check your internet connection and try again. & pause & exit /b 1 )
if not exist .env copy .env.example .env >nul
node scripts\doctor.js
echo.
echo Starting Studio - your browser will open. Add your key on the first screen.
node scripts\start.js
pause
