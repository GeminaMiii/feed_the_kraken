@echo off
chcp 65001 >nul
title 险恶疑航 - 公网开关
echo ==============================
echo  险恶疑航 公网隧道 开启
echo ==============================
echo.
rem 检查本机游戏服务是否在运行
curl -s -m 3 http://localhost:3000/healthz >nul 2>&1
if errorlevel 1 (
  echo [!] 游戏服务器(端口3000)没有运行，请先双击根目录的 start.bat
  pause
  exit /b
)
echo [OK] 本机游戏服务运行中
echo.
echo 正在建立隧道，一般需要 3~8 秒...
echo（建立成功后，下面会出现一个 https://xxxx.trycloudflare.com 地址）
echo.
echo 发给朋友的链接就是那个地址。关闭本窗口 = 关闭公网入口。
echo.
cd /d "%~dp0"
cloudflared.exe tunnel --url http://localhost:3000 --no-autoupdate
pause
