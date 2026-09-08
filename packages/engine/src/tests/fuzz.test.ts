import { describe, it, expect } from 'vitest';
import { makeState, topPending } from './helpers';
import { applyCommand, RuleError } from '../engine';
import { GameState, Command } from '../types';
import { NAV_DECK_FULL } from '../data/gamedata';

// ============ 随机完整对局 fuzz ============
// 每一步从合法命令中随机选择，验证：
//  1. 游戏总能到达终局（无死锁）
//  2. 组件守恒（导航牌总数、枪支总数）
//  3. 非法命令总能被拒绝而不是崩溃

class SeededRandom {
  private s: number;
  constructor(seed: number) {
    this.s = seed | 0 || 1;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x | 0;
    return ((x >>> 0) % 100000) / 100000;
  }
  int(n: number): number {
    return Math.floor(this.next() * n) % Math.max(1, n);
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)];
  }
}

function cardSum(state: GameState): number {
  const nav = state.navigation;
  const capRem = nav.captainCards.filter((c) => !(nav.captainDiscarded ?? []).includes(c)).length;
  const ltRem = nav.lieutenantCards.filter((c) => !(nav.lieutenantDiscarded ?? []).includes(c)).length;
  const handsLive =
    nav.logbook.length > 0
      ? nav.logbook.length
      : ['navCaptainDiscard', 'navLieutenantDiscard'].includes(state.stage)
        ? capRem + ltRem
        : 0;
  // 领航员已选定但船长尚未公开时，这张牌既不在日志也尚未计入简历。
  const awaitingCaptainReveal = state.stage === 'navCaptainReveal' && state.playedCardThisRound ? 1 : 0;
  return (
    state.navDeck.length +
    state.navDiscard.length +
    handsLive +
    awaitingCaptainReveal +
    state.players.reduce((a, p) => a + p.resumeCount, 0)
  );
}

function gunSum(state: GameState): number {
  let submitted = 0;
  if (state.mutiny.stage === 'revealed' || state.mutiny.stage === 'submitting') {
    for (const s of Object.keys(state.mutiny.submissions)) {
      submitted += state.mutiny.submissions[Number(s)] ?? 0;
    }
  }
  return (
    state.gunSupply +
    state.players.reduce((a, p) => a + p.guns, 0) +
    submitted
  );
}

function tryCommand(state: GameState, seat: number, cmd: Command): boolean {
  try {
    applyCommand(state, seat, cmd);
    return true;
  } catch (e) {
    if (e instanceof RuleError) return false; // 非法尝试：换一个
    throw e;
  }
}

function fuzzStep(state: GameState, rnd: SeededRandom): void {
  const alive = state.players.filter((p) => !p.eliminated).map((p) => p.seatId);
  // 0. 若存在非窗口 pending（角色效果的后续选择），必须先处理它
  const pEarly = topPending(state);
  if (pEarly && pEarly.kind !== 'activationWindow') {
    handlePending(state, rnd, pEarly);
    return;
  }
  // 1. 激活窗口
  if (state.activation) {
    const me = rnd.pick(alive);
    const canAct = state.players[me].characterId && !state.players[me].characterRevealed;
    if (canAct && rnd.next() < 0.25) {
      if (tryCommand(state, me, { type: 'activateCharacter', characterId: state.players[me].characterId! })) return;
    }
    if (tryCommand(state, me, { type: 'pass' })) return;
    for (const s of alive) {
      if (tryCommand(state, s, { type: 'pass' })) return;
    }
    throw new Error(`窗口无法推进: stage=${state.stage} passed=${JSON.stringify(state.activation.passedSeats)}`);
  }
  // 2. pending
  const p = topPending(state);
  if (!p) throw new Error(`无 pending 无窗口却不在终局: stage=${state.stage}`);
  handlePending(state, rnd, p);
}

