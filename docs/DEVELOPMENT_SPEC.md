# 《险恶疑航》在线版 · 开发任务清单与代码 Spec

> 依据：2026-09 对 `dev_trj` 分支的全量代码调研（engine 1735 行核心 + server + client）。
> 结论背景：**不迁移 boardgame.io**，在现有「服务端权威 + 确定性引擎 + 视图投影」架构上增量补齐产品能力。
> 本文档是可直接开工的工程任务书：每个任务含变更文件、接口定义、协议/存储变更、实现要点、验收标准与测试要求。

---

## 0. 总原则（所有任务必须遵守）

1. **引擎零改动优先**：`@ftk/engine` 保持纯确定性状态机，不引入真实时间、不依赖网络。计时器、观战、再来一局全部实现在 `packages/server` 层。本路线图所有任务**均不改 `GameState` 结构，`SAVE_VERSION` 保持 3**，旧存档无需迁移。
2. **同一权威通道**：机器人、超时托管与真人命令都走 `RoomManager.applyGameCommand`（校验 + 串行队列 + `reqId` 幂等），不新增旁路。
3. **秘密不出服务端**：任何新视图（观战/回放）必须经由 `buildPlayerView` / `buildSpectatorView` 投影后下发。
4. **增量交付**：任务间无强依赖（除标注外），可独立合并、独立回滚；每任务附测试，`npm test` 全绿是合并门槛。

### 里程碑总览

| 里程碑 | 任务 | 主题 | 预估 |
|---|---|---|---|
| M1 可玩性 | T1-T4 | 机器人自动行动 / 计时提醒 / 再来一局 | ~4-6 人日 |
| M2 观战与回放 | T5-T6 | 观战模式 / 命令日志与复盘 | ~5-7 人日 |
| M3 体验 | T7-T9 | 移动端 / 动画音效 / 规则内助 | ~4-6 人日 |
| M4 打磨 | T10-T13 | 聊天日志 / 大厅 / 无障碍 / 技术债 | ~3-4 人日 |

---

## M1 · 可玩性修复（P0，建议立即开工）

### T1 接线 BotRunner：机器人自动行动

**问题**：`packages/server/src/bots.ts:194` 的 `BotRunner` 已完整实现（去抖调度、被拒后按 attempt 轮换候选、防死循环），但无任何调用点。大厅「🤖 添加机器人」后机器人不会行动，需房主手动逐个代打。

**变更文件**：
- `packages/server/src/rooms.ts` — 新增 1 个公有方法
- `packages/server/src/index.ts` — 实例化并接线 BotRunner（约 30 行）
- `packages/server/src/tests/e2e.test.ts` — 新增 E2E

**接口设计**：

```ts
// rooms.ts 新增（放在 botSeats() 旁边）
/** 机器人座位的过滤视图（仅机器人座位；真人座位返回 null） */
gameViewForSeat(roomId: string, seatId: number): PlayerView | null {
  const room = this.rooms.get(roomId);
  if (!room || !room.state || room.row.status !== 'playing') return null;
  if (!room.bots.has(seatId)) return null;
  return this.filterViewForSeat(room, room.state, seatId);
}

/** 所有进行中且有机器人的房间（供启动时补 kick） */
playingRoomIdsWithBots(): string[];
```

```ts
// index.ts 接线（rooms 实例化之后）
import { BotRunner } from './bots';

const BOT_AUTO = process.env.FTK_BOT_AUTO !== '0'; // 默认开启

// 房间级 reqId 计数器：Bot 命令也要走幂等通道，必须严格递增。
// 初值取 Date.now() 保证跨重启后必然大于旧值（lastReqBySeat 为内存态，重启即清零，双保险）。
const botReqCounters = new Map<string, number>();
function nextBotReqId(roomId: string): number {
  const n = Math.max(botReqCounters.get(roomId) ?? 0, Date.now()) + 1;
  botReqCounters.set(roomId, n);
  return n;
}

const botRunner = new BotRunner({
  botSeats: (roomId) => rooms.botSeats(roomId),
  getGameView: (roomId, seatId) => rooms.gameViewForSeat(roomId, seatId),
  applyBotCommand: (roomId, seatId, cmd) =>
    rooms.applyGameCommand(roomId, seatId, cmd, nextBotReqId(roomId)),
  onChanged: (roomId) => broadcastRoom(roomId),
});
```

