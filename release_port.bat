@echo off
rem ===== release_port.bat - inspect and kill the process holding a port =====
rem Usage: release_port.bat [port]   (default: 3000)
rem Asks for confirmation before killing anything (manual kill).
setlocal enabledelayedexpansion

set "PORT=%~1"
if "%PORT%"=="" set "PORT=3000"

netstat -ano | findstr /C:":%PORT% " | findstr /C:"LISTENING" >nul 2>&1
if errorlevel 1 (
  echo [OK] Port %PORT% is free - nothing to kill.
  pause
  exit /b 0
)

echo [X] Port %PORT% is occupied by:
echo.
set "SEEN= "
set /a IDX=0
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /C:":%PORT% " ^| findstr /C:"LISTENING"') do (
  echo(!SEEN! | findstr /C:" %%P " >nul 2>&1
  if errorlevel 1 (
    set "SEEN=!SEEN!%%P "
    set /a IDX+=1
    set "NAME="
    for /f "delims=," %%N in ('tasklist /fi "PID eq %%P" /fo csv /nh 2^>nul') do if not defined NAME set "NAME=%%N"
    if not defined NAME set "NAME=(unknown)"
    echo   [!IDX!] PID %%P   !NAME!
    set "PID_!IDX!=%%P"
  )
)

echo.
set "CHOICE="
set /p "CHOICE=Kill which one? [number / a = all / Enter = cancel] "
if "%CHOICE%"=="" (
  echo Cancelled - nothing was killed.
  pause
  exit /b 0
)

if /i "%CHOICE%"=="a" goto :kill_all
set "TARGET=!PID_%CHOICE%!"
if not defined TARGET (
  echo [!] Invalid choice: %CHOICE%
  pause
  exit /b 1
)
call :killp !TARGET!
goto :verify

:kill_all
for /l %%I in (1,1,%IDX%) do (
  set "TARGET=!PID_%%I!"
  call :killp !TARGET!
)
goto :verify

:killp
echo Killing PID %1 ...
taskkill /f /t /pid %1 >nul 2>&1
if errorlevel 1 (
  echo [X] Failed to kill PID %1 - try running this script as Administrator.
) else (
  echo [OK] PID %1 killed.
)
goto :eof

:verify
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr /C:":%PORT% " | findstr /C:"LISTENING" >nul 2>&1
if errorlevel 1 (
  echo.
  echo [OK] Port %PORT% is now free. You can run start.bat again.
) else (
  echo.
  echo [!] Port %PORT% is still in use - another process may have taken it.
)
echo.
pause
exit /b 0
