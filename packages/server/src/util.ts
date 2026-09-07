// 安全相关工具：token、口令哈希、房间码、限速

import { randomBytes, scryptSync, createHmac, timingSafeEqual, randomInt } from 'node:crypto';

export function newSessionToken(): string {
  return randomBytes(24).toString('base64url');
}

// 服务器密钥（持久化在数据库 meta 表，跨重启稳定）。
// token 哈希 = HMAC(secret, token)：确定性 → 可直接按哈希索引反查，连接验证 O(1)。
let serverSecret: string | null = null;

export function setServerSecret(secret: string) {
  serverSecret = secret;
}

export function hashToken(token: string): string {
  if (!serverSecret) {
    // 兜底（不应发生）：退回随机盐方案
    const salt = randomBytes(12);
    const hash = scryptSync(token, salt, 32, { N: 16384, r: 8, p: 1 });
    return `s1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
  }
  const h = createHmac('sha256', serverSecret).update(token).digest('base64url');
  return `h2$${h}`;
}

export function verifyTokenHash(token: string, stored: string): boolean {
  // 新格式：HMAC（确定性）
  if (stored.startsWith('h2$') && serverSecret) {
    return hashToken(token) === stored;
  }
  // 旧格式：scrypt+随机盐（逐个验证，验证成功后由调用方升级）
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 's1') return false;
  try {
    const salt = Buffer.from(parts[1], 'base64url');
    const expect = Buffer.from(parts[2], 'base64url');
    const actual = scryptSync(token, salt, 32, { N: 16384, r: 8, p: 1 });
    return actual.length === expect.length && timingSafeEqual(actual, expect);
  } catch {
    return false;
  }
}

// 房间码：6位，去除易混淆字符
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
  return code;
}

export function newInviteSecret(): string {
  return randomBytes(16).toString('base64url');
}

// 口令哈希（房间访问保护）
export function hashPassword(pw: string): string {
  const salt = randomBytes(12);
  const hash = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `s1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored) return true; // 未设口令
  return verifyTokenHash(pw, stored);
}

// ============ 简单令牌桶限速 ============

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private max: number,
    private perMs: number,
    private maxKeys = 10000,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) {
        // 防内存膨胀：淘汰最早插入的一半 key（Map 保持插入序），避免全清误伤活跃用户
        const victims = Math.floor(this.buckets.size / 2);
        let n = 0;
        for (const k of this.buckets.keys()) {
          this.buckets.delete(k);
          if (++n >= victims) break;
        }
      }
      b = { tokens: this.max, lastRefill: now };
      this.buckets.set(key, b);
    }
    const elapsed = now - b.lastRefill;
    b.tokens = Math.min(this.max, b.tokens + (elapsed / this.perMs) * this.max);
    b.lastRefill = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}

// 输入清洗
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('昵称必须为字符串');
  const trimmed = raw.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (trimmed.length < 1 || trimmed.length > 20) throw new Error('昵称长度需在1-20字符之间');
  return trimmed;
}

export function sanitizeChat(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('消息必须为字符串');
  const trimmed = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  if (trimmed.length < 1 || trimmed.length > 300) throw new Error('消息长度需在1-300字符之间');
  return trimmed;
}

export function tokenHashIsDeterministic(token: string): boolean {
  return serverSecret !== null;
}
