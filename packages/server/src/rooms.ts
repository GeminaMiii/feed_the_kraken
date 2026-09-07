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
  buildSpectatorView,
  createGameState,
  applyCommand as engineApply,
  RuleError,
  PlayerView,
  STAGE_LABELS,
  alivePlayers,
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

export interface SpectatorInfo {
  spectatorId: number;
  name: string;
  tokenHash: string;
  connected: boolean;
}

/** 当前需要行动的真人座位与等待起点（T2 待行动计时） */
export interface WaitingInfo {
  seats: number[];
  since: number;
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
  botAuto: boolean; // 机器人自动行动开关（T1）
  pendingSig: string | null; // 当前待决策集合签名（T2）
  pendingSince: number; // 签名出现时刻（T2）
  cmdSeq: number; // 命令日志序号（T6 回放）
  spectators: Map<number, SpectatorInfo>; // 观战者（T5）
  lastResult: { winner: string; reasonZh: string } | null; // 上局结果（T4 rematch）
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
  botAuto: boolean;
  lastResult: { winner: string; reasonZh: string } | null;
}

export interface RoomFullView {
  lobby: LobbyView | null;
  game: PlayerView | null;
  chat: ChatMsg[];
  log: { id: number; textZh: string; ts: number }[];
  /** 调试代打：房主可见的机器人座位视图（仅限机器人座位，真人座位永不包含） */
  botViews?: Record<number, PlayerView>;
  /** 当前等待行动的真人座位（对局中） */
  waiting?: WaitingInfo;
  /** 观战者视角标记与观战名单 */
  youAreSpectator?: boolean;
  spectators?: { id: number; name: string }[];
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

// 机器人自动行动默认值（环境变量控制；房间级可由房主覆盖）
const BOT_AUTO_DEFAULT = process.env.FTK_BOT_AUTO !== '0';

// 每房间观战者上限
const MAX_SPECTATORS = Number(process.env.FTK_MAX_SPECTATORS ?? 10);

/** 待决策集合签名：pending 集与激活窗口参与者共同决定；签名变化即重置等待计时 */
function pendingSignature(state: GameState): string {
  const pend = state.pending.map((p) => `${p.id}@${p.actorSeat}`).join(',');
  const win = state.activation
    ? `${state.activation.windowKind}:${state.activation.passedSeats.join(',')}`
    : '';
  return `${pend}|${win}`;
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
        botAuto: BOT_AUTO_DEFAULT,
        pendingSig: null,
        pendingSince: Date.now(),
        cmdSeq: 0,
        spectators: new Map(),
        lastResult: null,
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
      // 恢复包装层：口令哈希 / 机器人座位 / 自动行动开关 / 上局结果
      try {
        const parsed = JSON.parse(row.configJson);
        wrap.passwordHash = parsed.passwordHash ?? null;
        for (const b of parsed.bots ?? []) wrap.bots.add(Number(b));
        wrap.botAuto = typeof parsed.botAuto === 'boolean' ? parsed.botAuto : BOT_AUTO_DEFAULT;
        wrap.lastResult = parsed.lastResult ?? null;
      } catch {
        /* ignore */
      }
      // 恢复观战者（连接状态一律重置为离线，重连后自动置位）
      for (const sp of this.store.getSpectators(row.roomId)) {
        wrap.spectators.set(sp.spectatorId, { ...sp, connected: false });
      }
      // 恢复命令日志序号（跨重启单调）
      wrap.cmdSeq = this.store.maxCommandSeq(row.roomId);
      // 恢复等待计时基线
      if (wrap.state) {
        wrap.pendingSig = pendingSignature(wrap.state);
        wrap.pendingSince = Date.now();
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
      botAuto: BOT_AUTO_DEFAULT,
      pendingSig: null,
      pendingSince: Date.now(),
      cmdSeq: 0,
      spectators: new Map(),
      lastResult: null,
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

  // ============ 观战者（T5） ============

  /** 以观战身份加入进行中/已结束的房间；有口令的房间观战同样需要口令 */
  spectate(opts: { roomId: string; name: string; password?: string }): { roomId: string; token: string; spectatorId: number } {
    const room = this.rooms.get(opts.roomId?.trim()?.toUpperCase() ?? '');
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在或已关闭', 404);
    if (room.row.status !== 'playing' && room.row.status !== 'ended') {
      throw new RoomError('NOT_PLAYING', '对局尚未开始，请以玩家身份加入');
    }
    if (!verifyPassword(opts.password ?? '', room.passwordHash)) {
      throw new RoomError('BAD_PASSWORD', '房间口令错误');
    }
    if (room.spectators.size >= MAX_SPECTATORS) {
      throw new RoomError('SPECTATOR_FULL', '观战席位已满');
    }
    const name = sanitizeName(opts.name);
    let spectatorId = 0;
    while (room.spectators.has(spectatorId)) spectatorId++;
    const token = newSessionToken();
    const tokenHash = hashToken(token);
    room.spectators.set(spectatorId, { spectatorId, name, tokenHash, connected: false });
    this.store.addSpectator({
      roomId: room.row.roomId,
      spectatorId,
      name,
      tokenHash,
      joinedAt: Date.now(),
    });
    this.systemChat(room, `👀 ${name} 进入观战。`);
    this.persist(room);
    return { roomId: room.row.roomId, token, spectatorId };
  }

  /** 观战 token 反查（HMAC 确定性哈希，可索引） */
  resolveSpectatorToken(token: string): { roomId: string; spectatorId: number } | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    if (!tokenHashIsDeterministic(token)) return null;
    const found = this.store.findSpectatorByTokenHash(hashToken(token));
    if (!found) return null;
    // 房间必须仍在内存中（lobby/playing/ended）
    const room = this.rooms.get(found.roomId);
    if (!room || !room.spectators.has(found.spectatorId)) return null;
    return found;
  }

  markSpectatorConnected(roomId: string, spectatorId: number, connected: boolean) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const sp = room.spectators.get(spectatorId);
    if (sp) sp.connected = connected;
  }

