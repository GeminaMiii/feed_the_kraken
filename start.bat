@echo off
chcp 65001 >nul
rem ===== 险恶疑航 - 一键启动（Windows）=====
rem 首次运行会自动安装依赖并构建，之后启动只需数秒
cd /d "%~dp0"
if not exist node_modules (
  echo [1/3] 安装依赖...
  call npm install --no-audit --no-fund || goto :err
)
if not exist packages\engine\dist call npm run build -w packages/engine || goto :err
if not exist packages\server\dist call npm run build -w packages/server || goto :err
if not exist packages\client\dist call npm run build -w packages/client || goto :err
echo [2/3] 启动服务器...
echo.
echo   本机访问:   http://localhost:3000
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr "IPv4"') do echo   局域网访问: http://%%a:3000
echo   公网访问:   见 deploy/PUBLIC_NETWORK.md
echo.
echo [3/3] 按 Ctrl+C 停止服务器
node packages\server\dist\index.js
goto :eof
:err
echo 启动失败，请检查上方错误信息
pause