**kick 触发点**（共 3 处，全部在 `index.ts`）：
1. `command` 事件 `.then()` 成功广播后：`if (BOT_AUTO) botRunner.kick(roomId);`
2. `lobby` 事件 `case 'start'` 成功后：同上。
3. 服务启动后：`for (const id of rooms.playingRoomIdsWithBots()) botRunner.kick(id);`（覆盖服务器重启期间的进行中对局）。

**实现要点**：
- `BotRunner.applyBotCommand` 内部走房间 Promise 队列，与真人命令天然串行，无竞态。
- 决策被规则拒绝时 `BotRunner.think` 的 catch 已处理（attempt 轮换），不需要额外逻辑。
- 保留现有手动代打通道（`asSeat`）作为调试后门；自动行动开启时手动代打仍合法（先到先得，后者被规则拒绝）。
- 机器人延迟复用现有环境变量命名 `FTK_BOT_DELAY_MIN`/`FTK_BOT_DELAY_MAX`（README 已标注"已弃用"，本任务恢复其语义；默认 400/1200ms）。E2E 中注入 5/15ms 加速。

**验收标准**：
- 一名真人 + 4 机器人开局，无任何手动操作，对局能在合理时间内自动推进到合法终局。
- 机器人行动后所有真人客户端收到 `roomView` 刷新（含日志）。
- `FTK_BOT_AUTO=0` 时行为与现状完全一致（纯手动代打）。

**测试**：
- E2E `bots auto-play to completion`：建房 + addBot×4 + start，轮询（超时 60s，间隔 200ms）等待 `fullView().game.result !== null`；断言 result 结构合法。
- E2E `bot commands obey idempotency`：自动行动期间并发提交同一真人命令 ×3，状态只前进一次（沿用现有幂等测试思路）。

---

### T2 待行动计时与超时托管

**问题**：引擎与服务端均无计时。玩家挂机 → 全桌死等 72h 后归档。同时客户端不知道「已经等了多久」。

**设计**：计时状态放 server 层（`RoomWrap`），不进引擎；视图输出等待座位与起始时间；超时仅对「激活窗口」自动 pass（可配），关键决策（哗变交枪、任命等）**永不自动代打**——避免破坏社交推理的公平性。

**变更文件**：`rooms.ts`、`index.ts`、`client/src/ui/PlayersPanel.tsx`、`client/src/ui/GameView.tsx`、`client/src/styles.css`

**数据结构**：

```ts
// rooms.ts — RoomWrap 增加字段（内存态，不落盘）
interface RoomWrap {
  // ... 现有字段
  pendingSig: string | null;   // 当前待决策集合的签名
  pendingSince: number;        // 签名出现时刻 (ms)
}

// 签名 = 未决 pending 的 id 列表 + 激活窗口参与者
function pendingSignature(state: GameState): string {
  const pend = state.pending.map((p) => `${p.id}@${p.actorSeat}`).join(',');
  const win = state.activation
    ? `${state.activation.windowKind}:${state.activation.passedSeats.join(',')}`
    : '';
  return `${pend}|${win}`;
}
```

在 `applyGameCommandSync` 成功路径（`engineApply` 之后、`persist` 之前）调用：

```ts
private refreshPendingSig(room: RoomWrap, state: GameState) {
  const sig = pendingSignature(state);
  if (sig !== room.pendingSig) {
    room.pendingSig = sig;
    room.pendingSince = Date.now();
  }
}
```

**视图协议变更**（`RoomFullView` / `PlayerView` 之外新增顶层字段，客户端 `api.ts` 同步类型）：

```ts
export interface WaitingInfo {
  seats: number[];   // 当前需要行动的真人座位（机器人除外）
  since: number;     // 本组待决开始时间戳
}
// RoomFullView 增加
waiting?: WaitingInfo;
```

`fullView()` 中组装：等待座位 = `view.pending.filter(p => p.mine === false...)`——服务端直接从 `state` 计算：pending 的 actorSeat 中排除 bots，再并上激活窗口中未 pass 的存活真人。

**超时自动 pass**（`index.ts`，默认关闭，`FTK_PENDING_TIMEOUT_MS`，建议生产 180000）：

