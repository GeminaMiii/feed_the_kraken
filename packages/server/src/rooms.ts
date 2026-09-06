// ============================================================
// 房间管理：大厅、开局、命令执行、持久化、并发控制
// 权限唯一来源：会话 token → (roomId, seatId)。客户端提交的任何
// seatId/playerId 声明一律忽略。
// ============================================================

import {
  GameState,
  RoomConfig,
  Command,
  MIN_PLAYERS,
  MAX_PLAYERS,
  buildPlayerView,
  createGameState,
  applyCommand as engineApply,
  RuleError,
  PlayerView,
  STAGE_LABELS,
} from '@ftk/engine';
import { SeededRng, randomSeed } from '@ftk/engine';
import { Store, RoomRow } from './store';
import {
  newSessionToken,
  hashToken, tokenHashIsDeterministic,
  verifyTokenHash,
  newRoomCode,
  hashPassword,
  verifyPassword,
  sanitizeName,
  sanitizeChat,
} from './util';

export interface SeatInfo {
  seatId: number;
  name: string;
  tokenHash: string;
  connected: boolean; // 由 socket 心跳维护
  lastSeen: number;
  isHost: boolean;
  ready: boolean;
}

export interface ChatMsg {
  id: number;
  seatId: number; // -1 系统
  name: string;
  text: string;
  ts: number;
}

interface RoomWrap {
  row: RoomRow;
  passwordHash: string | null;
  seats: Map<number, SeatInfo>;
  state: GameState | null;
  chat: ChatMsg[];
  lastReqBySeat: Record<number, number>;
  queue: Promise<unknown>; // 串行化
  dirty: boolean;
  bots: Set<number>; // 机器人座位
}

export interface LobbyView {
  roomId: string;
  status: 'lobby' | 'playing' | 'ended' | 'archived';
  seats: { seatId: number; name: string; connected: boolean; ready: boolean; isHost: boolean; isBot: boolean }[];
  playerCount: number;
  mapId: string;
  excludeSuggestedCharacters: boolean;
  hasPassword: boolean;
  yourSeat: number;
  youAreHost: boolean;
}

export interface RoomFullView {
  lobby: LobbyView | null;
  game: PlayerView | null;
  chat: ChatMsg[];
  log: { id: number; textZh: string; ts: number }[];
  /** 调试代打：房主可见的机器人座位视图（仅限机器人座位，真人座位永不包含） */
  botViews?: Record<number, PlayerView>;
}

export class RoomError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function configFrom(room: RoomWrap): RoomConfig {
  return JSON.parse(room.row.configJson).config;
}

