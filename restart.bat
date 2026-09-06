@echo off
chcp 65001 >nul
title FTK Server - port 3000
cd /d "%~dp0"

echo [1/3] Building engine / server / client ...
call npm run build -w packages/engine >nul 2>&1 || goto BUILDFAIL
call npm run build -w packages/server >nul 2>&1 || goto BUILDFAIL
call npm run build -w packages/client >nul 2>&1 || goto BUILDFAIL
echo [OK] build done.

echo [2/3] Stopping old server on port 3000 ...
netstat -ano > "%TEMP%\ftk_net.txt"
for /f "tokens=5" %%a in ('findstr ":3000 .*LISTENING" "%TEMP%\ftk_net.txt"') do taskkill /F /PID %%a >nul 2>&1
echo [OK] old server stopped (if any).

echo [3/3] Starting server on port 3000 ...
rem DB path is pinned so saves survive no matter where you start from
set "FTK_DB=%~dp0packages\server\data\ftk.db"
echo.
echo   Local:    http://localhost:3000
echo   LAN:      http://your-ip:3000
echo   Public:   deploy\public_on.bat  (tunnel)
echo.
echo Press Ctrl+C to stop.
node packages\server\dist\index.js
goto :eof

:BUILDFAIL
echo [!] Build failed. Check the messages above.
pause
