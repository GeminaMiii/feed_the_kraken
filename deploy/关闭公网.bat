@echo off
chcp 65001 >nul
taskkill /F /IM cloudflared.exe >nul 2>&1
echo 公网入口已关闭（本机局域网/localhost 访问不受影响）。
pause