```ts
setInterval(() => {
  const timeout = Number(process.env.FTK_PENDING_TIMEOUT_MS ?? 0);
  if (timeout <= 0) return;
  for (const roomId of rooms.playingRoomIds()) {
    const info = rooms.waitingInfo(roomId);
    if (!info || Date.now() - info.since < timeout) continue;
    for (const seat of info.seats) {
      // 仅激活窗口超时 pass；pending（关键决策）不动
      if (rooms.seatOnlyAwaitingWindow(roomId, seat)) {
        void rooms.applyGameCommand(roomId, seat, { type: 'pass' }, nextBotReqId(roomId))
          .then(() => {
            rooms.systemChatFor(roomId, `${rooms.seatName(roomId, seat)} 超时，自动通过了本轮行动窗口。`);
            broadcastRoom(roomId);
          })
          .catch(() => { /* 已被真人解决则忽略 */ });
      }
    }
  }
}, 5_000);
```

`seatOnlyAwaitingWindow(roomId, seat)`：视图判断 `activationWindowKind && !youPassedWindow && pending.every(p => !p.mine)`。

**客户端**：
- `GameView` 顶栏 `waitingFor` 处：有 `waiting.seats` 包含自己时显示倒计时条（`已等待 m:ss`，颜色随时间加深）。
- `PlayersPanel` 的 `PlayerCard`：等待者卡片加呼吸光圈 + 「等待中 m:ss」徽标。

**验收**：
- 视图能显示每个等待者及其等待时长；pending 变化后计时重置。
- 超时只自动 pass 窗口，`mutinySubmit`/`appointTeam` 等永不自动；关闭变量后无任何行为变化。

**测试**：
- 单测（`rooms` 层）：`pendingSignature` 变化重置 `pendingSince`；`waitingInfo` 排除机器人座位。
- E2E：注入 `FTK_PENDING_TIMEOUT_MS=50` + 假等待，断言激活窗口座位被自动 pass 且日志出现系统消息。

---

### T3 「轮到你了」强提醒

**问题**：玩家切 tab 即错过回合，无 toast / 标题闪烁 / 声音 / 系统通知。

**变更文件**：`client/src/api.ts`、`client/src/App.tsx`、`client/src/ui/GameView.tsx`、`client/src/styles.css`（新增 `client/src/notify.ts`）

**接口设计**（新模块 `notify.ts`，无第三方依赖）：

```ts
export interface NotifySettings {
  sound: boolean;      // 默认 true
  desktop: boolean;    // Notification API，默认 false（需用户在设置里开启并授权）
}
export function loadNotifySettings(): NotifySettings;
export function saveNotifySettings(s: NotifySettings): void;

/** 当「我需要行动」从 false → true 跳变时调用 */
export function notifyMyTurn(reasonZh: string, settings: NotifySettings): void;
```

`notifyMyTurn` 行为：
1. `document.title` 闪烁（`🎯 轮到你了 · 险恶疑航` ↔ 原标题，3 次后恢复；用 `setInterval`，页面 `visibilitychange` 可见时立即恢复）。
2. toast：右下角滑入卡片，显示 `reasonZh`（取自 `view.pending.find(p => p.mine)?.reasonZh` 或「你有行动窗口可以启动角色」），点击聚焦页面并关闭。
3. 声音：WebAudio 合成短促双音（两个 oscillator，无音频文件资产），遵守 `prefers-reduced-motion` 时不做视觉动画但仍响铃。
4. 桌面通知：`Notification.requestPermission()` 通过后 `new Notification('险恶疑航', { body: reasonZh })`。

**跳变检测**（`App.tsx` 或 `GameView.tsx`）：

```ts
const myTurn = useMemo(
  () => !!view?.game && !view.game.result && !view.game.you.eliminated &&
    (view.game.pending.some((p) => p.mine) ||
      (!!view.game.activationWindowKind && !view.game.youPassedWindow)),
  [view],
);
const prev = useRef(myTurn);
useEffect(() => {
  if (myTurn && !prev.current) notifyMyTurn(reasonZh, loadNotifySettings());
  prev.current = myTurn;
}, [myTurn]);
```

设置入口：`GameView` 顶栏铃铛图标 → 弹出开关（存 `localStorage: ftk_notify`）。

**验收**：后台 tab 收到回合时出现标题闪烁 + 声音；关掉开关后完全静默；`prefers-reduced-motion` 下无动画。

**测试**：手动验收为主；补充组件冒烟（渲染设置弹窗、localStorage 读写）。

---

### T4 再来一局（rematch）

**问题**：对局结束房间即废（ended 永久滞留，座位不可离开），无法快速开下一局——社交局最大流程断点。

