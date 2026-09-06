// ============================================================
// 内置机器人：根据玩家视图自动产生合法命令。
// 机器人与真人玩家走完全相同的权威命令通道（服务端校验、幂等、串行化），
// 只能依据其应知的视图信息决策——不读取任何隐藏状态。
// ============================================================

import { Command, PlayerView, PendingChoice, ViewPending } from '@ftk/engine';

type View = PlayerView;

/** 根据视图与待处理选择，返回机器人要执行的命令；返回 null 表示无需行动 */
export function botDecide(view: View, pending: PendingChoice | ViewPending | null, attempt = 0): Command | null {
  if (!view || view.result) return null;
  if (view.you.eliminated) return null;

  // 激活窗口：20% 概率启动角色，否则通过
  if (!pending) {
    if (view.activationWindowKind && !view.youPassedWindow) {
      const opts = view.activationOptions ?? [];
      if (opts.length > 0 && seededRandom(view.you.seatId + view.round) < 0.2) {
        return { type: 'activateCharacter', characterId: opts[0].characterId };
      }
      return { type: 'pass' };
    }
    return null;
  }

  const data = pending.data ?? {};
  const alive = view.players.filter((p) => !p.eliminated);
  const me = view.you.seatId;
  const cap = view.captain;
  const lt = view.lieutenant;
  const chosen = (data.chosen as number[]) ?? [];

  switch (pending.kind) {
    case 'appointTeam': {
      // 优先非停职者；人手不足时停职者也可被任命（服务端校验），避免卡死
      const rank = (p: { offDuty: boolean }) => (p.offDuty ? 1 : 0);
      if (data.navigatorOnly === true) {
        const cands = alive
          .filter((p) => p.seatId !== cap && p.seatId !== lt)
          .sort((a, b) => rank(a) - rank(b));
        if (cands.length === 0) return null;
        return { type: 'appoint', lieutenant: lt, navigator: cands[0].seatId };
      }
      const pool = alive.filter((p) => p.seatId !== cap).sort((a, b) => rank(a) - rank(b));
      if (pool.length < 2) return null;
      // 按 attempt 轮换组合，规避个别候选被规则拒绝导致的卡死
      const i = Math.max(0, attempt) % pool.length;
      const j = (i + 1 + (Math.max(0, attempt) % Math.max(1, pool.length - 1))) % pool.length;
      const ltSeat = pool[i].seatId;
      const navSeat = pool[j === i ? (i + 1) % pool.length : j].seatId;
      return { type: 'appoint', lieutenant: ltSeat, navigator: navSeat };
    }
    case 'consultantLieutenant': {
      const cands = alive.filter((p) => p.seatId !== cap && p.seatId !== view.navigator);
      if (cands.length === 0) return null;
      return { type: 'choosePlayer', seat: cands[0].seatId };
    }
    case 'mutinySubmit': {
      const guns = view.you.guns ?? 0;
      const min = (data.yourMin as number) ?? 0;
      const max = Math.min((data.yourMax as number) ?? guns, guns);
      if (max < min) return null;
      // 首选简单策略（有枪时一半概率出1把）；被拒后按 attempt 递增以避开强制下限
      const preferred = min + (max > min && seededRandom(me * 7 + view.round) < 0.5 ? 1 : 0);
      const count = Math.max(min, Math.min(max, preferred + attempt));
      return { type: 'submitGuns', count };
    }
    case 'tiePick': {
      const cands = (data.candidates as number[]) ?? [];
      const target = cands.find((s) => s !== me) ?? cands[0];
      if (target === undefined) return null;
      return { type: 'choosePlayer', seat: target };
    }
    case 'emergencyNavigator': {
      // 紧急领航员可以指定停职玩家
      const cands = alive.filter((p) => p.seatId !== cap && p.seatId !== lt);
      if (cands.length === 0) return null;
      return { type: 'choosePlayer', seat: cands[0].seatId };
    }
    case 'choosePlayer': {
      const cands = chooseCandidates(view, pending);
      if (cands.length === 0) return null;
      // 目标可能因隐藏状态被服务端拒绝：按尝试次数轮换候选
      const base = Math.floor(seededRandom(me * 13 + pending.id) * cands.length);
      const idx = (base + Math.max(0, attempt)) % cands.length;
      return { type: 'choosePlayer', seat: cands[idx] };
    }
    case 'chooseCard': {
      if (data.archivistRedraw) return { type: 'pass' }; // 保留原牌
      const cards = (data.cards as string[]) ?? view.yourHand ?? [];
      if (cards.length === 0) return null;
      return { type: 'chooseCard', cardId: cards[0] };
    }
    case 'navigatorChoose': {
      const cards = (data.cards as string[]) ?? [];
      if (cards.length === 0) return null;
      return { type: 'navigatorAction', action: 'discard', cardId: cards[0] };
    }
    case 'floggingSelfDeclare': {
      const f = view.you.faction;
      const declares = f === 'pirate' ? 'pirate' : f === 'sailor' ? 'sailor' : 'cult';
      return { type: 'floggingDeclare', declares };
    }
    case 'gunsStash': {
      const alloc: Record<number, number> = { [me]: 3 };
      return { type: 'allocateGuns', alloc };
    }
    case 'telescopeDecision':
      return { type: 'telescopeDecision', discard: false };
    case 'instigatorAnswer':
      return { type: 'instigatorAnswer', join: true };
    default:
      return null;
  }
}

