@echo off
cd /d "%~dp0"
start "Neon Clash Arena v12 Server" cmd /k "cd /d "%~dp0" && npm start"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000/"