function makeRoomRow(roomId: string, config: RoomConfig): RoomRow {
  const now = Date.now();
  return {
    roomId,
    status: 'lobby',
    configJson: JSON.stringify({ config }),
    gameJson: null,
    chatJson: '[]',
    seq: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export class RoomManager {
  private rooms = new Map<string, RoomWrap>();

  constructor(private store: Store) {
    this.loadFromStore();
  }

  private loadFromStore() {
    for (const row of this.store.listActiveRooms()) {
      const wrap: RoomWrap = {
        row,
        passwordHash: null,
        seats: new Map(),
        state: row.gameJson ? (JSON.parse(row.gameJson) as GameState) : null,
        chat: JSON.parse(row.chatJson) as ChatMsg[],
        lastReqBySeat: {},
        queue: Promise.resolve(),
        dirty: false,
        bots: new Set(),
      };
      for (const seat of this.store.getSeats(row.roomId)) {
        wrap.seats.set(seat.seatId, {
          seatId: seat.seatId,
          name: seat.name,
          tokenHash: seat.tokenHash,
          connected: false,
          lastSeen: seat.lastSeenAt,
          isHost: seat.isHost,
          ready: seat.ready,
        });
      }
      wrap.bots = new Set();
      // 恢复口令哈希与机器人座位（存于 configJson 包装层）
      try {
        const parsed = JSON.parse(row.configJson);
        wrap.passwordHash = parsed.passwordHash ?? null;
        for (const b of parsed.bots ?? []) wrap.bots.add(Number(b));
      } catch {
        /* ignore */
      }
      this.rooms.set(row.roomId, wrap);
    }
  }

  // ============ 创建 / 加入 ============

  createRoom(opts: {
    name: string;
    playerCount: number;
    password?: string;
    mapId?: 'auto' | 'quick' | 'long';
    excludeSuggestedCharacters?: boolean;
  }): { roomId: string; token: string; seatId: number } {
    if (!Number.isInteger(opts.playerCount) || opts.playerCount < MIN_PLAYERS || opts.playerCount > MAX_PLAYERS) {
      throw new RoomError('BAD_COUNT', `人数必须是 ${MIN_PLAYERS}-${MAX_PLAYERS}`);
    }
    const name = sanitizeName(opts.name);
    const config: RoomConfig = {
      playerCount: opts.playerCount,
      mapId: opts.mapId ?? 'auto',
      excludeSuggestedCharacters: !!opts.excludeSuggestedCharacters,
      roomPassword: '', // 口令哈希存包装层，不进引擎状态
    };
    let roomId: string;
    let tries = 0;
    do {
      roomId = newRoomCode();
      tries++;
    } while ((this.rooms.has(roomId) || this.store.getRoom(roomId)) && tries < 20);

    const wrap: RoomWrap = {
      row: makeRoomRow(roomId, config),
      passwordHash: opts.password ? hashPassword(opts.password) : null,
      seats: new Map(),
      state: null,
      chat: [],
      lastReqBySeat: {},
      queue: Promise.resolve(),
      dirty: false,
      bots: new Set(),
    };
    this.rooms.set(roomId, wrap);
    this.store.createRoom(wrap.row); // 房间行必须先落库，之后 persist 才能更新
    const token = newSessionToken();
    this.joinInternal(wrap, name, token, /*host*/ true);
    return { roomId, token, seatId: 0 };
  }

  joinRoom(opts: { roomId: string; name: string; password?: string }): { token: string; seatId: number } {
    const room = this.rooms.get(opts.roomId?.trim()?.toUpperCase() ?? '');
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在或已关闭', 404);
    if (room.row.status !== 'lobby') {
      throw new RoomError('GAME_STARTED', '对局已开始，无法加入（请在开局前加入）');
    }
    const name = sanitizeName(opts.name);
    if (!verifyPassword(opts.password ?? '', room.passwordHash)) {
      throw new RoomError('BAD_PASSWORD', '房间口令错误');
    }
    const config = configFrom(room);
    const taken = new Set([...room.seats.keys()]);
    if (taken.size >= config.playerCount) {
      throw new RoomError('ROOM_FULL', '房间已满');
    }
    let seatId = 0;
    while (taken.has(seatId)) seatId++;
    const token = newSessionToken();
    this.joinInternal(room, name, token, /*host*/ taken.size === 0);
    return { token, seatId };
  }

  private joinInternal(room: RoomWrap, name: string, token: string, host: boolean): number {
    const taken = new Set([...room.seats.keys()]);
    let seatId = 0;
    while (taken.has(seatId)) seatId++;
    const now = Date.now();
    const seat: SeatInfo = {
      seatId,
      name,
      tokenHash: hashToken(token),
      connected: false,
      lastSeen: now,
      isHost: host,
      ready: false,
    };
    room.seats.set(seatId, seat);
    this.store.addSeat({
      roomId: room.row.roomId,
      seatId,
      name,
      tokenHash: seat.tokenHash,
      joinedAt: now,
      lastSeenAt: now,
      isHost: host,
      ready: false,
    });
    this.persist(room);
    return seatId;
  }

  // ============ 会话 ============

  resolveToken(token: string): { roomId: string; seatId: number } | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    // 新格式（HMAC，确定性）：直接按哈希反查
    if (tokenHashIsDeterministic(token)) {
      const hash = hashToken(token);
      for (const [roomId, room] of this.rooms) {
        for (const seat of room.seats.values()) {
          if (seat.tokenHash === hash) return { roomId, seatId: seat.seatId };
        }
      }
      const found = this.store.findSeatByTokenHash(hash);
      if (found) return { roomId: found.roomId, seatId: found.seat.seatId };
      // 未命中新格式 → 继续尝试旧格式（老会话迁移）
    }
    // 旧格式（scrypt+随机盐）：逐个验证，成功后升级为 HMAC
    for (const [roomId, room] of this.rooms) {
      for (const seat of room.seats.values()) {
        if (verifyTokenHash(token, seat.tokenHash)) {
          this.upgradeTokenHash(roomId, seat.seatId, token, seat);
          return { roomId, seatId: seat.seatId };
        }
      }
    }
    const found = this.store.findSeatByToken(token, verifyTokenHash);
    if (found) {
      this.upgradeTokenHash(found.roomId, found.seat.seatId, token, undefined);
      return { roomId: found.roomId, seatId: found.seat.seatId };
    }
    return null;
  }

  private upgradeTokenHash(roomId: string, seatId: number, token: string, seat?: { tokenHash: string }) {
    const newHash = hashToken(token);
    const seatInfo = seat ?? this.rooms.get(roomId)?.seats.get(seatId);
    if (seatInfo && seatInfo.tokenHash !== newHash) {
      seatInfo.tokenHash = newHash;
      this.store.updateSeat(roomId, seatId, { tokenHash: newHash });
    }
  }

  markConnected(roomId: string, seatId: number, connected: boolean) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const seat = room.seats.get(seatId);
    if (!seat) return;
    seat.connected = connected;
    seat.lastSeen = Date.now();
    this.store.updateSeat(roomId, seatId, { lastSeenAt: seat.lastSeen });
  }

  heartbeat(roomId: string, seatId: number) {
    this.markConnected(roomId, seatId, true);
  }

  // ============ 大厅操作 ============

  setReady(roomId: string, seatId: number, ready: boolean): void {
    const room = this.getLobbyRoom(roomId);
    const seat = room.seats.get(seatId);
    if (!seat) throw new RoomError('NO_SEAT', '你不在该房间');
    seat.ready = !!ready;
    this.store.updateSeat(roomId, seatId, { ready: seat.ready });
    this.persist(room);
  }

  leaveRoom(roomId: string, seatId: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const seat = room.seats.get(seatId);
    if (!seat) return;
    if (room.row.status !== 'lobby') {
      throw new RoomError('GAME_STARTED', '对局中不能离开座位（可以断线）');
    }
    const wasHost = seat.isHost;
    room.seats.delete(seatId);
    this.store.removeSeat(roomId, seatId);
    if (wasHost && room.seats.size > 0) {
      const next = [...room.seats.values()].sort((a, b) => a.seatId - b.seatId)[0];
      next.isHost = true;
      this.store.updateSeat(roomId, next.seatId, { isHost: true });
      this.systemChat(room, `${next.name} 成为新房主。`);
    }
    this.systemChat(room, `${seat.name} 离开了房间。`);
    this.persist(room);
  }

  /** 房主添加一个机器人填入下一个空位 */
  addBot(roomId: string, hostSeatId: number): number {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    const host = room.seats.get(hostSeatId);
    if (!host?.isHost) throw new RoomError('NOT_HOST', '只有房主可以添加机器人');
    if (room.row.status !== 'lobby') throw new RoomError('GAME_STARTED', '对局已开始，无法添加机器人');
    const config = configFrom(room);
    if (room.seats.size >= config.playerCount) throw new RoomError('ROOM_FULL', '房间已满');
    const n = room.bots.size + 1;
    const token = newSessionToken();
    const seatId = this.joinInternal(room, `🤖 机器人${n}`, token, false);
    const seat = room.seats.get(seatId)!;
    seat.ready = true;
    seat.connected = true; // 机器人视为始终在线
    room.bots.add(seatId);
    this.store.updateSeat(roomId, seatId, { ready: true });
    this.systemChat(room, `🤖 机器人${n} 加入了房间。`);
    this.persist(room);
    return seatId;
  }

  botSeats(roomId: string): number[] {
    const room = this.rooms.get(roomId);
    return room ? [...room.bots].sort((a, b) => a - b) : [];
  }

  /** 房主在对局开始前切换地图（auto=按人数自动：5-7短航程，8+长航程） */
  setMap(roomId: string, hostSeatId: number, mapId: 'auto' | 'quick' | 'long'): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    if (!room.seats.get(hostSeatId)?.isHost) throw new RoomError('NOT_HOST', '只有房主可以修改地图');
    if (room.row.status !== 'lobby') throw new RoomError('GAME_STARTED', '对局已开始，无法修改地图');
    const wrapper = JSON.parse(room.row.configJson);
    wrapper.config.mapId = mapId;
    room.row.configJson = JSON.stringify(wrapper);
    this.systemChat(room, `地图已切换为：${mapId === 'auto' ? '自动（5-7人短航程 / 8人以上长航程）' : mapId === 'quick' ? '短航程' : '长航程'}。`);
    this.persist(room);
  }

  removePlayer(roomId: string, hostSeatId: number, targetSeatId: number): void {
    const room = this.getLobbyRoom(roomId);
    const host = room.seats.get(hostSeatId);
    if (!host?.isHost) throw new RoomError('NOT_HOST', '只有房主可以移除玩家');
    const target = room.seats.get(targetSeatId);
    if (!target) throw new RoomError('NO_SEAT', '该座位不存在');
    if (targetSeatId === hostSeatId) throw new RoomError('BAD_TARGET', '不能移除自己');
    room.seats.delete(targetSeatId);
    room.bots.delete(targetSeatId);
    this.store.removeSeat(roomId, targetSeatId);
    this.systemChat(room, `${target.name} 被房主移出房间。`);
    this.persist(room);
  }

  transferHost(roomId: string, hostSeatId: number, targetSeatId: number): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    if (room.bots.has(targetSeatId)) throw new RoomError('BAD_TARGET', '不能把房主转移给机器人');
    const host = room.seats.get(hostSeatId);
    if (!host?.isHost) throw new RoomError('NOT_HOST', '只有房主可以转移房主');
    const target = room.seats.get(targetSeatId);
    if (!target) throw new RoomError('NO_SEAT', '该座位不存在');
    host.isHost = false;
    target.isHost = true;
    this.store.updateSeat(roomId, hostSeatId, { isHost: false });
    this.store.updateSeat(roomId, targetSeatId, { isHost: true });
    this.systemChat(room, `房主已转移给 ${target.name}。`);
    this.persist(room);
  }

  // ============ 开局 ============

  startGame(roomId: string, seatId: number): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    const seat = room.seats.get(seatId);
    if (!seat?.isHost) throw new RoomError('NOT_HOST', '只有房主可以开始对局');
    if (room.row.status !== 'lobby') throw new RoomError('GAME_STARTED', '对局已开始');
    const config = configFrom(room);
    if (room.seats.size !== config.playerCount) {
      throw new RoomError('NOT_FULL', `需要 ${config.playerCount} 名玩家才能开始（当前 ${room.seats.size}）`);
    }
    // mapId='auto' 由引擎按人数解析（5-7 短航程 / 8+ 长航程）
    const seats = [...room.seats.values()].sort((a, b) => a.seatId - b.seatId).map((s) => ({ seatId: s.seatId, name: s.name }));
    const rng = new SeededRng(randomSeed());
    let state: GameState;
    try {
      state = createGameState(seats, { ...config, roomPassword: '' }, rng);
    } catch (e) {
      throw new RoomError('MAP_UNAVAILABLE', (e as Error).message);
    }
    room.state = state;
    room.row.status = 'playing';
    room.row.gameJson = JSON.stringify(state);
    this.systemChat(room, '对局开始！各就各位。');
    this.persist(room);
  }

  // ============ 游戏命令 ============

  async applyGameCommand(roomId: string, seatId: number, cmd: Command, reqId: number): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    // 串行化该房间的所有命令
    const exec = this.enqueue(room, () => this.applyGameCommandSync(room, seatId, cmd, reqId));
    return exec as Promise<void>;
  }

  private enqueue(room: RoomWrap, fn: () => unknown): Promise<unknown> {
    const p = room.queue.then(fn, fn);
    room.queue = p.catch(() => {});
    return p;
  }

  private applyGameCommandSync(room: RoomWrap, seatId: number, cmd: Command, reqId: number): void {
    const state = room.state;
    if (!state) throw new RoomError('NO_GAME', '对局尚未开始');
    if (room.row.status === 'ended') throw new RoomError('GAME_OVER', '对局已结束');
    if (typeof reqId !== 'number' || !Number.isFinite(reqId)) {
      throw new RoomError('BAD_REQ', 'reqId 非法');
    }
    // 幂等：过期或重复请求直接忽略
    const last = room.lastReqBySeat[seatId];
    if (last !== undefined && reqId <= last) {
      return;
    }
    try {
      engineApply(state, seatId, cmd);
      room.lastReqBySeat[seatId] = reqId;
      if (state.result) {
        room.row.status = 'ended';
      }
      this.persist(room);
    } catch (e) {
      if (e instanceof RuleError) {
        throw new RoomError(e.code, e.message);
      }
      throw e;
    }
  }

  chat(roomId: string, seatId: number, text: string): ChatMsg {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    const seat = room.seats.get(seatId);
    if (!seat) throw new RoomError('NO_SEAT', '你不在该房间');
    const clean = sanitizeChat(text);
    const msg: ChatMsg = {
      id: (room.chat[room.chat.length - 1]?.id ?? 0) + 1,
      seatId,
      name: seat.name,
      text: clean,
      ts: Date.now(),
    };
    room.chat.push(msg);
    if (room.chat.length > 200) room.chat.splice(0, room.chat.length - 200);
    this.persist(room);
    return msg;
  }

  private systemChat(room: RoomWrap, text: string) {
    room.chat.push({ id: (room.chat[room.chat.length - 1]?.id ?? 0) + 1, seatId: -1, name: '系统', text, ts: Date.now() });
    if (room.chat.length > 200) room.chat.splice(0, room.chat.length - 200);
  }

  // ============ 视图 ============

  lobbyView(roomId: string, seatId: number): LobbyView {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    const config = configFrom(room);
    return {
      roomId: room.row.roomId,
      status: room.row.status,
      seats: [...room.seats.values()]
        .sort((a, b) => a.seatId - b.seatId)
        .map((s) => ({ seatId: s.seatId, name: s.name, connected: s.connected, ready: s.ready, isHost: s.isHost, isBot: room.bots.has(s.seatId) })),
      playerCount: config.playerCount,
      mapId: config.mapId,
      excludeSuggestedCharacters: config.excludeSuggestedCharacters,
      hasPassword: !!room.passwordHash,
      yourSeat: seatId,
      youAreHost: room.seats.get(seatId)?.isHost ?? false,
    };
  }

  fullView(roomId: string, seatId: number): RoomFullView {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    const inGame = room.row.status !== 'lobby' && room.state;
    const game = inGame && room.state ? this.filterViewForSeat(room, room.state, seatId) : null;
    const log = game
      ? (room.state!.log
          .filter((l) => l.visibility === 'public' || l.visibility === seatId)
          .slice(-120)
          .map((l) => ({ id: l.id, textZh: l.textZh, ts: l.ts })) as { id: number; textZh: string; ts: number }[])
      : [];
    const view: RoomFullView = {
      lobby: room.row.status === 'lobby' ? this.lobbyView(roomId, seatId) : null,
      game,
      chat: room.chat,
      log,
    };
    // 调试代打：房主额外获得机器人座位的过滤视图（只含机器人，绝不含真人座位）
    if (room.seats.get(seatId)?.isHost && room.bots.size > 0 && room.state) {
      const botViews: Record<number, PlayerView> = {};
      for (const botSeat of room.bots) {
        botViews[botSeat] = this.filterViewForSeat(room, room.state, botSeat);
      }
      view.botViews = botViews;
    }
    return view;
  }

  /** 校验房主可以代打某个机器人座位，返回代打座位号 */
  resolveBotSeat(roomId: string, hostSeatId: number, botSeatId: number): number {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    if (!room.seats.get(hostSeatId)?.isHost) throw new RoomError('NOT_HOST', '只有房主可以代打机器人');
    if (!room.bots.has(botSeatId)) throw new RoomError('BAD_TARGET', '只能代打机器人座位');
    return botSeatId;
  }

  private filterViewForSeat(room: RoomWrap, state: GameState, seatId: number): PlayerView {
    // 玩家视图投影 + 连接状态叠加
    const view = buildPlayerView(state, seatId);
    for (const vp of view.players) {
      const seat = room.seats.get(vp.seatId);
      vp.connected = seat?.connected ?? false;
    }
    return view;
  }

  roomStatus(roomId: string): string | null {
    return this.rooms.get(roomId)?.row.status ?? null;
  }

  seatName(roomId: string, seatId: number): string | null {
    return this.rooms.get(roomId)?.seats.get(seatId)?.name ?? null;
  }

  // ============ 维护 ============

  /** 清理过期房间（大厅 12 小时无活动；对局 72 小时无活动） */
  cleanup(): number {
    const now = Date.now();
    let n = 0;
    for (const [roomId, room] of this.rooms) {
      const staleMs = room.row.status === 'lobby' ? 12 * 3600_000 : 72 * 3600_000;
      if (now - room.row.updatedAt > staleMs) {
        room.row.status = 'archived';
        this.store.saveRoom(room.row);
        this.store.clearSeats(roomId);
        this.rooms.delete(roomId);
        n++;
      }
    }
    return n;
  }

  private getLobbyRoom(roomId: string): RoomWrap {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    if (room.row.status !== 'lobby') throw new RoomError('GAME_STARTED', '对局已开始');
    return room;
  }

  private persist(room: RoomWrap) {
    room.row.updatedAt = Date.now();
    if (room.state) {
      room.row.gameJson = JSON.stringify(room.state);
      if (room.row.status === 'playing' && room.state.result) room.row.status = 'ended';
    }
    room.row.chatJson = JSON.stringify(room.chat);
    room.row.configJson = JSON.stringify({
      config: configFrom(room),
      passwordHash: room.passwordHash,
      bots: [...room.bots],
    });
    this.store.saveRoom(room.row);
    room.dirty = false;
  }
}