**变更文件**：`rooms.ts`、`index.ts`、`client/src/ui/Lobby.tsx`、`client/src/ui/ActionPanel.tsx`（ResultPanel）、`client/src/api.ts`

**协议**：`lobby` 事件新增 action：

```ts
{ action: 'rematch' }   // 仅 ended 状态、仅房主
```

**服务端实现**（`rooms.ts`）：

```ts
/** 对局结束后回到大厅：保留房间码/座位/房主/口令；上局结果摘要进 configJson 包装层 */
rematch(roomId: string, seatId: number): void {
  const room = this.rooms.get(roomId);
  if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
  if (room.row.status !== 'ended') throw new RoomError('NOT_ENDED', '对局尚未结束');
  if (!room.seats.get(seatId)?.isHost) throw new RoomError('NOT_HOST', '只有房主可以发起来一局');
  const result = room.state?.result ?? null;
  room.state = null;
  room.row.gameJson = null;
  room.row.status = 'lobby';
  room.lastReqBySeat = {};
  room.pendingSig = null;
  for (const s of room.seats.values()) {
    s.ready = room.bots.has(s.seatId); // 机器人自动准备
    this.store.updateSeat(roomId, s.seatId, { ready: s.ready });
  }
  this.systemChat(room, '新的一局已就绪，请大家准备！');
  this.persist(room); // persist 写入 gameJson=null + status='lobby'
}
```

`persist()` 不需要改——`room.state` 为 null 时不写 gameJson 的分支已满足（需确认 `persist` 中 `if (room.state)` 分支；`room.row.gameJson` 已手动置 null）。

**配套修改**：

1. `configJson` 包装层新增 `lastResult`（在 `persist` 中与 `bots` 一起序列化）：
   ```ts
   lastResult: result ? { winner: result.winner, reasonZh: result.reasonZh, ts: Date.now() } : null
   ```
   `LobbyView` 增加 `lastResult?: { winner: string; reasonZh: string } | null`，`lobbyView()` 透出；`Lobby.tsx` 顶部显示「上局：海盗获胜（…）」。
2. **允许 ended 离座**：`leaveRoom` 的状态检查改为
   ```ts
   if (room.row.status === 'playing') throw new RoomError('GAME_STARTED', '对局中不能离开座位（可以断线）');
   ```
   （lobby 与 ended 均可离座；房主转移逻辑复用现有代码。）
3. 客户端：`ResultPanel` 底部按钮——房主「再来一局」（`sendLobby(socket, { action: 'rematch' })`）；非房主显示「等待房主开始下一局…」；另加「退出房间」按钮（ended 状态现在可用）。
4. `lobby` 事件 handler（`index.ts`）加 `case 'rematch': rooms.rematch(roomId, seatId); break;`。

**边界与风险**：
- 对局中途（playing）离座依旧禁止，与现状一致。
- rematch 后 `startGame` 复用现有满员 + 全员 ready 检查；不在线玩家保留座位（回来后可继续），房主可用现有 `removePlayer` 清理。
- 观战者（T5 完成后）在 rematch 后将被踢回首页或转 lobby 等待（T5 spec 中处理）。
- 聊天保留（不重置），系统消息提示新局。

**验收**：完整打完一局 → 房主点「再来一局」→ 全员回到大厅、机器人已 ready、房间码不变、口令仍有效 → 再次 start 成功；上局结果在大厅可见。

**测试**：
- E2E `rematch resets room to lobby`：跑完对局（可用现有 `driveGame`）→ rematch → 断言 `lobbyView.status === 'lobby'`、机器人 ready、`startGame` 再次成功。
- E2E `ended seat can leave`：ended 后 leave 成功且房主正确转移。

---

## M2 · 观战与回放（P1）

### T5 观战模式

**问题**：`engine/src/views.ts:263` 的 `buildSpectatorView` 已存在但 server/client 完全未接入。对局开始后无法加入房间（`joinRoom` 抛 `GAME_STARTED`）。

**核心决策（隐私红线）**：
- 观战者看 **spectator 视图**（不含任何秘密：阵营/手牌/角色全部隐藏，仅公开信息）——不是上帝视角。这样 playing 期间观战无泄密风险，UI 无需警告横幅。
- **观战者禁止发言**（`chat` 事件服务端直接拒绝）：避免任何形式的信息注入/干扰。V1 只读。
- 上帝视角复盘由 T6 回放功能承担（仅 ended 后开放全知视图）。