  spectatorCount(roomId: string): number {
    return this.rooms.get(roomId)?.spectators.size ?? 0;
  }

  private clearSpectators(room: RoomWrap) {
    room.spectators.clear();
    this.store.clearSpectators(room.row.roomId);
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
    if (room.row.status === 'playing') {
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

  // ============ 机器人自动行动（T1） ============

  /** 房主开关机器人自动行动（大厅与对局中均可切换） */
  setBotAuto(roomId: string, hostSeatId: number, enabled: boolean): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    if (!room.seats.get(hostSeatId)?.isHost) throw new RoomError('NOT_HOST', '只有房主可以切换自动代打');
    room.botAuto = !!enabled;
    this.systemChat(room, enabled ? '🤖 机器人自动代打已开启。' : '🤖 机器人自动代打已关闭（需手动代打）。');
    this.persist(room);
  }

  botAutoEnabled(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    return room ? room.botAuto && room.bots.size > 0 && room.row.status === 'playing' : false;
  }

  /** 机器人座位的过滤视图（仅机器人座位；真人座位一律返回 null，防越权窥探） */
  gameViewForSeat(roomId: string, seatId: number): PlayerView | null {
    const room = this.rooms.get(roomId);
    if (!room || !room.state || room.row.status !== 'playing') return null;
    if (!room.bots.has(seatId)) return null;
    return this.filterViewForSeat(room, room.state, seatId);
  }

  playingRoomIds(): string[] {
    const out: string[] = [];
    for (const [roomId, room] of this.rooms) {
      if (room.row.status === 'playing' && room.state) out.push(roomId);
    }
    return out;
  }

  /** 开启自动行动且存在机器人的进行中房间（供启动时补 kick） */
  playingRoomIdsWithBots(): string[] {
    return this.playingRoomIds().filter((id) => this.botAutoEnabled(id));
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
    // 回放根基：记录 createGameState 之前的初始 RNG 状态（开局发牌等已消费随机数，事后无法还原）
    const initialRngState = rng.exportState();
    let state: GameState;
    const gameConfig = { ...config, roomPassword: '' };
    try {
      state = createGameState(seats, gameConfig, rng);
    } catch (e) {
      throw new RoomError('MAP_UNAVAILABLE', (e as Error).message);
    }
    room.state = state;
    room.row.status = 'playing';
    room.row.gameJson = JSON.stringify(state);
    room.lastResult = null;
    // 注意：cmdSeq 跨局单调递增（rematch 后再次开局沿用递增序号，主键 (room_id, seq) 不冲突）；
    // replayData 从最后一条 setup 起取命令，天然只回放最新一局。
    room.pendingSig = pendingSignature(state);
    room.pendingSince = Date.now();
    this.store.appendCommand({
      roomId,
      seq: ++room.cmdSeq,
      kind: 'setup',
      seatId: null,
      payload: { seats, config: gameConfig, rngState: initialRngState },
      ts: Date.now(),
    });
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
      // 命令日志：幂等跳过的请求不会到这里（提前 return），此处均为真实生效的命令
      room.cmdSeq += 1;
      this.store.appendCommand({
        roomId: room.row.roomId,
        seq: room.cmdSeq,
        kind: 'command',
        seatId,
        payload: cmd,
        ts: Date.now(),
      });
      if (state.result) {
        room.row.status = 'ended';
      }
      // 等待计时：待决策集合变化时重置基线
      const sig = pendingSignature(state);
      if (sig !== room.pendingSig) {
        room.pendingSig = sig;
        room.pendingSince = Date.now();
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

  /** 公开系统消息入口（超时提示、托管通知等） */
  systemMessage(roomId: string, text: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.systemChat(room, text);
    this.persist(room);
  }

  // ============ 待行动计时与超时托管（T2） ============

  /** 当前需要行动的真人座位（机器人排除）与等待起点；无等待返回 null */
  waitingInfo(roomId: string): WaitingInfo | null {
    const room = this.rooms.get(roomId);
    if (!room || !room.state || room.row.status !== 'playing' || room.state.result) return null;
    const state = room.state;
    const seats = new Set<number>();
    for (const p of state.pending) {
      if (p.actorSeat >= 0 && !room.bots.has(p.actorSeat)) seats.add(p.actorSeat);
    }
    if (state.activation) {
      for (const p of alivePlayers(state)) {
        if (!state.activation.passedSeats.includes(p.seatId) && !room.bots.has(p.seatId)) seats.add(p.seatId);
      }
    }
    if (seats.size === 0) return null;
    return { seats: [...seats].sort((a, b) => a - b), since: room.pendingSince };
  }

  /** 某座位是否只等激活窗口（无 pending 决策）——超时仅对此类座位自动 pass */
  seatOnlyAwaitingWindow(roomId: string, seatId: number): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !room.state) return false;
    const state = room.state;
    if (state.pending.some((p) => p.actorSeat === seatId)) return false;
    if (!state.activation) return false;
    const me = state.players.find((p) => p.seatId === seatId);
    if (!me || me.eliminated) return false;
    return !state.activation.passedSeats.includes(seatId);
  }

  /**
   * 扫描超时：对「仅等待激活窗口」且超过 timeoutMs 的真人座位自动通过。
   * 关键决策（哗变交枪、任命等 pending）永不自动代打。返回自动 pass 的座位数。
   * onChanged 在每次自动通过生效后回调（用于服务端广播视图刷新）。
   */
  sweepPendingTimeouts(opts: {
    timeoutMs: number;
    nextReqId: (roomId: string) => number;
    onChanged?: (roomId: string) => void;
    now?: number;
  }): number {
    const now = opts.now ?? Date.now();
    let n = 0;
    for (const roomId of this.playingRoomIds()) {
      const info = this.waitingInfo(roomId);
      if (!info || now - info.since < opts.timeoutMs) continue;
      const room = this.rooms.get(roomId)!;
      for (const seat of info.seats) {
        if (!this.seatOnlyAwaitingWindow(roomId, seat)) continue;
        // 走同一 applyGameCommand 通道（房间队列串行 + 幂等）
        void this.applyGameCommand(roomId, seat, { type: 'pass' }, opts.nextReqId(roomId))
          .then(() => {
            const name = room.seats.get(seat)?.name ?? `P${seat + 1}`;
            this.systemMessage(roomId, `${name} 超时，自动通过了行动窗口。`);
            opts.onChanged?.(roomId);
          })
          .catch(() => {
            /* 已被真人解决或规则拒绝则忽略 */
          });
        n++;
      }
    }
    return n;
  }

  // ============ 再来一局（T4） ============

  /** 对局结束后回到大厅：保留房间码/座位/房主/口令；上局结果摘要随视图透出 */
  rematch(roomId: string, seatId: number): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    if (room.row.status !== 'ended') throw new RoomError('NOT_ENDED', '对局尚未结束');
    if (!room.seats.get(seatId)?.isHost) throw new RoomError('NOT_HOST', '只有房主可以发起来一局');
    const result = room.state?.result ?? null;
    room.lastResult = result ? { winner: result.winner, reasonZh: result.reasonZh } : null;
    room.state = null;
    room.row.gameJson = null;
    room.row.status = 'lobby';
    room.lastReqBySeat = {};
    room.pendingSig = null;
    room.pendingSince = Date.now();
    for (const s of room.seats.values()) {
      s.ready = room.bots.has(s.seatId); // 机器人自动准备
      this.store.updateSeat(roomId, s.seatId, { ready: s.ready });
    }
    this.clearSpectators(room); // 新一局开始前清空观战席（观战连接将退回首页）
    this.systemChat(room, '新的一局已就绪，请大家准备！');
    this.persist(room);
  }

