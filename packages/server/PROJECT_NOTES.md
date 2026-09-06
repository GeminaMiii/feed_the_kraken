# 项目进度备忘（内部）

## 已完成
- 规则引擎 @ftk/engine（确定性状态机 + 注入式RNG）：开局/哗变/航海/地图行动/角色22张/仪式/终局
- 引擎测试 72 项全通过（含 fuzz 完整对局：无死锁、组件守恒、隐私不泄露）
- 服务端 @ftk/server：REST(创建/加入) + Socket.IO(同步/命令/聊天) + SQLite(node:sqlite) 持久化
  + 会话token(scrypt盐哈希) + 命令幂等(reqId单调) + 限速 + 房间串行化队列
- 客户端 @ftk/client（React+Vite 中文界面）：首页/大厅/对局(地图SVG/玩家/行动面板/日志/聊天)/终局公布
- 浏览器实测：创建房间→6人(5 bot)→开始→8+轮完整流程→仪式分配→掉线刷新恢复会话 ✓
- 启动脚本 start.bat（Windows 一键）、.env.example、deploy/PUBLIC_NETWORK.md（公网三方案）

## 已知问题（待办）
- [ ] index.html 静态缓存 1h → 改为 html 不缓存
- [ ] 服务端集成测试文件（多会话隔离/伪造token/跨房间/重启恢复/并发命令）未落盘
- [ ] E2E 完整对局测试（socket.io 驱动至终局）未落盘
- [ ] 快航程地图数据（官方无结构化数据）— 需要用户提供照片或确认
- [ ] 长航程地图出口表逐格核验（当前为社区逆向数据，图标分布已核对）
- [ ] Docker 文件、README、规则覆盖矩阵、备份恢复文档
- [ ] 手牌区 minicard 占位符（🟡）待实现真实显示
- [ ] bots.mjs 为演示脚本，不在交付测试内

## 运行命令
- 启动: start.bat 或 node packages/server/dist/index.js（先 build）
- 测试: npm test（engine 72 项）
- 端口 3000，数据库 packages/server/data/ftk.db

## 公网隧道（快速试用模式，2026-09-06 实测）
- 命令: deploy/cloudflared.exe tunnel --url http://localhost:3000 --no-autoupdate
- 实测地址: https://million-improvement-side-government.trycloudflare.com
- 已验证: HTTPS页面 ✓ REST创建房间 ✓ WebSocket对局通道 ✓
- 注意: 该地址在隧道重启后会变化；正式固定域名见 deploy/PUBLIC_NETWORK.md