**变更文件**：`store.ts`（新表）、`rooms.ts`、`index.ts`、`client/src/api.ts`、`client/src/App.tsx`、`client/src/ui/GameView.tsx`

**存储**（`store.ts` migrate 追加，向后兼容）：

```sql
CREATE TABLE IF NOT EXISTS spectators (
  room_id TEXT NOT NULL,
  spectator_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, spectator_id)
);
```

`Store` 新增：`addSpectator()` / `getSpectators(roomId)` / `findSpectatorByTokenHash(hash)` / `clearSpectators(roomId)`（rematch 与 cleanup 时调用）。

**REST**：
```
POST /api/rooms/:roomId/spectate   { name: string }
→ { roomId, token, spectatorId }
```
- 复用 `limiterJoin` 限流；仅 `status === 'playing' || 'ended'` 允许；每房间上限 `FTK_MAX_SPECTATORS`（默认 10）。
- 观战口令：房间有密码时观战也需要口令（body 带 `password`，同一 `verifyPassword`）。

**Socket 协议**：
- 连接：`connectSocket` 的 `auth` 增加可选 `role: 'spectator'`。`io.use` 中间件逻辑：先按玩家 token `resolveToken`；未命中且 `role === 'spectator'` 时按 `resolveSpectatorToken(token)` 反查（token 同样走 HMAC `hashToken`，可索引）。命中后 `socket.data.spectatorId = n`。
- `sessions` 记录改为 `{ roomId, seatId: number, spectatorId?: number }`。
- 事件权限：`command` / `lobby` / `chat` handler 开头检测 `sess.spectatorId !== undefined` → `ack?.({ error: { code: 'SPECTATOR_READONLY', message: '观战者不能操作' } })` 并 return。
- 视图：`sendFullView` 中 spectator 分支：
  ```ts
  const view = rooms.fullView(sess.roomId, -1, { spectator: true });
  ```
  `fullView` 签名改为 `fullView(roomId, seatId, opts?: { spectator?: boolean })`：spectator 时 `game = filterViewForSeat(room, state, -99)`（复用 `buildSpectatorView` + connected 叠加），`lobby = null`，`log` 仅 `visibility === 'public'`，并附 `spectators: { id, name }[]`。
- `LobbyView.seats` 无需暴露 spectator（大厅页对观战者显示「观战连接中」）。

**引擎侧小改**（`views.ts`，需引擎测试同步）：核实 `buildPlayerView(state, -99)` 的 `you` 桩安全（`seatOf` 对不存在座位的行为）。若当前实现依赖真实座位，则给 `buildSpectatorView` 补桩：
```ts
you: { seatId: -1, name: '观战者', faction: null, characterId: null, characterRevealed: false,
       guns: 0, offDuty: false, noTongue: false, eliminated: false, teammates: [] }
```
**不改 `GameState`**，`SAVE_VERSION` 不变。

**客户端**：
- `Home` 增加「观战」Tab：输入房间码（+口令如有）→ `apiSpectate(roomId, name, password?)` → 存 `localStorage ftk_spectate_sessions`（独立于 `ftk_sessions`）→ 连 socket。
- `GameView` spectator 模式：隐藏 `ActionPanel`/手牌条/代打条，ActionPanel 位置显示「👁 观战中」+ 座位名册 + 棋盘 + 公开日志；聊天面板**只读**（输入框替换为「观战模式不可发言」）。
- 断线重连逻辑复用（`api.ts` 的连接管理对 spectator token 同样生效）。

**清理**：`rematch()`（T4）调用 `clearSpectators`；`cleanup()` 归档时同步清理；spectator 无座位不参与 `ready`/`start` 判定。

**验收**：playing 期间以观战身份进入可看到公开信息；任何 spectator token 提交 command/chat 均被拒（带错误码）；玩家视图与观战视图均不含秘密（抽查网络帧）；rematch 后观战连接收到 lobby 状态或提示。

**测试**：
- E2E `spectator can join playing room and is readonly`：中局加入 → sync 收到 game 视图 → chat 返回 `SPECTATOR_READONLY` → command 同样被拒。
- E2E `spectator view leaks no secrets`：观战视图 JSON 中 `you.faction === null`、所有 `players[].faction === null`、`yourHand` 为空。
- 引擎单测：`buildSpectatorView` 输出安全桩（若改 views.ts）。

---

### T6 命令日志与对局回放

**问题**：只存最终快照，无命令级历史；结束后无复盘。引擎是确定性的（Rng 注入 + fuzz 已验证），「初始种子 + 命令序列」即可完整重建任意时刻——这是现成优势，也是本任务的成本基础。

