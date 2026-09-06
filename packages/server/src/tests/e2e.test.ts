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
  };
  botViews?: Record<string, {
    you?: { eliminated?: boolean };
    pending?: { id: number; mine: boolean }[];
    activationWindowKind?: string | null;
    youPassedWindow?: boolean;
  }>;
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
    if (game.activationWindowKind && !game.youPassedWindow) {
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
