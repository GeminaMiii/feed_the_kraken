// SQLite 持久化（node:sqlite，无原生依赖）。单实例部署。
// 房间 = 一行快照（状态 JSON + 会话凭据哈希）。每次状态变更即落盘。

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface RoomRow {
  roomId: string;
  status: 'lobby' | 'playing' | 'ended' | 'archived';
  configJson: string;
  gameJson: string | null; // GameState 快照（无 token 等凭据）
  chatJson: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
}

export interface SeatRow {
  roomId: string;
  seatId: number;
  name: string;
  tokenHash: string; // scrypt 哈希，明文 token 不落盘
  joinedAt: number;
  lastSeenAt: number;
  isHost: boolean;
  ready: boolean;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        config_json TEXT NOT NULL,
        game_json TEXT,
        chat_json TEXT NOT NULL DEFAULT '[]',
        seq INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS seats (
        room_id TEXT NOT NULL,
        seat_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        is_host INTEGER NOT NULL DEFAULT 0,
        ready INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (room_id, seat_id)
      );
      CREATE INDEX IF NOT EXISTS idx_seats_token ON seats(token_hash);
    `);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string) {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  createRoom(row: RoomRow) {
    this.db
      .prepare(
        'INSERT INTO rooms (room_id, status, config_json, game_json, chat_json, seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(row.roomId, row.status, row.configJson, row.gameJson, row.chatJson, row.seq, row.createdAt, row.updatedAt);
  }

  getRoom(roomId: string): RoomRow | null {
    const row = this.db.prepare('SELECT * FROM rooms WHERE room_id = ?').get(roomId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return {
      roomId: row.room_id as string,
      status: row.status as RoomRow['status'],
      configJson: row.config_json as string,
      gameJson: (row.game_json as string) ?? null,
      chatJson: row.chat_json as string,
      seq: Number(row.seq),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  saveRoom(row: RoomRow) {
    this.db
      .prepare(
        'UPDATE rooms SET status = ?, config_json = ?, game_json = ?, chat_json = ?, seq = ?, updated_at = ? WHERE room_id = ?',
      )
      .run(row.status, row.configJson, row.gameJson, row.chatJson, row.seq, row.updatedAt, row.roomId);
  }

  listActiveRooms(): RoomRow[] {
    const rows = this.db
      .prepare("SELECT * FROM rooms WHERE status IN ('lobby','playing') ")
      .all() as Record<string, unknown>[];
    return rows.map((row) => ({
      roomId: row.room_id as string,
      status: row.status as RoomRow['status'],
      configJson: row.config_json as string,
      gameJson: (row.game_json as string) ?? null,
      chatJson: row.chat_json as string,
      seq: Number(row.seq),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    }));
  }

  archiveStaleRooms(beforeTs: number): number {
    const res = this.db
      .prepare("UPDATE rooms SET status = 'archived' WHERE status = 'lobby' AND updated_at < ?")
      .run(beforeTs);
    return Number(res.changes);
  }

  addSeat(seat: SeatRow) {
    this.db
      .prepare(
        'INSERT INTO seats (room_id, seat_id, name, token_hash, joined_at, last_seen_at, is_host, ready) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(seat.roomId, seat.seatId, seat.name, seat.tokenHash, seat.joinedAt, seat.lastSeenAt, seat.isHost ? 1 : 0, seat.ready ? 1 : 0);
  }

  getSeat(roomId: string, seatId: number): SeatRow | null {
    const row = this.db
      .prepare('SELECT * FROM seats WHERE room_id = ? AND seat_id = ?')
      .get(roomId, seatId) as Record<string, unknown> | undefined;
    return row ? this.mapSeat(row) : null;
  }

  getSeats(roomId: string): SeatRow[] {
    const rows = this.db
      .prepare('SELECT * FROM seats WHERE room_id = ? ORDER BY seat_id')
      .all(roomId) as Record<string, unknown>[];
    return rows.map((r) => this.mapSeat(r));
  }

  findSeatByTokenHash(hash: string): { roomId: string; seat: SeatRow } | null {
    const row = this.db
      .prepare('SELECT * FROM seats WHERE token_hash = ?')
      .get(hash) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { roomId: row.room_id as string, seat: this.mapSeat(row) };
  }

  /** 遍历活跃座位逐个验证 token（盐随哈希存储，无法直接反查） */
  findSeatByToken(token: string, verify: (token: string, stored: string) => boolean): { roomId: string; seat: SeatRow } | null {
    const rows = this.db
      .prepare("SELECT * FROM seats WHERE room_id IN (SELECT room_id FROM rooms WHERE status IN ('lobby','playing'))")
      .all() as Record<string, unknown>[];
    for (const row of rows) {
      const stored = row.token_hash as string;
      if (verify(token, stored)) {
        return { roomId: row.room_id as string, seat: this.mapSeat(row) };
      }
    }
    return null;
  }

  updateSeat(
    roomId: string,
    seatId: number,
    fields: { name?: string; tokenHash?: string; lastSeenAt?: number; isHost?: boolean; ready?: boolean },
  ) {
    const cur = this.getSeat(roomId, seatId);
    if (!cur) return;
    this.db
      .prepare('UPDATE seats SET name = ?, token_hash = ?, last_seen_at = ?, is_host = ?, ready = ? WHERE room_id = ? AND seat_id = ?')
      .run(
        fields.name ?? cur.name,
        fields.tokenHash ?? cur.tokenHash,
        fields.lastSeenAt ?? cur.lastSeenAt,
        (fields.isHost ?? cur.isHost) ? 1 : 0,
        (fields.ready ?? cur.ready) ? 1 : 0,
        roomId,
        seatId,
      );
  }

  removeSeat(roomId: string, seatId: number) {
    this.db.prepare('DELETE FROM seats WHERE room_id = ? AND seat_id = ?').run(roomId, seatId);
  }

  clearSeats(roomId: string) {
    this.db.prepare('DELETE FROM seats WHERE room_id = ?').run(roomId);
  }

  private mapSeat(row: Record<string, unknown>): SeatRow {
    return {
      roomId: row.room_id as string,
      seatId: row.seat_id as number,
      name: row.name as string,
      tokenHash: row.token_hash as string,
      joinedAt: row.joined_at as number,
      lastSeenAt: row.last_seen_at as number,
      isHost: row.is_host === 1,
      ready: row.ready === 1,
    };
  }

  close() {
    this.db.close();
  }
}
