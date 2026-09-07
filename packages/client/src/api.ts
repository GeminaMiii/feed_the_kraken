import { io, Socket } from 'socket.io-client';
import type { PlayerView, Command } from '@ftk/engine';

export interface LobbyView {
  roomId: string;
  status: 'lobby' | 'playing' | 'ended' | 'archived';
  seats: { seatId: number; name: string; connected: boolean; ready: boolean; isHost: boolean; isBot?: boolean }[];
  playerCount: number;
  mapId: string;
  excludeSuggestedCharacters: boolean;
  hasPassword: boolean;
  yourSeat: number;
  youAreHost: boolean;
  botAuto?: boolean;
  lastResult?: { winner: string; reasonZh: string } | null;
}

export interface ChatMsg {
  id: number;
  seatId: number;
  name: string;
  text: string;
  ts: number;
}

export interface RoomFullView {
  lobby: LobbyView | null;
  game: PlayerView | null;
  chat: ChatMsg[];
  log: { id: number; textZh: string; ts: number }[];
  /** 调试代打：房主可见的机器人座位视图（仅机器人座位） */
  botViews?: Record<string, PlayerView>;
  /** 当前等待行动的真人座位与等待起点（对局中） */
  waiting?: { seats: number[]; since: number };
  /** 观战者视角标记与观战名单 */
  youAreSpectator?: boolean;
  spectators?: { id: number; name: string }[];
  error?: string;
}

export interface SessionInfo {
  roomId: string;
  token: string;
  seatId: number;
  name: string;
  /** 观战会话（seatId 恒为 -1） */
  spectator?: boolean;
  spectatorId?: number;
}

/** 对局回放数据（仅已结束对局可获取） */
export interface ReplayData {
  setup: {
    seats: { seatId: number; name: string }[];
    config: Record<string, unknown>;
    rngState: number[];
  };
  commands: { seq: number; seatId: number | null; payload: Record<string, unknown>; ts: number }[];
  finalResult: { winner: string; reasonZh: string } | null;
  seatNames: Record<number, string>;
}

const STORAGE_KEY = 'ftk_sessions';
const SPECTATE_STORAGE_KEY = 'ftk_spectate_sessions';

export function loadSessions(): Record<string, SessionInfo> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveSession(s: SessionInfo) {
  const all = loadSessions();
  all[s.roomId] = s;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function clearSession(roomId: string) {
  const all = loadSessions();
  delete all[roomId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

// ============ 观战会话（T5） ============

export function loadSpectateSessions(): Record<string, SessionInfo> {
  try {
    return JSON.parse(localStorage.getItem(SPECTATE_STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveSpectateSession(s: SessionInfo) {
  const all = loadSpectateSessions();
  all[s.roomId] = s;
  localStorage.setItem(SPECTATE_STORAGE_KEY, JSON.stringify(all));
}

export function clearSpectateSession(roomId: string) {
  const all = loadSpectateSessions();
  delete all[roomId];
  localStorage.setItem(SPECTATE_STORAGE_KEY, JSON.stringify(all));
}

export async function apiCreateRoom(opts: {
  name: string;
  playerCount: number;
  password?: string;
  mapId?: string;
  excludeSuggestedCharacters?: boolean;
}): Promise<SessionInfo> {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '创建失败');
  const s: SessionInfo = { roomId: data.roomId, token: data.token, seatId: data.seatId, name: opts.name };
  saveSession(s);
  return s;
}

export async function apiJoinRoom(roomId: string, name: string, password?: string): Promise<SessionInfo> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '加入失败');
  const s: SessionInfo = { roomId, token: data.token, seatId: data.seatId, name };
  saveSession(s);
  return s;
}

/** 以观战身份加入进行中/已结束的对局 */
export async function apiSpectate(roomId: string, name: string, password?: string): Promise<SessionInfo> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/spectate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '观战加入失败');
  const s: SessionInfo = {
    roomId,
    token: data.token,
    seatId: -1,
    name,
    spectator: true,
    spectatorId: data.spectatorId,
  };
  saveSpectateSession(s);
  return s;
}

/** 获取对局回放数据（仅已结束的对局） */
export async function apiReplay(roomId: string): Promise<ReplayData> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/replay`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '获取回放失败');
  return data as ReplayData;
}

export function connectSocket(session: SessionInfo): Socket {
  const socket = io('/', {
    auth: session.spectator
      ? { token: session.token, roomId: session.roomId, role: 'spectator' }
      : { token: session.token, roomId: session.roomId },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 800,
  });
  // 心跳：保持座位 lastSeen 新鲜度（服务端 markConnected / 离线判定）
  const heartbeat = setInterval(() => {
    if (socket.connected && !session.spectator) socket.emit('heartbeat');
  }, 30_000);
  socket.on('disconnect', () => clearInterval(heartbeat));
  return socket;
}

type AckError = string | { code?: string; message: string } | undefined;

function ackErrorToMessage(e: AckError): string {
  if (typeof e === 'string') return e;
  return e?.message ?? '未知错误';
}

// 单调递增的请求号（服务端用于幂等去重：过小/重复的请求会被忽略）
let reqCounter = Date.now();
export function nextReqId(): number {
  return ++reqCounter;
}

export function sendCommand(socket: Socket, command: Command, asSeat?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.emit(
      'command',
      asSeat !== undefined ? { command, reqId: nextReqId(), asSeat } : { command, reqId: nextReqId() },
      (resp: { error?: AckError }) => {
        if (resp?.error) reject(new Error(ackErrorToMessage(resp.error)));
        else resolve();
      },
    );
  });
}

export function sendLobby(socket: Socket, payload: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.emit('lobby', payload, (resp: { error?: AckError }) => {
      if (resp?.error) reject(new Error(ackErrorToMessage(resp.error)));
      else resolve();
    });
  });
}

export function sendChat(socket: Socket, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.emit('chat', { text }, (resp: { error?: AckError }) => {
      if (resp?.error) reject(new Error(ackErrorToMessage(resp.error)));
      else resolve();
    });
  });
}

// ============ socket 注册表（供各视图共享） ============
const socketRegistry = new Map<string, Socket>();
export function registerSocket(roomId: string, socket: Socket) {
  socketRegistry.set(roomId, socket);
}
export function getSocket(roomId: string): Socket {
  const s = socketRegistry.get(roomId);
  if (!s) throw new Error('连接已断开，请刷新页面');
  return s;
}
