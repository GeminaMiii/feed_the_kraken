@echo off
rem ===== Feed the Kraken - one-click launcher (Windows) =====
rem First run installs dependencies and builds; later runs take seconds.
cd /d "%~dp0"
if not exist node_modules (
  echo [1/3] Installing dependencies...
  call npm install --no-audit --no-fund || goto :err
)
if not exist packages\engine\dist call npm run build -w packages/engine || goto :err
if not exist packages\server\dist call npm run build -w packages/server || goto :err
if not exist packages\client\dist call npm run build -w packages/client || goto :err
echo [2/3] Starting server...
echo.
echo   Local:  http://localhost:3000
echo   Public: see deploy/PUBLIC_NETWORK.md
echo.
rem --- port guard: fail with a clear message instead of flashing ---
netstat -ano | findstr /C:":3000" | findstr /C:"LISTENING" >nul 2>&1
if not errorlevel 1 goto :portbusy
echo [3/3] Press Ctrl+C to stop the server
node packages\server\dist\index.js
if errorlevel 1 goto :runerr
goto :eof
:portbusy
echo [!] Port 3000 is already in use - a game server may be running.
echo     If not, run release_port.bat to find and kill the process, then retry.
echo.
pause
exit /b 1
:runerr
echo [!] Server exited with an error - check the log above.
echo     Common causes: node missing, deps not installed, port in use, corrupt DB.
echo.
pause
exit /b 1
:err
echo [!] Startup failed - check the error above.
pause
