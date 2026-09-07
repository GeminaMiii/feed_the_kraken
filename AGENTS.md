# AGENTS.md — AI 编程代理工作规范

本文件约束所有 AI 代理在本仓库的代码修改行为。人读版开发任务书见 `docs/DEVELOPMENT_SPEC.md`（下称 SPEC）。

## 项目概述

《险恶疑航》(Feed the Kraken) 5-11 人隐藏身份推理桌游的在线实现。npm workspaces 单仓三包：

```
packages/engine/   规则引擎：纯 TS 确定性状态机，零外部依赖，可独立测试
packages/server/   Express + Socket.IO + SQLite(node:sqlite)：会话/房间/命令管道/持久化
packages/client/   React 18 + Vite：三栏中文界面，服务端权威的瘦客户端
docs/              规则笔记(RULES_NOTES.md)、覆盖矩阵(RULES_COVERAGE.md)、开发任务书(DEVELOPMENT_SPEC.md)
```

## 常用命令

```bash
npm install && npm run build   # 构建全部（engine → server → client，有依赖顺序）
npm test                       # 引擎 72 项 + fuzz + 服务端 E2E（必须全绿才能合并）
npm run dev:server             # 服务端开发模式（端口 3000）
npm run dev:client             # 客户端 Vite 开发模式（代理 /api 与 /socket.io 到 3000）
```

- 改 `packages/engine/**` 后必须重新 build 才会生效于 server 测试（E2E 跑 `dist/`）。
- E2E 随机端口启动真实服务器进程，跑完自动回收；单个 E2E 超时上限 130s。

## 架构铁律（违反即返工）

1. **服务端权威**：客户端只提交命令意图（`Command` 类型）；所有结算、随机、信息过滤在服务端。绝不在 client 计算游戏结果。
2. **秘密不出服务端**：任何下发客户端的数据必须经过 `engine/views.ts` 的 `buildPlayerView(state, seatId)` / `buildSpectatorView(state)` 投影。他人阵营/手牌/角色/未揭示枪数永不进网络响应。新增视图功能时先想清楚"这条数据谁能看"。
3. **引擎纯净**：`@ftk/engine` 不依赖网络/数据库/真实时间；随机只经 `Rng` 接口注入（`SeededRng` 状态序列化在 `GameState.seededRngState`）。计时器、超时、机器人调度一律放 `packages/server`，不进 `GameState`。
4. **同一命令通道**：真人、机器人（BotRunner）、代打（`asSeat`）、超时托管全部走 `RoomManager.applyGameCommand`（校验 → 房间 Promise 队列串行 → `reqId` 幂等）。不得新增旁路直接改状态。
5. **引擎确定性**：`初始种子 + 命令序列` 必须能完整重建对局（回放功能的根基）。`startGame` 记录 `createGameState` **之前**的 `rng.exportState()`。

## 关键模块地图

| 入口 | 说明 |
|---|---|
| `engine/src/engine.ts` `applyCommand(state, seatId, cmd)` | 唯一状态变更入口：恢复 RNG → 派发 → 写回 RNG → `advance()` 自动推进 |
| `engine/src/views.ts` `buildPlayerView` / `buildSpectatorView` | 视图投影；`seatOf(state, seatId)` 对不存在座位抛异常——观战走 `SPECTATOR_SEAT` 桩 |
| `engine/src/types.ts` | `GameState`/`Command`/`PlayerView` 全部类型；`SAVE_VERSION` 当前 = 3，本路线图不升版 |
| `server/src/rooms.ts` `RoomManager` | 房间生命周期、命令串行化、`fullView()` 个性化视图组装 |
| `server/src/index.ts` | HTTP + Socket.IO 事件协议（`sync`/`command`/`lobby`/`chat`/`heartbeat`）|
| `server/src/bots.ts` `botDecide` / `BotRunner` | 机器人纯函数决策 + 去抖调度器 |
| `client/src/api.ts` | 唯一通信层：REST 建房/加入 + socket 封装（`reqId` 单调递增幂等号）|

## 协议与存储约定

- **Socket 协议只增不改**：新增事件/字段必须让旧客户端忽略后不崩溃；错误统一 `{ code, message }`。
- **SQLite**：所有表结构变更走 `CREATE TABLE IF NOT EXISTS`（`store.ts migrate()`），旧库启动自动升级；房间 = 快照行（`game_json` 全量序列化），每次状态变更落盘。
- **configJson 包装层**：`{ config, passwordHash, bots, botAuto, lastResult, ... }`——服务端专属元数据放这里，解析时一律 `?? 默认值` 保持旧存档兼容。
- **reqId 幂等**：每个座位 `lastReqBySeat` 内存记录，`reqId <= last` 静默忽略。任何程序化提交命令（BotRunner/超时托管）必须用独立的单调计数器（初值 `Date.now()` 起步保证跨重启安全）。

## 编码规范

- TypeScript strict；中文注释与中文 UI 文案；文件头部保留模块说明注释块。
- React 组件不引第三方状态库；`ActionPanel` 用 `key={pending.id}` 强制重挂载隔离交互态的模式要延续。
- 样式集中在 `client/src/styles.css`（"夜航"主题：深海蓝底 + 灯笼金强调）；动画须尊重 `prefers-reduced-motion`。
- 时间一律 `Date.now()` 毫秒时间戳。
- 禁止提交 `console.log` 调试输出、`.only` 测试、注释掉的死代码。

## 测试要求

- 引擎改动 → 在 `engine/src/tests/` 补规则单测（固定种子复现）。
- 服务端改动 → `server/src/tests/e2e.test.ts` 补 E2E；现有 E2E 环境注入 `FTK_BOT_AUTO=0` 保持手动驱动语义，验证 BotRunner 的新用例须用 `lobby` action `setBotAuto` 显式开启。
- 新增协议字段 → 同步更新 `client/src/api.ts` 的镜像类型。
- 合并门槛：`npm install && npm run build && npm test` 全绿。

## 提交规范

Conventional Commits（`feat:`/`fix:`/`docs:`/`test:`/`chore:`），一行中文主题 + 必要的正文说明动机。一个任务一个提交，不混合无关改动。

## 当前路线图

按 `docs/DEVELOPMENT_SPEC.md` 执行 M1-M4（T1-T13）。已定决策不得翻案：

- 不迁移 boardgame.io（已论证否决）。
- T2 超时只自动 pass **激活窗口**；哗变交枪、任命等关键决策永不自动代打。
- T5 观战者只读（禁 chat/command）且看 spectator 视图（非上帝视角）；上帝视角复盘仅 ended 后（T6）。
- T6 回放 API 仅 ended 状态开放（playing 期间命令日志含哗变枪数，泄密）。
