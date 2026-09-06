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
  error?: string;
}

export interface SessionInfo {
  roomId: string;
  token: string;
  seatId: number;
  name: string;
}

const STORAGE_KEY = 'ftk_sessions';

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

export function connectSocket(session: SessionInfo): Socket {
  const socket = io('/', {
    auth: { token: session.token, roomId: session.roomId },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 800,
  });
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