function handlePending(state: GameState, rnd: SeededRandom, p: { kind: string; actorSeat: number; data: Record<string, unknown> }): void {
  const actor = p.actorSeat;
  switch (p.kind) {
    case 'appointTeam': {
      const navigatorOnly = p.data.navigatorOnly === true;
      const base = state.players
        .filter((q) => !q.eliminated && q.seatId !== state.captain && !(navigatorOnly && q.seatId === state.lieutenant))
        .map((q) => q.seatId);
      // 优先非停职者；不够时全部尝试
      const preferred = base.filter((s) => !state.players[s].offDuty);
      const pool = preferred.length >= 1 ? preferred : base;
      const order = rnd.next() < 0.5 ? pool : pool.slice().reverse();
      if (navigatorOnly) {
        for (const nav of order) {
          if (tryCommand(state, actor, { type: 'appoint', lieutenant: state.lieutenant, navigator: nav })) return;
        }
      } else {
        for (const a of order) {
          for (const b of order) {
            if (a !== b && tryCommand(state, actor, { type: 'appoint', lieutenant: a, navigator: b })) return;
          }
        }
      }
      break;
    }
    case 'consultantLieutenant': {
      const candidates = state.players.filter((q) => !q.eliminated && q.seatId !== state.captain).map((q) => q.seatId);
      if (tryCommand(state, actor, { type: 'choosePlayer', seat: rnd.pick(candidates) })) return;
      break;
    }
    case 'mutinySubmit': {
      const eligible = (p.data.eligible as number[]) ?? [];
      const submitter = eligible.find((s) => state.mutiny.submissions[s] === null || state.mutiny.submissions[s] === undefined);
      if (submitter === undefined) break;
      const guns = state.players[submitter].guns;
      const max = Math.min(state.mutiny.maxRevealPerPlayer ?? guns, guns);
      const forcedMin = Math.min(state.mutiny.forcedMinBySeat[submitter] ?? 0, max);
      const lo = Math.max(0, forcedMin);
      if (max >= lo) {
        for (let c = lo; c <= max; c++) {
          const cc = rnd.next() < 0.7 ? Math.min(max, lo + rnd.int(max - lo + 1)) : c;
          if (cc >= lo && cc <= max && tryCommand(state, submitter, { type: 'submitGuns', count: cc })) return;
        }
      }
      break;
    }
    case 'tiePick': {
      const candidates = (p.data.candidates as number[]) ?? state.mutiny.tieChain;
      if (tryCommand(state, actor, { type: 'choosePlayer', seat: rnd.pick(candidates) })) return;
      break;
    }
    case 'chooseCard': {
      const cards = (p.data.cards as string[]) ?? [];
      if (cards.length > 0) {
        if (tryCommand(state, actor, { type: 'chooseCard', cardId: rnd.pick(cards) })) return;
      } else if (p.data.archivistRedraw) {
        if (tryCommand(state, actor, { type: 'chooseCard', cardId: 'redraw' })) return;
      }
      break;
    }
    case 'navigatorChoose': {
      if (rnd.next() < 0.05) {
        if (tryCommand(state, actor, { type: 'navigatorAction', action: 'jumpShip' })) return;
      }
      const cards = (p.data.cards as string[]) ?? [];
      if (cards.length > 0 && tryCommand(state, actor, { type: 'navigatorAction', action: 'discard', cardId: rnd.pick(cards) })) return;
      break;
    }
    case 'captainReveal': {
      if (tryCommand(state, actor, { type: 'revealNavigation' })) return;
      break;
    }
    case 'emergencyNavigator': {
      const candidates = state.players.filter((q) => !q.eliminated && q.seatId !== state.captain && q.seatId !== state.lieutenant).map((q) => q.seatId);
      if (tryCommand(state, actor, { type: 'choosePlayer', seat: rnd.pick(candidates) })) return;
      break;
    }
    case 'choosePlayer': {
      const filter = p.data.filter as string;
      let candidates = state.players.filter((q) => !q.eliminated).map((q) => q.seatId);
      if (['anyAliveExceptSelf', 'hasGuns', 'mapActionTarget'].includes(filter)) {
        candidates = candidates.filter((s) => s !== actor);
      }
      if (filter === 'offDutySource') candidates = state.players.filter((q) => q.offDuty && !q.eliminated).map((q) => q.seatId);
      if (filter === 'notOffDuty') candidates = state.players.filter((q) => !q.offDuty && !q.eliminated && q.seatId !== p.data.source).map((q) => q.seatId);
      if (filter === 'captainOrLieutenant') candidates = [state.captain, state.lieutenant].filter((s) => s >= 0);
      if (filter === 'convertible') {
        candidates = state.players
          .filter((q) => !q.eliminated && q.faction !== 'cultLeader' && q.faction !== 'cultist' && !q.cabinSearched && !q.flogged)
          .map((q) => q.seatId);
      }
      const order = rnd.next() < 0.5 ? candidates : candidates.slice().reverse();
      for (const s of order) {
        if (tryCommand(state, actor, { type: 'choosePlayer', seat: s })) return;
      }
      break;
    }
    case 'floggingSelfDeclare': {
      if (tryCommand(state, actor, { type: 'floggingDeclare', declares: rnd.pick(['sailor', 'pirate', 'cult'] as const) })) return;
      break;
    }
    case 'gunsStash': {
      const alloc: Record<number, number> = { [actor]: 3 };
      if (tryCommand(state, actor, { type: 'allocateGuns', alloc })) return;
      break;
    }
    case 'telescopeDecision': {
      if (tryCommand(state, actor, { type: 'telescopeDecision', discard: rnd.next() < 0.5 })) return;
      break;
    }
    case 'instigatorAnswer': {
      if (tryCommand(state, actor, { type: 'instigatorAnswer', join: rnd.next() < 0.5 })) return;
      break;
    }
    default:
      throw new Error(`fuzz 未处理的 pending kind: ${p.kind}`);
  }
  throw new Error(`pending ${p.kind} 无合法命令可执行: stage=${state.stage}`);
}