**变更文件**：`store.ts`、`rooms.ts`、`index.ts`、client 新增 `ReplayView.tsx`、`api.ts`

**存储**（migrate 追加）：

```sql
CREATE TABLE IF NOT EXISTS commands (
  room_id TEXT NOT NULL,
  seq INTEGER NOT NULL,          -- 房间级单调递增
  kind TEXT NOT NULL,            -- 'setup' | 'command'
  seat_id INTEGER,               -- command 时有效
  payload TEXT NOT NULL,         -- JSON
  ts INTEGER NOT NULL,
  PRIMARY KEY (room_id, seq)
);
```

- `startGame` 成功时写入 `kind='setup'`：
  ```json
  { "seats": [{ "seatId": 0, "name": "..." }], "config": {...}, "rngState": [种子状态数组] }
  ```
  ⚠️ `rngState` 即 `state.seededRngState`（`createGameState` 执行后立即读）——**种子必须从首局状态取**，因为 `createGameState` 内部已消费随机数。
- `applyGameCommandSync` 中 `engineApply` 成功且非幂等跳过后 append `kind='command', payload=cmd`；`seq` 复用 `RoomWrap` 新增计数器 `cmdSeq`（内存 + 每次 persist 写回 `row.seq`，重启恢复取 `MAX(seq)`）。
- 机器人/代打/超时托管命令一视同仁记录（`seat_id` 为实际行动座位）。

**回放 API**：

```
GET /api/rooms/:roomId/replay
→ { setup, commands: [{ seq, seatId, payload, ts }], finalResult, seatNames }
```
- 权限：`status === 'ended'` 时任何人（带任意有效玩家/观战 token 或干脆公开——为防爬虫，要求房内 token 或房间已 ended；V1 要求 ended + 无凭据亦可，roomCode 即弱凭据）。
- `playing` 中仅房内成员可拉取（防中途窥探——虽然 spectator 视图无秘密，但命令序列含 `submitGuns` 数量！哗变提交期拉命令日志会泄露枪数）。**必须只对 ended 开放无凭据访问；playing 期间一律拒绝（403）。**

**客户端重放**（`ReplayView.tsx`，核心优势：`@ftk/engine` 已在 client bundle 中）：

```ts
import { createGameState, applyCommand, buildSpectatorView } from '@ftk/engine';
import { SeededRng } from '@ftk/engine';

function replayAt(setup, commands, uptoSeq): PlayerView {
  const rng = SeededRng.fromState(setup.rngState); // 需确认 rng.ts 的 fromState 形态（已有 exportState/fromState）
  let state = createGameState(setup.seats, setup.config, rng);
  for (const c of commands.filter((x) => x.seq <= uptoSeq)) {
    applyCommand(state, c.seatId, c.payload); // applyCommand 内含 advance() 自动推进
  }
  return buildSpectatorView(state);
}
```
- UI：ended 结果面板新增「查看复盘」→ 全屏回放页：底部滑杆（seq 0..N）+ 步进按钮 + 自动播放（500ms/步）；棋盘复用现有皮肤组件（`boards/registry`）；日志面板渲染 `state.log` 的 public 条目。
- 性能：每次 seek 从头重放。500 条命令内纯计算 <100ms（fuzz 单局同量级）。优化项（可选）：每 50 步缓存快照。
- ⚠️ `applyCommand` 是「恢复 RNG → 执行 → 写回」模式，纯函数式重放时直接传 state 引用即可（`engineApply` 内部处理 rngState 读写）；若签名不符，包一层与 `applyGameCommandSync` 相同的调用。

**验收**：
- 完整对局结束后拉取 replay，客户端重放 `seq=N` 的最终状态与服务器 `game_json` 快照**深度相等**（除 `log` 截断差异外——`pushLog` 上限 600 两侧一致，应完全相等）。
- playing 期间访问 replay API 返回 403。
- 回放中哗变提交枪数只在对应阶段推进后可见（重放本身是 spectator 视图，枪数公开时才出现在视图中）。

**测试**：
- E2E `replay reproduces final state`：复用现有完整对局 E2E，结束后 GET replay → Node 侧重放 → `assert.deepStrictEqual(replayedState, serverGameState)`。
- 单测：`seq` 跨重启单调（重启后从 MAX(seq)+1 继续）。

---

## M3 · 体验提升（P1-P2）

