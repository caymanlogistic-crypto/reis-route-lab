@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS first.
  pause
  exit /b 1
)
if not exist node_modules call npm install
start "" http://127.0.0.1:4317
call npm start
pause
