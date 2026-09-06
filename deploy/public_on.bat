@echo off
chcp 65001 >nul
title FTK Public Tunnel
cd /d "%~dp0"

curl -s -m 3 http://localhost:3000/healthz >nul 2>&1
if errorlevel 1 goto NOSERVER

echo [OK] Local server is running on port 3000.
echo.
echo Starting tunnel... wait 3-8 seconds.
echo Your public link is the https://xxxx.trycloudflare.com shown below.
echo Share that link with friends. Close this window to close public access.
echo.

cloudflared.exe tunnel --url http://localhost:3000 --no-autoupdate
echo.
echo Tunnel exited.
pause
goto :eof

:NOSERVER
echo [!] Game server is NOT running. Start start.bat first.
pause
