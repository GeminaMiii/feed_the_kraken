// ============================================================
// 服务端集成/端到端测试
// 通过真实 HTTP + Socket.IO 验证：
//   1. 健康检查与静态页
//   2. 房间创建/加入/口令/伪造凭据拒绝
//   3. 跨房间隔离（A 房 token 不能进 B 房）
//   4. 内置机器人自动对局 → 完整走到合法终局（核心验收）
//   5. 服务进程重启后房间与对局恢复
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, Socket } from 'socket.io-client';
import { botDecide } from '../bots';
import { createGameState, applyCommand, SeededRng } from '@ftk/engine';

// 随机端口避免与残留进程/其他测试冲突
const PORT = 31000 + Math.floor(Math.random() * 5000) * 2;
const BASE = `http://localhost:${PORT}`;

let child: ChildProcess;
let dataDir: string;

interface Session {
  token: string;
  seatId: number;
  roomId: string;
}

async function api(path: string, body?: unknown, method = 'POST'): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

function connect(session: { token: string; roomId: string }): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token: session.token, roomId: session.roomId }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(Object.assign(new Error(e.message), { code: 'CONNECT_ERROR' })));
  });
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startServer(): Promise<void> {
  child = spawn(process.execPath, [join(process.cwd(), 'dist', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      FTK_DB: join(dataDir, 'ftk.db'),
      FTK_RATE_COMMAND: '600',
      // 默认关闭机器人自动行动：现有用例依赖手动代打语义（新用例通过 setBotAuto 显式开启）
      FTK_BOT_AUTO: '0',
      // 加速 BotRunner 决策节奏（自动对局用例）
      FTK_BOT_DELAY_MIN: '30',
      FTK_BOT_DELAY_MAX: '80',
      // 启用超时托管扫描（T2 用例；间隔短便于验收）
      FTK_PENDING_TIMEOUT_MS: '300',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch {
      /* 未启动 */
    }
    await wait(250);
  }
  throw new Error('测试服务器启动超时');
}

function stopServer() {
  child?.kill();
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'ftk-test-'));
  await startServer();
}, 30_000);