### T7 移动端适配

**现状**：仅 `@media (max-width: 1100px)` 一个断点；`styles.css` 三栏 260px/1fr/340px；无手机布局。

**实现要点**（全部在 `styles.css` + 组件结构微调，无逻辑变更）：
1. 新断点 `@media (max-width: 640px)`：
   - 布局改单列纵向：棋盘 → 代打/角色 → ActionPanel → 手牌 → 底部 Tab 切换（`PlayersPanel` / `日志` / `聊天`）。
   - `PlayersPanel` 折叠为横向滚动头像条（名字 + 枪数 + 徽章，点开弹出完整 PlayerCard）。
2. 触控目标：所有按钮 `min-height: 44px; min-width: 44px`（含步进器、聊天发送）。
3. `viewport` meta 已有（`index.html`）；补 `theme-color` 与 iOS 安全区 `env(safe-area-inset-*)`。
4. 棋盘 `geometry.ts` 的 `buildLayout` 列宽下限 88px → 手机上允许横向平移（容器 `overflow-x: auto`）或双指缩放（`touch-action: pan-x pinch-zoom`）。

**验收**：375px 宽（iPhone SE）可完整走一局：所有 pending 可操作、聊天可用、无横向溢出 body。

### T8 动画与音效

**实现要点**：
1. **船移动动画**：`ClassicBoard`/`OfficialBoard` 中船标记（SVG `<g transform>`）加 `transition: transform 600ms cubic-bezier(...)`；配合现有 `prevShipHex` 金色虚线，实现「先画轨迹再滑动」。船数据已在视图中（`shipHex`/`prevShipHex`），无需协议变更。
2. **音效**（`notify.ts` 扩展，WebAudio 合成，无资产文件）：
   - `myTurn`（T3 已做）/ 哗变揭示（低音鼓点）/ 仪式发动（不祥和弦）/ 对局结束（胜利琶音）。
   - 触发点：`GameView` 在 `view` 跳变时 diff `mutinyPublic.stage`、`ritualsRevealed.length`、`result`。
   - 统一音量/开关设置（复用 T3 的 `ftk_notify` 设置，加 `volume` 字段）。
3. **结果面板**：阵营揭示表逐行淡入（CSS animation, `prefers-reduced-motion` 时禁用）。

**验收**：船平滑移动；关键事件有声音且可一键静音；`prefers-reduced-motion` 下无动画。

### T9 规则内助

**实现要点**（纯静态内容，零服务端变更）：
1. 新组件 `client/src/ui/RulesHelp.tsx`：顶栏「📖 规则」按钮 → 全屏 Modal。
   - Tab 1 回合流程图（任命→哗变→航海→黄牌→停职，用现有 `STAGE_ZH` 阶段标签 + 简述）；
   - Tab 2 角色速查表（数据源 `engine/src/data/characters.ts` 的 `CHARACTER_MAP`，直接 import，22 张牌中文名 + 效果 + 启动时机；复用现有角色卡图 `public/characters/*.jpg`）；
   - Tab 3 术语与终局（三阵营胜利条件、哗变阈值表——数据源 `gamedata.ts`）。
2. 新手模式（可选，二期）：首局在 ActionPanel 上方显示一行阶段提示（复用 `waitingForText`）。

**验收**：不离开页面可查全部规则要点；数据与引擎同源（改 `characters.ts` 自动同步）。

---

## M4 · 打磨与技术债（P2）

### T10 聊天与日志增强

| # | 项 | 实现 | 位置 |
|---|---|---|---|
| 1 | 快捷短语 | 聊天框上方预设 chips：「我怀疑X号」「我不是海盗」「请求哗变」等，点击填入（X 号从玩家列表选择替换） | `GameView.tsx` |
| 2 | 字数上限统一 | 前端 `maxLength=200` → 300，与服务端 `sanitizeChat`（1-300）一致 | `GameView.tsx` |
| 3 | 出局禁言 | `chat()` 中 `if (seat 在 state 且 eliminated) throw new RoomError('ELIMINATED', '你已出局，请保持安静')` | `rooms.ts:480` |
| 4 | 日志加载更多 | `fullView` 的 `slice(-120)` → `slice(-300)`；客户端日志面板顶部「加载更早」按钮（再拉需分页 API，V1 直接放大 slice 即可，单条日志 <200B，300 条 ≈60KB 可接受） | `rooms.ts:533` |
| 5 | 时间戳显示 | 日志条目 hover 显示 `ts` 的 `HH:mm`（CSS `::after` + `title` 属性） | `GameView.tsx` |