describe('随机完整对局 fuzz', () => {
  // 多种子 × 多人数：验证总能终局、守恒、无死锁
  const configs: [number, number][] = [
    [5, 101], [5, 202], [6, 303], [6, 404],
    [7, 505], [7, 606], [8, 707], [8, 808],
    [9, 909], [9, 1010], [10, 1111], [10, 1212],
    [11, 1313], [11, 1414], [11, 1515], [6, 1616],
    [8, 1717], [10, 1818],
  ];

  it.each(configs)('%d人局 seed=%d：完整对局到终局', (n, seed) => {
    const state = makeState(n, seed);
    const rnd = new SeededRandom(seed * 7919);
    let steps = 0;
    const maxSteps = 20000;
    while (!state.result && steps < maxSteps) {
      steps++;
      // 不变量检查（在等待点进行）
      if (steps % 50 === 0) {
        if (cardSum(state) !== 23) {
          const nav = state.navigation;
          console.error('CARD MISMATCH', JSON.stringify({
            seed, n, steps, sum: cardSum(state),
            deck: state.navDeck.length, discard: state.navDiscard.length,
            cap: nav.captainCards, capD: nav.captainDiscarded,
            lt: nav.lieutenantCards, ltD: nav.lieutenantDiscarded,
            log: nav.logbook, played: state.playedCardThisRound,
            resumes: state.players.map((p) => p.resumeCount),
            stage: state.stage, pend: state.pending.map((q) => q.kind),
            lastLogs: state.log.slice(-6).map((l) => l.textZh),
          }));
          expect(cardSum(state)).toBe(23);
        }
        expect(gunSum(state)).toBe(40);
      }
      fuzzStep(state, rnd);
    }
    expect(state.result).not.toBeNull();
    expect(['sailor', 'pirate', 'cult']).toContain(state.result!.winner);
    expect(cardSum(state)).toBe(23);
    expect(gunSum(state)).toBe(40);
    // 终局时所有阵营确定
    expect(state.players.every((p) => p.faction)).toBe(true);
  }, 60000);

  it('多局统计：不同阵营都能获胜（游戏可达性）', () => {
    const winners = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const n = 5 + (seed % 7);
      const state = makeState(n, seed * 1000 + 3);
      const rnd = new SeededRandom(seed * 33331);
      let steps = 0;
      while (!state.result && steps < 30000) {
        steps++;
        fuzzStep(state, rnd);
      }
      expect(state.result).not.toBeNull();
      winners.add(state.result!.winner);
    }
    expect(winners.size).toBeGreaterThanOrEqual(2);
  }, 120000);
});