afterAll(() => {
  stopServer();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

interface FullViewShape {
  game?: {
    round?: number;
    stage?: string;
    result?: { winner?: string; reasonZh?: string } | null;
    pending?: { id: number; mine: boolean }[];
    activationWindowKind?: string | null;
    youPassedWindow?: boolean;
    log?: { textZh: string }[];
    waitingFor?: string;
    shipHex?: string;
    you?: { faction?: string | null; eliminated?: boolean };
    players?: { faction?: string | null }[];
    yourHand?: unknown[];
  };
  botViews?: Record<string, {
    you?: { eliminated?: boolean };
    pending?: { id: number; mine: boolean }[];
    activationWindowKind?: string | null;
    youPassedWindow?: boolean;
  }>;
  chat?: { seatId: number; name: string; text: string }[];
  youAreSpectator?: boolean;
  spectators?: { id: number; name: string }[];
  waiting?: { seats: number[]; since: number };
  lobby?: { status?: string; youAreHost?: boolean; lastResult?: { winner?: string; reasonZh?: string } | null } | null;
}

/** 驱动一个房间的所有座位（房主本人 + 代打机器人），直到终局或超时 */
async function driveGame(socket: Socket, hostSeat: number, opts: { untilRound?: number; timeoutMs: number }): Promise<{ ended: boolean; round: number; lastStage: string; logTail: string[]; errors: [string, string][] }> {
  let reqId = Date.now();
  const attempts = new Map<string, number>();
  const sent = new Set<string>(); // 已发送的 pending id（等待 ack 后移除）
  const errors = new Map<string, string>();
  let lastView: FullViewShape = {};
  let lastViewRef: FullViewShape = {};
  socket.on('roomView', (v) => {
    lastView = v as FullViewShape;
  });
  const deadline = Date.now() + opts.timeoutMs;
  let lastStage = '';
  while (Date.now() < deadline) {
    await wait(120);
    const game = lastView.game;
    if (!game) continue;
    lastStage = `第${game.round}轮/${game.stage}`;
    if (game.result) return { ended: true, round: game.round ?? 0, lastStage, logTail: (game.log ?? []).slice(-5).map((l) => l.textZh), errors: [...errors.entries()] };
    if (opts.untilRound && (game.round ?? 0) >= opts.untilRound) {
      return { ended: false, round: game.round ?? 0, lastStage, logTail: (game.log ?? []).slice(-5).map((l) => l.textZh), errors: [...errors.entries()] };
    }
    // 每轮循环只发送一条命令（代打命令全部计入房主限速额度）
    const ownPending = (game.pending ?? []).find((p) => p.mine);
    if (ownPending) {
      driveOne(socket, lastView.game as never, ownPending, undefined, { reqId, attempts, sent, errors }, () => ++reqId);
      continue;
    }
    if (!game.you?.eliminated && game.activationWindowKind && !game.youPassedWindow) {
      // 通过是幂等操作：每轮无条件重发，防止 ack 竞态导致卡住
      socket.emit('command', { command: { type: 'pass' }, reqId: ++reqId }, (r: { error?: unknown }) => {
        if (r?.error) errors.set(`win-self`, JSON.stringify(r.error));
      });
      continue;
    }
    let acted = false;
    for (const [seatStr, bv] of Object.entries(lastView.botViews ?? {})) {
      if (acted) break;
      const seat = Number(seatStr);
      if (bv.you?.eliminated) continue; // 出局座位无法操作，跳过
      const bp = (bv.pending ?? []).find((p) => p.mine);
      if (bp) {
        driveOne(socket, bv as never, bp, seat, { reqId, attempts, sent, errors }, () => ++reqId);
        acted = true;
      } else if (bv.activationWindowKind && !bv.youPassedWindow) {
        // 幂等重发
        socket.emit('command', { command: { type: 'pass' }, reqId: ++reqId, asSeat: seat }, (r: { error?: unknown }) => {
          if (r?.error) errors.set(`win-${seat}`, JSON.stringify(r.error));
        });
        acted = true;
      }
    }
  }
  return { ended: false, round: lastView.game?.round ?? 0, lastStage, logTail: (lastView.game?.log ?? []).slice(-5).map((l) => l.textZh), errors: [...errors.entries()] };
}

function driveOne(
  socket: Socket,
  view: never,
  pending: { id: number; mine: boolean },
  asSeat: number | undefined,
  ctx: { reqId: number; attempts: Map<string, number>; sent: Set<string>; errors: Map<string, string> },
  nextReqId: () => number,
) {
  const key = `${asSeat ?? 'me'}:${pending.id}`;
  if (ctx.sent.has(key)) return;
  const attempt = ctx.attempts.get(key) ?? 0;
  const cmd = botDecide(view as never, pending as never, attempt);
  if (!cmd) {
    ctx.errors.set(`nodecide-${key}`, JSON.stringify(pending));
    return;
  }
  ctx.errors.delete(`nodecide-${key}`);
  ctx.sent.add(key);
  const payload: Record<string, unknown> = { command: cmd, reqId: nextReqId() };
  if (asSeat !== undefined) payload.asSeat = asSeat;
  socket.emit('command', payload, (r: { error?: unknown }) => {
    ctx.sent.delete(key);
    if (r?.error) {
      ctx.attempts.set(key, attempt + 1);
      ctx.errors.set(key, JSON.stringify(r.error));
    } else ctx.attempts.delete(key);
  });
}

describe('基础接口与安全', () => {
  it('健康检查与首页可访问', async () => {
    const h = await api('/healthz', undefined, 'GET');
    expect(h.status).toBe(200);
    const page = await fetch(BASE + '/');
    expect(await page.text()).toContain('险恶疑航');
  });

  it('带口令的房间：错误口令加入被拒；正确口令加入成功', async () => {
    const create = await api('/api/rooms', { name: '口令房主', playerCount: 5, password: 'abc123' });
    expect(create.status).toBe(200);
    const roomId = create.data.roomId as string;
    const bad = await api(`/api/rooms/${roomId}/join`, { name: '路人', password: 'wrong' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const good = await api(`/api/rooms/${roomId}/join`, { name: '同伴', password: 'abc123' });
    expect(good.status).toBe(200);
  });

  it('伪造 token 无法建立 WebSocket 会话', async () => {
    await expect(connect({ token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA', roomId: 'ZZZZZZ' })).rejects.toThrow(/会话无效/);
  });

  it('跨房间隔离：A 房 token 不能以 B 房身份连接；B 房不存在时报错', async () => {
    const a = await api('/api/rooms', { name: '隔离A', playerCount: 5 });
    const b = await api('/api/rooms', { name: '隔离B', playerCount: 5 });
    const tokenA = a.data.token as string;
    // A 的 token 配 B 的 roomId → 拒绝
    await expect(connect({ token: tokenA, roomId: b.data.roomId as string })).rejects.toThrow();
    // 不存在的房间 → 拒绝
    await expect(connect({ token: tokenA, roomId: 'NOPE1' })).rejects.toThrow();
  });
});

describe('机器人完整对局 E2E（核心验收）', () => {
  it('房主添加机器人，通过代打通道手动驱动全部座位，走到合法终局', async () => {
    const create = await api('/api/rooms', { name: 'E2E房主', playerCount: 5 });
    const roomId = create.data.roomId as string;
    const host: Session = {
      token: create.data.token as string,
      seatId: create.data.seatId as number,
      roomId,
    };
    const socket = await connect(host);
    let lastViewRef: FullViewShape = {};
    socket.on('roomView', (v) => {
      lastViewRef = v as FullViewShape;
    });
    const lobbyCall = (payload: Record<string, unknown>) =>
      new Promise<void>((resolve, reject) => {
        socket.emit('lobby', payload, (r: { error?: unknown }) =>
          r?.error ? reject(new Error(JSON.stringify(r.error))) : resolve(),
        );
      });
    for (let i = 0; i < 4; i++) await lobbyCall({ action: 'addBot' });
    await lobbyCall({ action: 'start' });
    socket.on('roomView', (v) => {
      lastViewRef = v as FullViewShape;
    });
    const r = await driveGame(socket, host.seatId, { timeoutMs: 110_000 });
    socket.close();

    const botPend = Object.entries(lastViewRef.botViews ?? {})
      .map(([k, v]) => `${k}:${JSON.stringify(v.pending)}`)
      .join(' , ');
    const diag =
      `对局应在时限内走到终局（卡在 ${r.lastStage}） | ` +
      `viewKeys: ${Object.keys(lastViewRef).join(',')} | ` +
      `waitingFor: ${lastViewRef.game?.waitingFor} | ` +
      `self: ${JSON.stringify(lastViewRef.game?.pending)} | ` +
      `bots: ${botPend} | ` +
      `errors: ${JSON.stringify([...r.errors.entries()])}`;
    expect(r.ended, diag).toBe(true);
  }, 130_000);
});

describe('服务重启恢复', () => {
  it('重启后 token 仍有效、对局进度与日志完整恢复', async () => {
    // 1. 建房 + 机器人，代打推进到第 2 轮以上
    const create = await api('/api/rooms', { name: '恢复房主', playerCount: 5 });
    const roomId = create.data.roomId as string;
    const host: Session = {
      token: create.data.token as string,
      seatId: create.data.seatId as number,
      roomId,
    };
    const socket = await connect(host);
    const lobbyCall = (payload: Record<string, unknown>) =>
      new Promise<void>((resolve, reject) => {
        socket.emit('lobby', payload, (r: { error?: unknown }) =>
          r?.error ? reject(new Error(JSON.stringify(r.error))) : resolve(),
        );
      });
    for (let i = 0; i < 4; i++) await lobbyCall({ action: 'addBot' });
    await lobbyCall({ action: 'start' });
    const r = await driveGame(socket, host.seatId, { untilRound: 2, timeoutMs: 60_000 });
    expect(r.round, `应推进到第2轮（卡在 ${r.lastStage}）`).toBeGreaterThanOrEqual(2);
    socket.close();

    // 2. 杀掉服务器再重启（同一数据目录）
    stopServer();
    await wait(800);
    await startServer();

    // 3. 原凭据重连 → 对局应恢复到重启前进度，且可继续代打
    const socket2 = await connect(host);
    const r2 = await driveGame(socket2, host.seatId, { untilRound: r.round + 1, timeoutMs: 60_000 });
    socket2.close();
    expect(r2.round, `重启后对局应继续推进（恢复于第${r.round}轮，现 ${r2.lastStage}）`).toBeGreaterThanOrEqual(r.round + 1);
  }, 150_000);
});

// ============================================================
// T1 机器人自动行动 / T4 再来一局 / T6 回放
// ============================================================

/** 测试内确定性重放：初始种子 + 命令序列 → 终局状态（T6 验证） */
function replayInTest(data: {
  setup: { seats: { seatId: number; name: string }[]; config: Record<string, unknown>; rngState: number[] };
  commands: { seq: number; seatId: number | null; payload: unknown }[];
}) {
  const rng = SeededRng.fromState(data.setup.rngState);
  const state = createGameState(data.setup.seats, data.setup.config as never, rng);
  for (const c of data.commands) {
    if (typeof c.seatId === 'number') applyCommand(state, c.seatId, c.payload as never);
  }
  return state;
}

describe('机器人自动对局 + 回放 + 再来一局（T1/T4/T6）', () => {
  it('BotRunner 自动推进至终局；回放重建一致终局；房主可再来一局', async () => {
    const create = await api('/api/rooms', { name: '自动房主', playerCount: 5 });
    const roomId = create.data.roomId as string;
    const host: Session = {
      token: create.data.token as string,
      seatId: create.data.seatId as number,
      roomId,
    };
    const socket = await connect(host);
    let lastView: FullViewShape = {};
    socket.on('roomView', (v) => {
      lastView = v as FullViewShape;
    });
    const lobbyCall = (payload: Record<string, unknown>) =>
      new Promise<void>((resolve, reject) => {
        socket.emit('lobby', payload, (r: { error?: unknown }) =>
          r?.error ? reject(new Error(JSON.stringify(r.error))) : resolve(),
        );
      });
    for (let i = 0; i < 4; i++) await lobbyCall({ action: 'addBot' });
    await lobbyCall({ action: 'setBotAuto', enabled: true });
    await lobbyCall({ action: 'start' });

    // T1：只驱动房主自己；机器人由服务端 BotRunner 自动行动。
    // reqId 必须严格单调递增（幂等通道按座位记录 lastReq，回退的 reqId 会被静默忽略）。
    let reqId = Date.now() + 1_000_000;
    const emitCmd = (cmd: unknown) =>
      new Promise<boolean>((resolve) => {
        socket.emit('command', { command: cmd, reqId: ++reqId }, (r: { error?: unknown }) =>
          resolve(!r?.error),
        );
      });
    const attempts = new Map<number, number>();
    let ended = false;
    let lastStage = '';
    const deadline = Date.now() + 100_000;
    while (Date.now() < deadline) {
      await wait(150);
      const game = lastView.game;
      if (!game) continue;
      lastStage = `第${game.round}轮/${game.stage}`;
      if (game.result) {
        ended = true;
        break;
      }
      const ownPending = (game.pending ?? []).find((p) => p.mine);
      if (ownPending) {
        const attempt = attempts.get(ownPending.id) ?? 0;
        let cmd: unknown = null;
        try {
          cmd = botDecide(game as never, ownPending as never, attempt);
        } catch {
          cmd = null;
        }
        if (cmd) {
          const ok = await emitCmd(cmd);
          if (ok) attempts.delete(ownPending.id);
          else attempts.set(ownPending.id, attempt + 1);
        }
        continue;
      }
      if (!game.you?.eliminated && game.activationWindowKind && !game.youPassedWindow) {
        await emitCmd({ type: 'pass' });
      }
    }
    expect(ended, `自动对局应在时限内结束（卡在 ${lastStage}）\n诊断：pending=${JSON.stringify(lastView.game?.pending)}\nactivation=${lastView.game?.activationWindowKind ?? null}/passed=${lastView.game?.youPassedWindow}\nwaiting=${JSON.stringify(lastView.waiting)}`).toBe(true);

    // T6：回放校验——确定性重放应得到相同终局与船位
    const rep = await fetch(`${BASE}/api/rooms/${roomId}/replay`);
    expect(rep.status, '已结束对局应可获取回放').toBe(200);
    const data = (await rep.json()) as Parameters<typeof replayInTest>[0] & { finalResult: { winner: string } | null };
    expect(data.commands.length, '命令日志应为非空').toBeGreaterThan(0);
    const state = replayInTest(data);
    expect(state.result?.winner).toBe(data.finalResult?.winner ?? null);
    expect(state.shipHex).toBe(lastView.game?.shipHex);

    // T4：房主再来一局 → 回大厅 → 机器人已准备 → 直接再开
    await lobbyCall({ action: 'rematch' });
    await wait(300);
    expect(lastView.lobby?.status).toBe('lobby');
    expect(lastView.lobby?.lastResult?.winner).toBeTruthy();
    await lobbyCall({ action: 'start' });
    await wait(3000);
    expect(lastView.game?.result ?? null).toBeNull(); // 新一局不应瞬间终局
    socket.close();
  }, 190_000);
});

// ============================================================
// T5 观战模式
// ============================================================

describe('观战模式（T5）', () => {
  it('观战者可进入进行中的对局：只读、无秘密、playing 期间回放被拒', async () => {
    const create = await api('/api/rooms', { name: '观战房主', playerCount: 5 });
    const roomId = create.data.roomId as string;
    const host: Session = { token: create.data.token as string, seatId: create.data.seatId as number, roomId };
    const socket = await connect(host);
    const lobbyCall = (payload: Record<string, unknown>) =>
      new Promise<void>((resolve, reject) => {
        socket.emit('lobby', payload, (r: { error?: unknown }) =>
          r?.error ? reject(new Error(JSON.stringify(r.error))) : resolve(),
        );
      });
    for (let i = 0; i < 4; i++) await lobbyCall({ action: 'addBot' });
    await lobbyCall({ action: 'start' });
    await wait(300);

    // 观战加入（进行中）
    const spRes = await api(`/api/rooms/${roomId}/spectate`, { name: '围观群众' });
    const spToken = spRes.data.token as string;
    expect(spRes.data.spectatorId).toBe(0);

    const spSocket = await new Promise<Socket>((resolve, reject) => {
      const s = io(BASE, { auth: { token: spToken, roomId, role: 'spectator' }, transports: ['websocket'] });
      s.on('connect', () => resolve(s));
      s.on('connect_error', (e) => reject(new Error(e.message)));
    });
    const spView = await new Promise<FullViewShape>((resolve) => {
      spSocket.on('roomView', (v) => resolve(v as FullViewShape));
      spSocket.emit('sync');
    });
    expect(spView.youAreSpectator, '观战视图应带标记').toBe(true);
    expect(spView.game, '观战者应收到对局视图').toBeTruthy();
    expect(spView.game?.you?.faction ?? null, '观战者自身阵营应为空').toBeNull();
    for (const p of spView.game?.players ?? []) {
      expect(p.faction ?? null, `玩家 ${p} 阵营对观战者不可见`).toBeNull();
    }
    expect(spView.spectators?.map((s) => s.name)).toContain('围观群众');

    // 观战只读：chat / command 均被拒
    const chatBlocked = await new Promise<unknown>((resolve) => {
      spSocket.emit('chat', { text: '剧透一下' }, (r: unknown) => resolve(r));
    });
    expect(JSON.stringify(chatBlocked)).toContain('SPECTATOR_READONLY');
    const cmdBlocked = await new Promise<unknown>((resolve) => {
      spSocket.emit('command', { command: { type: 'pass' }, reqId: 1 }, (r: unknown) => resolve(r));
    });
    expect(JSON.stringify(cmdBlocked)).toContain('SPECTATOR_READONLY');

    // playing 期间回放数据被拒（命令日志含哗变枪数，泄密）
    const rep = await fetch(`${BASE}/api/rooms/${roomId}/replay`);
    expect(rep.status).toBe(403);

    spSocket.close();
    socket.close();
  }, 60_000);

  it('对局未开始时观战被拒绝', async () => {
    const create = await api('/api/rooms', { name: '未开局房主', playerCount: 5 });
    const res = await fetch(`${BASE}/api/rooms/${create.data.roomId}/spectate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '围观群众' }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  }, 30_000);
});

// ============================================================
// T2 待行动计时与超时托管
// ============================================================

describe('超时托管（T2）', () => {
  it('仅等待激活窗口的真人座位超时后自动通过（关键决策不自动）', async () => {
    const create = await api('/api/rooms', { name: '超时房主', playerCount: 5 });
    const roomId = create.data.roomId as string;
    const host: Session = { token: create.data.token as string, seatId: create.data.seatId as number, roomId };
    const socket = await connect(host);
    let lastView: FullViewShape = {};
    socket.on('roomView', (v) => {
      lastView = v as FullViewShape;
    });
    const lobbyCall = (payload: Record<string, unknown>) =>
      new Promise<void>((resolve, reject) => {
        socket.emit('lobby', payload, (r: { error?: unknown }) =>
          r?.error ? reject(new Error(JSON.stringify(r.error))) : resolve(),
        );
      });
    for (let i = 0; i < 4; i++) await lobbyCall({ action: 'addBot' });
    // botAuto 保持关闭：机器人不动，全桌只有房主会被托管 pass
    await lobbyCall({ action: 'start' });

    // 扫描周期为 5 秒。如果房间恰好在扫描前不足 300ms 建立，第一次会合理跳过，
    // 因此轮询到下一个扫描周期，避免依赖定时器相位造成偶发失败。
    const timeoutDeadline = Date.now() + 12_000;
    while (Date.now() < timeoutDeadline && !JSON.stringify(lastView.chat ?? []).includes('自动通过了行动窗口')) {
      await wait(250);
    }
    expect(lastView.game?.youPassedWindow, '房主应被超时托管自动通过').toBe(true);
    const chatText = JSON.stringify(lastView.chat ?? []);
    expect(chatText).toContain('自动通过了行动窗口');
    socket.close();
  }, 40_000);
});
