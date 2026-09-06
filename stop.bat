@echo off
chcp 65001 >nul
title FTK Server - STOP
cd /d "%~dp0"

echo [1/2] Stopping game server (port 3000) ...
netstat -ano > "%TEMP%\ftk_net.txt"
set FOUND=0
for /f "tokens=5" %%a in ('findstr ":3000 .*LISTENING" "%TEMP%\ftk_net.txt"') do (
  taskkill /F /PID %%a >nul 2>&1
  set FOUND=1
)
if "%FOUND%"=="1" (echo [OK] server stopped.) else (echo [i] server was not running.)

echo [2/2] Stopping public tunnel (cloudflared) ...
taskkill /F /IM cloudflared.exe >nul 2>&1 && echo [OK] tunnel stopped. || echo [i] tunnel was not running.

echo.
All services stopped. Data saved in packages\server\data\ftk.db
pause
