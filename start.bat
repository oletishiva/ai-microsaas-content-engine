@echo off
cd /d "%~dp0"
if not exist node_modules call npm install --no-audit --no-fund --omit=dev
node scripts\start.js
pause