  // ============ 回放数据（T6） ============

  /** 对局回放数据：最后一次 setup + 其后全部命令 + 终局结果。仅 ended 房间可取。 */
  replayData(roomId: string): {
    setup: { seats: { seatId: number; name: string }[]; config: RoomConfig; rngState: number[] };
    commands: { seq: number; seatId: number | null; payload: unknown; ts: number }[];
    finalResult: { winner: string; reasonZh: string } | null;
    seatNames: Record<number, string>;
  } | null {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    if (room.row.status !== 'ended') throw new RoomError('NOT_ENDED', '对局尚未结束', 403);
    const all = this.store.listCommands(roomId);
    let setupIdx = -1;
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].kind === 'setup') {
        setupIdx = i;
        break;
      }
    }
    if (setupIdx < 0) return null;
    const setupRec = all[setupIdx];
    const setup = setupRec.payload as { seats: { seatId: number; name: string }[]; config: RoomConfig; rngState: number[] };
    const seatNames: Record<number, string> = {};
    for (const s of setup.seats) seatNames[s.seatId] = s.name;
    const result = room.state?.result ?? null;
    return {
      setup,
      commands: all.slice(setupIdx + 1).map((c) => ({ seq: c.seq, seatId: c.seatId, payload: c.payload, ts: c.ts })),
      finalResult: result ? { winner: result.winner, reasonZh: result.reasonZh } : null,
      seatNames,
    };
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
      botAuto: room.botAuto,
      lastResult: room.lastResult,
    };
  }

  /** 观战者视图（spectator 投影 + 连接状态叠加；任何秘密都不进入） */
  private filterSpectatorView(room: RoomWrap, state: GameState): PlayerView {
    const view = buildSpectatorView(state);
    for (const vp of view.players) {
      vp.connected = room.seats.get(vp.seatId)?.connected ?? false;
    }
    return view;
  }

  fullView(roomId: string, seatId: number, opts?: { spectator?: boolean }): RoomFullView {
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '房间不存在', 404);
    // 观战者：spectator 投影、仅公开日志、无大厅视图
    if (opts?.spectator) {
      const game = room.state ? this.filterSpectatorView(room, room.state) : null;
      const log = room.state
        ? (room.state.log
            .filter((l) => l.visibility === 'public')
            .slice(-120)
            .map((l) => ({ id: l.id, textZh: l.textZh, ts: l.ts })) as { id: number; textZh: string; ts: number }[])
        : [];
      return {
        lobby: null,
        game,
        chat: room.chat,
        log,
        youAreSpectator: true,
        spectators: [...room.spectators.values()]
          .sort((a, b) => a.spectatorId - b.spectatorId)
          .map((s) => ({ id: s.spectatorId, name: s.name })),
      };
    }
    const inGame = room.row.status !== 'lobby' && room.state;
    const game = inGame && room.state ? this.filterViewForSeat(room, room.state, seatId) : null;
    const log = game
      ? (room.state!.log
          .filter((l) => l.visibility === 'public' || l.visibility === seatId)
          .slice(-120)
          .map((l) => ({ id: l.id, textZh: l.textZh, ts: l.ts })) as { id: number; textZh: string; ts: number }[])
      : [];
    const view: RoomFullView = {
      // ended 状态也透出大厅视图（含上局结果与房主身份），供"再来一局"UI 使用
      lobby: room.row.status === 'lobby' || room.row.status === 'ended' ? this.lobbyView(roomId, seatId) : null,
      game,
      chat: room.chat,
      log,
    };
    if (room.spectators.size > 0) {
      view.spectators = [...room.spectators.values()]
        .sort((a, b) => a.spectatorId - b.spectatorId)
        .map((s) => ({ id: s.spectatorId, name: s.name }));
    }
    // 待行动计时（仅对局中）
    if (room.row.status === 'playing') {
      const waiting = this.waitingInfo(roomId);
      if (waiting) view.waiting = waiting;
    }
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
        this.store.clearSpectators(roomId);
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
      botAuto: room.botAuto,
      lastResult: room.lastResult,
    });
    this.store.saveRoom(room.row);
    room.dirty = false;
  }
}