function chooseCandidates(view: View, pending: PendingChoice | ViewPending): number[] {
  const data = pending.data ?? {};
  const filter = (data.filter as string) ?? '';
  const me = view.you.seatId;
  const alive = view.players.filter((p) => !p.eliminated);
  const cap = view.captain;
  const lt = view.lieutenant;
  const chosen = (data.chosen as number[]) ?? [];
  switch (filter) {
    case 'mapActionTarget':
      return alive.filter((p) => p.seatId !== me).map((p) => p.seatId);
    case 'anyAliveExceptSelf':
      return alive.filter((p) => p.seatId !== me).map((p) => p.seatId);
    case 'aliveExceptSelfAndCaptain':
      return alive.filter((p) => p.seatId !== me && p.seatId !== cap).map((p) => p.seatId);
    case 'hasGuns':
      return alive.filter((p) => p.seatId !== me && (p.guns ?? 0) >= 1).map((p) => p.seatId);
    case 'anyAlive':
      return alive.map((p) => p.seatId);
    case 'anyAliveWithCharacter':
      return alive.map((p) => p.seatId);
    case 'offDutySource':
      return alive.filter((p) => p.offDuty).map((p) => p.seatId);
    case 'notOffDuty':
      return alive
        .filter((p) => !p.offDuty && p.seatId !== data.source)
        .map((p) => p.seatId);
    case 'captainOrLieutenant':
      return alive
        .filter((p) => p.seatId === cap || p.seatId === lt)
        .map((p) => p.seatId);
    case 'aliveExceptCaptain':
      return alive
        .filter((p) => p.seatId !== cap && !chosen.includes(p.seatId))
        .map((p) => p.seatId);
    case 'agitatorTarget':
      return alive
        .filter((p) => p.seatId !== cap && !chosen.includes(p.seatId))
        .map((p) => p.seatId);
    case 'navTeamMember':
      return alive
        .filter((p) => [cap, lt, view.navigator].includes(p.seatId))
        .map((p) => p.seatId);
    case 'convertible':
      // 公开可推知：舱搜/鞭刑过的玩家不可皈依；自己若是邪教主也不可选（服务端校验）
      return alive
        .filter((p) => p.seatId !== me && !p.unconvertible)
        .map((p) => p.seatId);
    case 'mutinyRevealed': {
      const rev = view.mutinyPublic.revealedBySeat ?? {};
      return alive.filter((p) => (rev[p.seatId] ?? 0) > 0).map((p) => p.seatId);
    }
    default:
      return alive.map((p) => p.seatId);
  }
}

// 简单确定性伪随机（基于座位与轮次，保证机器人行为可复现且不依赖隐藏信息）
function seededRandom(n: number): number {
  let x = (n | 0) * 2654435761;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 10000) / 10000;
}

// ============ 自动决策调度器 ============

export interface BotRunnerDeps {
  botSeats: (roomId: string) => number[];
  getGameView: (roomId: string, seatId: number) => PlayerView | null;
  applyBotCommand: (roomId: string, seatId: number, cmd: Command) => Promise<void>;
  onChanged: (roomId: string) => void;
}

export class BotRunner {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private attempts = new Map<string, number>(); // pendingKey -> 尝试次数

  constructor(
    private deps: BotRunnerDeps,
    private minDelayMs = 400,
    private maxDelayMs = 1200,
  ) {}

  /** 状态变化后调用：为该房间安排一次机器人思考（去抖） */
  kick(roomId: string) {
    if (this.timers.has(roomId)) return;
    const delay = this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);
    const t = setTimeout(() => {
      this.timers.delete(roomId);
      void this.think(roomId);
    }, delay);
    this.timers.set(roomId, t);
  }

  private async think(roomId: string) {
    let acted = false;
    let rejectedKey: string | null = null;
    for (const seatId of this.deps.botSeats(roomId)) {
      const view = this.deps.getGameView(roomId, seatId);
      if (!view || view.result) continue;
      const pending = view.pending.find((p) => p.mine) ?? null;
      const key = pending ? `${roomId}:${pending.id}` : `${roomId}:w${seatId}`;
      const attempt = this.attempts.get(key) ?? 0;
      const cmd = botDecide(view, pending, attempt);
      if (!cmd) continue;
      try {
        await this.deps.applyBotCommand(roomId, seatId, cmd);
        acted = true;
        this.attempts.delete(key);
      } catch {
        // 决策被规则拒绝（目标受隐藏状态限制）：记录尝试次数，换下一个候选
        this.attempts.set(key, attempt + 1);
        rejectedKey = key;
      }
    }
    if (acted) {
      this.deps.onChanged(roomId);
      if (this.hasPendingDecision(roomId)) this.kick(roomId);
    } else if (rejectedKey) {
      const attempt = this.attempts.get(rejectedKey) ?? 0;
      if (attempt <= 20) {
        this.deps.onChanged(roomId);
        this.kick(roomId); // 换候选重试（有上限，防止无限循环）
      }
    }
  }

  private hasPendingDecision(roomId: string): boolean {
    for (const seatId of this.deps.botSeats(roomId)) {
      const view = this.deps.getGameView(roomId, seatId);
      if (!view || view.result) continue;
      if (view.pending.some((p) => p.mine)) return true;
      if (view.activationWindowKind && !view.youPassedWindow) return true;
    }
    return false;
  }

  stopAll() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
