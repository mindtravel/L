@echo off
rem =====================================================================
rem Start the local HTTP/WebSocket server, then open the game page.
rem =====================================================================
cd /d "%~dp0"
if not exist "node_modules\ws" (
  echo Dependencies are missing. Run npm install first.
  pause
  exit /b 1
)
start "L server" cmd /k npm start
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000"
