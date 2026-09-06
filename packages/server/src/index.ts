// ============================================================
// HTTP + WebSocket 服务入口
// 环境变量见 .env.example / README
// ============================================================

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Server as SocketServer, Socket } from 'socket.io';
import { RoomManager, RoomError, RoomFullView } from './rooms';
import { Store } from './store';
import { Command } from '@ftk/engine';
import { RateLimiter, setServerSecret } from './util';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DB_PATH = process.env.FTK_DB ?? path.join(process.cwd(), 'data', 'ftk.db');
const CLIENT_DIST = process.env.FTK_CLIENT_DIST ?? path.join(process.cwd(), '..', 'client', 'dist');
const ALLOWED_ORIGIN = process.env.FTK_ALLOWED_ORIGIN ?? '*'; // 生产建议设为具体来源
const CLEANUP_INTERVAL_MS = Number(process.env.FTK_CLEANUP_INTERVAL_MS ?? 3600_000);

const store = new Store(DB_PATH);
// 服务器密钥：用于会话 token 的确定性 HMAC 哈希（跨重启稳定，可索引反查）
{
  let secret = store.getMeta('server_secret');
  if (!secret) {
    secret = randomBytes(32).toString('base64url');
    store.setMeta('server_secret', secret);
  }
  setServerSecret(secret);
}
const rooms = new RoomManager(store);

// ============ 限速器（可用环境变量覆盖，默认值适合真人玩家） ============
const limiterCreate = new RateLimiter(Number(process.env.FTK_RATE_CREATE ?? 5), 60_000);
const limiterJoin = new RateLimiter(Number(process.env.FTK_RATE_JOIN ?? 10), 60_000);
const limiterCommand = new RateLimiter(Number(process.env.FTK_RATE_COMMAND ?? 30), 10_000);
const limiterChat = new RateLimiter(Number(process.env.FTK_RATE_CHAT ?? 10), 10_000);

function clientKey(req: express.Request | Socket): string {
  const addr = (req as Socket).handshake
    ? (req as Socket).handshake.address
    : (req as express.Request).ip;
  return addr ?? 'unknown';
}

// ============ REST ============
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

const corsHeaders = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (ALLOWED_ORIGIN !== '*') {
    const origin = req.headers.origin;
    if (origin === ALLOWED_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
  }
  next();
};
app.use(corsHeaders);

app.post('/api/rooms', (req, res) => {
  if (!limiterCreate.allow(clientKey(req))) {
    res.status(429).json({ error: '创建房间过于频繁，请稍后再试' });
    return;
  }
  try {
    const result = rooms.createRoom({
      name: req.body?.name,
      playerCount: Number(req.body?.playerCount ?? 6),
      password: typeof req.body?.password === 'string' && req.body.password.length > 0 ? req.body.password : undefined,
      mapId: req.body?.mapId,
      excludeSuggestedCharacters: !!req.body?.excludeSuggestedCharacters,
    });
    res.json(result);
  } catch (e) {
    respondError(res, e);
  }
});

app.post('/api/rooms/:roomId/join', (req, res) => {
  if (!limiterJoin.allow(clientKey(req))) {
    res.status(429).json({ error: '加入尝试过于频繁，请稍后再试' });
    return;
  }
  try {
    const result = rooms.joinRoom({
      roomId: req.params.roomId,
      name: req.body?.name,
      password: typeof req.body?.password === 'string' ? req.body.password : undefined,
    });
    res.json(result);
  } catch (e) {
    respondError(res, e);
  }
});

function respondError(res: express.Response, e: unknown) {
  if (e instanceof RoomError) {
    res.status(e.httpStatus).json({ error: e.message, code: e.code });
  } else {
    res.status(400).json({ error: (e as Error).message ?? '请求非法' });
  }
}

// ============ 静态前端 ============
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, {
    maxAge: '1h',
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// ============ WebSocket ============
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN, credentials: false },
  maxHttpBufferSize: 32 * 1024,
  pingInterval: 20000,
  pingTimeout: 25000,
});

interface AuthPayload {
  token: string;
  roomId: string;
}

interface SocketSession {
  roomId: string;
  seatId: number;
}

const sessions = new Map<Socket, SocketSession>();

io.use((socket, next) => {
  const { token, roomId } = socket.handshake.auth ?? {};
  if (typeof token !== 'string' || typeof roomId !== 'string') {
    next(new Error('需要 token 与 roomId'));
    return;
  }
  const resolved = rooms.resolveToken(token);
  if (!resolved || resolved.roomId !== roomId) {
    next(new Error('会话无效或已过期'));
    return;
  }
  socket.data.seatId = resolved.seatId;
  next();
});

