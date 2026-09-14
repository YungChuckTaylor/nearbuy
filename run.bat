@echo off
REM NearBuyGoods local launcher (Windows)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18+ is required: https://nodejs.org
  pause
  exit /b 1
)
echo Starting NearBuyGoods on http://localhost:3000 ...
start "" http://localhost:3000
node server.js
pause
