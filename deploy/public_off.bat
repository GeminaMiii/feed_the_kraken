@echo off
title FTK Public Tunnel
taskkill /F /IM cloudflared.exe >nul 2>&1
echo Public tunnel closed. Local access (localhost / LAN) is not affected.
pause