io.on('connection', (socket) => {
  const seatId: number = socket.data.seatId;
  const roomId: string = socket.handshake.auth.roomId;
  sessions.set(socket, { roomId, seatId });
  socket.join(`room:${roomId}`);
  rooms.markConnected(roomId, seatId, true);
  broadcastRoom(roomId);

  socket.on('sync', () => {
    sendFullView(socket);
  });

  socket.on('heartbeat', () => {
    rooms.heartbeat(roomId, seatId);
  });

  socket.on('lobby', (payload, ack) => {
    try {
      const action = payload?.action;
      switch (action) {
        case 'ready':
          rooms.setReady(roomId, seatId, !!payload.ready);
          break;
        case 'leave':
          rooms.leaveRoom(roomId, seatId);
          socket.leave(`room:${roomId}`);
          sessions.delete(socket);
          socket.emit('lobby:left', {});
          ack?.({ ok: true });
          broadcastRoom(roomId);
          return;
        case 'removePlayer':
          rooms.removePlayer(roomId, seatId, Number(payload.seatId));
          break;
        case 'transferHost':
          rooms.transferHost(roomId, seatId, Number(payload.seatId));
          break;
        case 'addBot':
          rooms.addBot(roomId, seatId);
          break;
        case 'setMap':
          rooms.setMap(roomId, seatId, payload.mapId);
          break;
        case 'start':
          rooms.startGame(roomId, seatId);
          break;
        default:
          throw new RoomError('BAD_ACTION', '未知的大厅操作');
      }
      ack?.({ ok: true });
      broadcastRoom(roomId);
    } catch (e) {
      ack?.({ error: describeError(e) });
    }
  });

  socket.on('command', (payload, ack) => {
    if (!limiterCommand.allow(`${roomId}:${seatId}`)) {
      ack?.({ error: '操作过于频繁，请稍候' });
      return;
    }
    const cmd = payload?.command;
    const reqId = payload?.reqId;
    if (!isValidCommand(cmd)) {
      ack?.({ error: '操作格式非法' });
      return;
    }
    // 调试代打：房主可指定机器人座位执行命令
    let actingSeat = seatId;
    if (payload?.asSeat !== undefined && Number(payload.asSeat) !== seatId) {
      try {
        actingSeat = rooms.resolveBotSeat(roomId, seatId, Number(payload.asSeat));
      } catch (e) {
        ack?.({ error: describeError(e) });
        return;
      }
    }
    rooms
      .applyGameCommand(roomId, actingSeat, cmd as Command, Number(reqId))
      .then(() => {
        ack?.({ ok: true });
        broadcastRoom(roomId);
      })
      .catch((e) => {
        ack?.({ error: describeError(e) });
      });
  });

  socket.on('chat', (payload, ack) => {
    if (!limiterChat.allow(`${roomId}:${seatId}`)) {
      ack?.({ error: '发言过于频繁' });
      return;
    }
    try {
      rooms.chat(roomId, seatId, String(payload?.text ?? ''));
      ack?.({ ok: true });
      broadcastRoom(roomId);
    } catch (e) {
      ack?.({ error: describeError(e) });
    }
  });

  socket.on('disconnect', () => {
    sessions.delete(socket);
    rooms.markConnected(roomId, seatId, false);
    broadcastRoom(roomId);
  });
});

function describeError(e: unknown): { code?: string; message: string } {
  if (e instanceof RoomError) return { code: e.code, message: e.message };
  return { message: (e as Error).message ?? '内部错误' };
}

function isValidCommand(cmd: unknown): boolean {
  if (!cmd || typeof cmd !== 'object') return false;
  const c = cmd as Record<string, unknown>;
  switch (c.type) {
    case 'pass':
    case 'activateCharacter':
      return typeof c.characterId === 'string' || c.type === 'pass';
    case 'appoint':
      return Number.isInteger(c.lieutenant) && Number.isInteger(c.navigator);
    case 'choosePlayer':
    case 'tiePick':
    case 'appointLieutenant':
      return Number.isInteger(c.seat);
    case 'submitGuns':
      return Number.isInteger(c.count) && (c.count as number) >= 0 && (c.count as number) <= 20;
    case 'chooseCard':
      return typeof c.cardId === 'string' && (c.cardId as string).length <= 64;
    case 'navigatorAction':
      return (c.action === 'discard' && typeof c.cardId === 'string') || c.action === 'jumpShip';
    case 'floggingDeclare':
      return c.declares === 'sailor' || c.declares === 'pirate' || c.declares === 'cult';
    case 'allocateGuns':
      return typeof c.alloc === 'object' && c.alloc !== null;
    case 'telescopeDecision':
      return typeof c.discard === 'boolean';
    case 'instigatorAnswer':
      return typeof c.join === 'boolean';
    default:
      return false;
  }
}

function sendFullView(socket: Socket) {
  const sess = sessions.get(socket);
  if (!sess) return;
  try {
    const view: RoomFullView = rooms.fullView(sess.roomId, sess.seatId);
    socket.emit('roomView', view);
  } catch {
    socket.emit('roomView', { error: '房间已关闭' });
  }
}

function broadcastRoom(roomId: string) {
  for (const [socket, sess] of sessions) {
    if (sess.roomId === roomId) sendFullView(socket);
  }
}

// ============ 定时维护 ============
setInterval(() => {
  rooms.cleanup();
}, CLEANUP_INTERVAL_MS);

server.listen(PORT, HOST, () => {
  console.log(`[FTK] 服务已启动: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`[FTK] 数据库: ${DB_PATH}`);
  console.log(`[FTK] 允许的跨域来源: ${ALLOWED_ORIGIN}`);
});

process.on('SIGTERM', () => {
  server.close();
  store.close();
  process.exit(0);
});
process.on('SIGINT', () => {
  server.close();
  store.close();
  process.exit(0);
});

export { app, server, io, rooms, store };