### T11 大厅体验

| # | 项 | 实现 |
|---|---|---|
| 1 | 一键复制房间码 | `navigator.clipboard.writeText`，Lobby 与 GameView 顶栏房号旁 📋 按钮 + 「已复制」toast |
| 2 | 直达加入链接 | 首页解析 `location.hash` `#/join/AB3K9X` → 自动填入加入表单并聚焦；Lobby 房号旁「复制邀请链接」生成 `${origin}/#/join/${roomId}` |
| 3 | 昵称记忆 | `localStorage ftk_nickname`，Home 表单 defaultValue；每次成功建房/加入后更新 |

### T12 无障碍

| # | 项 | 实现 |
|---|---|---|
| 1 | Esc 关闭弹窗 | 所有 Modal（角色查看/规则帮助/设置）监听 `keydown Escape`；打开时 `focus trap`（Tab 循环圈闭在弹窗内），关闭后焦点还原触发按钮 |
| 2 | 日志播报 | 日志容器 `aria-live="polite"`；聊天 `aria-live="off"`（避免干扰） |
| 3 | 对比度 | `styles.css` 中 `.badge`、小字灰阶统一提到 WCAG AA（4.5:1），用浏览器 DevTools 审计后改色值 |

### T13 技术债清理

| # | 项 | 现状 | 处理 |
|---|---|---|---|
| 1 | `archiveStaleRooms` 死代码 | `store.ts:136` 从未被调用 | **删除**（`cleanup()` 已在内存侧完成归档）；同时补 `store.deleteArchivedRooms(olderThanDays=7)` 在 cleanup 周期调用，清理库内滞留的 archived 行 |
| 2 | 限流器溢出全清 | `util.ts` `RateLimiter` 超 `maxKeys=10000` 时 `buckets.clear()` 误伤正常用户 | 淘汰最旧一半：按插入序（Map 迭代序）删 `Math.floor(size/2)` 个 key |
| 3 | `lastReqBySeat` 重启丢失 | 重启窗口内旧请求可重放（极低风险） | `persist` 时写入 configJson 包装层 `lastReqBySeat`，`loadFromStore` 恢复（约 5 行，顺手做掉） |
| 4 | 客户端不发 heartbeat | server `index.ts:185` 监听但客户端不调用 | `api.ts` `connectSocket` 后 `setInterval(() => socket.emit('heartbeat'), 30_000)`，`disconnect` 清除；保持 `lastSeen` 新鲜度（为 T2 的离线判定兜底） |
| 5 | `lobby:left` 未监听 | server 发出但客户端忽略 | `App.tsx` 监听：`clearSession(roomId)` + 回首页 + toast「已离开房间」 |

---

## 横切关注点

### 测试基线
- 每任务合并前：`npm test`（引擎 72 项 + E2E）全绿；新增测试随任务交付（见各任务「测试」小节）。
- T1/T2 的 E2E 需要加速时钟：`BotRunner` 构造参数注入 `minDelayMs=5, maxDelayMs=15`（通过测试环境变量 `FTK_BOT_DELAY_MIN/MAX` 传入，替换 index.ts 中的默认值）。

### 兼容性
- 所有 SQLite 变更走 `CREATE TABLE IF NOT EXISTS`（T5 spectators、T6 commands），旧库启动自动升级，无数据迁移。
- `configJson` 包装层新增字段（`lastResult`、`lastReqBySeat`）解析时 `?? 默认值`，旧存档天然兼容。
- Socket 协议只增不改（`lobby.rematch`、`waiting` 字段、spectator role），旧客户端与新服务端组合下新字段被忽略，不崩溃。

### 发布顺序建议
```
T1（立即，1 人日内） → T4 → T3 → T2 → T5 → T6 → T7 → T9 → T8 → T10-T13（可并行穿插）
```
T1 单独先行：改动最小（~40 行）、收益最大（一人即可完整试局，为后续所有 E2E 验收提速）。

### 明确不做（本期范围外）
- 语音、AI 智能机器人策略（当前 bot 为简单策略，定位调试/陪练）
- 引擎规则变更（`SAVE_VERSION` 保持 3）
- 迁移 boardgame.io 或任何引擎框架替换（已论证否决）
- 地图数据重核验（独立于代码，见 `docs/RULES_NOTES.md` §8）
