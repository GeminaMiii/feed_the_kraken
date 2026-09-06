# 公网联机部署指南

《险恶疑航》服务器监听 `0.0.0.0:3000`。本机启动后，按下面三种情况选择。

> ⚠ 重要：绑定 0.0.0.0 / 局域网能访问 ≠ 公网能访问。公网需要下列方案之一。

---

## 情况 A：家里宽带没有公网 IP / 运营商 CGNAT（最常见）

推荐使用 **Cloudflare Tunnel**（免费、支持 WebSocket、不需要开放路由器端口）。

### 前提
1. 一个 Cloudflare 账号（免费）；
2. 一个已托管在 Cloudflare 的域名（如果没有域名，可使用下方的快速试用模式）。

### 快速试用（无需域名，5分钟，临时地址）

一键脚本（推荐）：
- `deploy/public_on.bat` —— 双击开启：自动检查本机服务器，建立隧道并在窗口显示
  `https://xxxx.trycloudflare.com` 公网地址，发给朋友即可。**关闭窗口=关闭公网入口**。
- `deploy/public_off.bat` —— 双击关闭公网（不影响本机/局域网访问）。

手动方式（等效）：
```bash
# 1. 下载 cloudflared（Windows）
#    https://github.com/cloudflare/cloudflared/releases 下载 cloudflared-windows-amd64.exe
#    放到 deploy/ 目录并改名为 cloudflared.exe

# 2. 服务器启动后，另开一个命令行窗口：
cloudflared.exe tunnel --url http://localhost:3000 --no-autoupdate

# 3. 终端会输出一个 https://xxxx.trycloudflare.com 地址
#    把这个地址发给朋友即可联机（HTTPS 自动配置，WebSocket 原生支持）。
```
限制：临时地址每次开启都会变化，仅用于快速体验。

### 正式固定域名
```bash
# 1. 登录
cloudflared tunnel login

# 2. 创建隧道
cloudflared tunnel create ftk
# 输出会给出 Tunnel UUID，并生成 ~/.cloudflared/<UUID>.json 凭据

# 3. 配置 DNS（把你的子域名指向隧道）
cloudflared tunnel route dns ftk ftk.你的域名.com

# 4. 配置文件 ~/.cloudflared/config.yml
# tunnel: <UUID>
# credentials-file: C:\Users\你\.cloudflared\<UUID>.json
# ingress:
#   - hostname: ftk.你的域名.com
#     service: http://localhost:3000
#   - service: http_status:404

# 5. 运行（可注册为 Windows 服务开机自启）
cloudflared tunnel run ftk
cloudflared service install   # 可选：注册为系统服务
```

### 备选方案
- **ngrok**：`ngrok http 3000`，免费版地址随机、有带宽限制，同样支持 WebSocket。
- **frp / 自建 VPS 反向隧道**：需要一台有公网 IP 的 VPS，配置 `frpc.ini` 中 `remotePort`，详见 frp 官方文档（https://github.com/fatedier/frp）。

---

## 情况 B：有公网 IP（路由器拨号获得 100.x 之外的 WAN IP）

1. **路由器端口映射**：将路由器 WAN 的 `3000/tcp` 转发到本机 `192.168.x.x:3000`。
   - WebSocket 走同一端口（socket.io 用 HTTP 升级实现），无需额外映射。
2. **Windows 防火墙**放行（管理员 PowerShell）：
   ```powershell
   New-NetFirewallRule -DisplayName "FeedTheKraken" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
   ```
3. 朋友访问 `http://你的公网IP:3000`。
4. **强烈建议加 HTTPS**（否则聊天内容明文传输）：
   - 方式一：域名 + Cloudflare 代理（DNS 橙云开启即可获得 HTTPS）；
   - 方式二：本机用 Caddy 反向代理 443 → 3000（自动签发证书）：
     ```
     ftk.你的域名.com {
       reverse_proxy localhost:3000
     }
     ```
5. 设置环境变量 `FTK_ALLOWED_ORIGIN=https://ftk.你的域名.com` 后重启服务器。

---

## 情况 C：部署到云服务器（有公网 IP 的 VPS）

1. 安装 Node.js ≥ 20 与 Docker（可选）。
2. 上传项目目录，`docker compose up -d --build`（见项目根目录 docker-compose.yml），
   或非 Docker：`npm install && npm run build && npm start`。
3. 安全组/防火墙放行 3000（或用 Nginx/Caddy 反代 + HTTPS）：
   ```nginx
   location / {
     proxy_pass http://127.0.0.1:3000;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;      # WebSocket 升级
     proxy_set_header Connection "upgrade";
     proxy_set_header Host $host;
     proxy_read_timeout 300s;                     # 避免 WS 空闲断开
   }
   ```
4. 同样建议设置 `FTK_ALLOWED_ORIGIN=https://你的域名`。

---

## 生产安全清单
- [ ] 设置 `FTK_ALLOWED_ORIGIN` 为具体来源（关闭任意跨域）
- [ ] 使用 HTTPS（反代或隧道自动提供）
- [ ] 定期备份 `data/ftk.db`（对局存档都在这一个文件里）
- [ ] 不要把数据库文件提交到仓库或发给他人（含房间口令哈希）

## 验证公网是否真正打通
1. 用手机（关闭 Wi-Fi，使用流量）打开你的公网地址 → 应看到"险恶疑航"首页。
2. 首页创建房间，另一台设备加入 → 能进入同一大厅即成功。
