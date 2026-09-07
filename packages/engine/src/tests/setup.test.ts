import { describe, it, expect } from 'vitest';
import { makeState, passWindow, topPending, expectPending, cmd, submitAll } from './helpers';
import { NAV_DECK_FULL, NAV_DECK_QUICK } from '../data/gamedata';
import { CHARACTERS } from '../data/characters';
import { getLongMap, getQuickMap } from '../data/maps';
import { createGameState } from '../state';

const LONG_MAP = getLongMap();
import { SeededRng } from '../rng';
import { applyCommand } from '../engine';
import { buildPlayerView } from '../views';

describe('开局设置', () => {
  it('22张角色牌、23张导航牌（长航程）数据完整且ID唯一', () => {
    expect(CHARACTERS.length).toBe(22);
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(22);
    expect(NAV_DECK_FULL.length).toBe(23);
    expect(new Set(NAV_DECK_FULL.map((c) => c.id)).size).toBe(23);
    expect(NAV_DECK_QUICK.length).toBe(19);
  });

  it('长航程地图完整性：31格、出口对称性、行动格数量', () => {
    const hexes = Object.values(LONG_MAP.hexes);
    expect(hexes.length).toBe(31);
    const actions = hexes.filter((h) => h.action);
    const count = (k: string) => actions.filter((h) => h.action === k).length;
    expect(count('cabinSearch')).toBe(4);
    expect(count('flogging')).toBe(2);
    expect(count('offWithTongue')).toBe(1);
    expect(count('feedTheKraken')).toBe(3);
    // 每个出口要么是合法 hex，要么是胜利终点
    for (const h of hexes) {
      for (const dir of ['north', 'west', 'east'] as const) {
        const e = h.exits[dir];
        expect(e.startsWith('victory_') || LONG_MAP.hexes[e]).toBeTruthy();
      }
    }
  });

  it.each([5, 6, 7, 8, 9, 10, 11])('%d人开局：阵营配置、枪数、船长确定', (n) => {
    const state = makeState(n, 123);
    expect(state.players.length).toBe(n);
    expect(state.players.every((p) => p.guns === 3)).toBe(true);
    expect(state.players.every((p) => p.faction)).toBe(true);
    const factions = state.players.map((p) => p.faction);
    expect(factions.filter((f) => f === 'cultLeader').length).toBe(1);
    if (n < 11) expect(factions.filter((f) => f === 'cultist').length).toBe(0);
    if (n === 6) {
      expect(factions.filter((f) => f === 'sailor').length).toBe(3);
      expect(factions.filter((f) => f === 'pirate').length).toBe(2);
    }
    // 船长已确定且唯一
    expect(state.captain).toBeGreaterThanOrEqual(0);
    expect(state.players[state.captain].characterId).not.toBe('chr_captain');
    // 船长角色牌来自剩余牌堆
    const ids = state.players.map((p) => p.characterId);
    expect(new Set(ids).size).toBe(n);
  });

  it('第一轮从任命前窗口开始，非法命令被拒绝', () => {
    const state = makeState(6);
    expect(state.activation?.windowKind).toBe('beforeAppointment');
    // 不能任命（窗口期）
    expect(() => applyCommand(state, state.captain, { type: 'appoint', lieutenant: 0, navigator: 1 })).toThrow();
    passWindow(state);
    expectPending(state, 'appointTeam', state.captain);
    // 任命自己应被拒绝
    expect(() =>
      applyCommand(state, state.captain, { type: 'appoint', lieutenant: state.captain, navigator: (state.captain + 1) % 6 }),
    ).toThrow();
    // 非船长任命被拒绝
    expect(() =>
      applyCommand(state, (state.captain + 1) % 6, { type: 'appoint', lieutenant: (state.captain + 1) % 6, navigator: (state.captain + 2) % 6 }),
    ).toThrow();
  });

  it('出局后无法操作', () => {
    const state = makeState(6);
    state.players[2].eliminated = true;
    expect(() => applyCommand(state, 2, { type: 'pass' })).toThrow(/出局/);
  });
});

describe('秘密阵营认知投影', () => {
  it('海盗被感化后保留双方要求的非对称认知', () => {
    const state = makeState(6, 321);
    state.players.forEach((p) => { p.faction = 'sailor'; });
    state.players[0].faction = 'pirate';
    state.players[1].faction = 'cultist'; // 原海盗，现已被感化
    state.players[2].faction = 'cultLeader';
    state.initialPirateSeats = [0, 1];
    state.convertedCultists = [1];

    const oldPirateView = buildPlayerView(state, 0);
    expect(oldPirateView.you.teammates).toContain(1);
    expect(oldPirateView.players[1].faction).toBe('pirate');

    const convertedView = buildPlayerView(state, 1);
    expect(convertedView.you.teammates).toEqual([2]);
    expect(convertedView.players[2].faction).toBe('cultLeader');

    const leaderView = buildPlayerView(state, 2);
    expect(leaderView.you.teammates).toContain(1);
    expect(leaderView.players[1].faction).toBe('cultist');
  });

  it('邪教主秘密操作不会向其他玩家泄露操作者座位或效果数据', () => {
    const state = makeState(6, 654);
    state.players[2].faction = 'cultLeader';
    state.pending = [{
      id: 9001,
      kind: 'choosePlayer',
      actorSeat: 2,
      data: { effect: 'conversionToCult', filter: 'convertible' },
      reasonZh: '邪教皈依：选择一名玩家',
      createdAtEvent: state.eventSeq,
    }];
    const outsider = buildPlayerView(state, 0);
    expect(outsider.waitingFor).toBe('等待邪教主进行秘密操作');
    expect(outsider.pending[0].actorSeat).toBe(-1);
    expect(outsider.pending[0].data).toEqual({});
    expect(JSON.stringify(outsider)).not.toContain('conversionToCult');

    const leader = buildPlayerView(state, 2);
    expect(leader.pending[0].mine).toBe(true);
    expect(leader.pending[0].actorSeat).toBe(2);
    expect(leader.pending[0].data.effect).toBe('conversionToCult');
  });
});

describe('快航程地图（5-7人）', () => {
  const quick = getQuickMap();
  it('结构完整：22格、行动格 3舱搜+2献祭、无鞭刑/割舌、无补给线', () => {
    const hexes = Object.values(quick.hexes);
    expect(hexes.length).toBe(22);
    const count = (k: string) => hexes.filter((h) => h.action === k).length;
    expect(count('cabinSearch')).toBe(3);
    expect(count('feedTheKraken')).toBe(2);
    expect(count('flogging')).toBe(0);
    expect(count('offWithTongue')).toBe(0);
    expect(hexes.some((h) => h.supply)).toBe(false);
    for (const h of hexes) {
      for (const dir of ['north', 'west', 'east'] as const) {
        const e = h.exits[dir];
        expect(e.startsWith('victory_') || quick.hexes[e]).toBeTruthy();
      }
    }
  });

  it('auto 选图：5-7人快航程，8人以上长航程', () => {
    const s5 = makeState(5, 1, { mapId: 'auto' });
    expect(s5.mapId).toBe('quick');
    expect(s5.navDeck.length).toBe(19);
    const s8 = makeState(8, 1, { mapId: 'auto' });
    expect(s8.mapId).toBe('long');
    expect(s8.navDeck.length).toBe(23);
  });

  it('快航程各胜利可达且距离合理（从起点）', () => {
    // BFS 计算从起点到各胜利的最少移动次数
    const dist = new Map<string, number>();
    dist.set(quick.startHexId, 0);
    const queue = [quick.startHexId];
    let minPirate = 99, minSailor = 99, minCult = 99;
    while (queue.length) {
      const cur = queue.shift()!;
      const d = dist.get(cur)!;
      if (d > 12) continue;
      const hex = quick.hexes[cur];
      for (const dir of ['north', 'west', 'east'] as const) {
        const e = hex.exits[dir];
        if (e === 'victory_pirate') minPirate = Math.min(minPirate, d + 1);
        else if (e === 'victory_sailor') minSailor = Math.min(minSailor, d + 1);
        else if (e === 'victory_cult') minCult = Math.min(minCult, d + 1);
        else if (!dist.has(e)) { dist.set(e, d + 1); queue.push(e); }
      }
    }
    // 牌堆构成：红9/蓝5/黄5 → 三方都应在 7 步内可达（保证博弈空间）
    expect(minPirate).toBeLessThanOrEqual(7);
    expect(minSailor).toBeLessThanOrEqual(7);
    expect(minCult).toBeLessThanOrEqual(7);
    expect(Math.min(minPirate, minSailor, minCult)).toBeGreaterThanOrEqual(3);
  });
});

describe('忠诚质询与哗变', () => {
  function reachSubmit(n = 6, seed = 7) {
    const state = makeState(n, seed);
    passWindow(state);
    applyCommand(state, state.captain, {
      type: 'appoint',
      lieutenant: (state.captain + 1) % n,
      navigator: (state.captain + 2) % n,
    });
    passWindow(state); // afterAppointment 窗口
    expectPending(state, 'mutinySubmit');
    return state;
  }

  it('哗变失败：枪数不足，进入航海', () => {
    const state = reachSubmit();
    submitAll(state, () => 0);
    passWindow(state); // 揭示后窗口
    expect(state.stage).toBe('preDraw');
    expect(state.mutiny.stage).toBe('none');
  });

  it('哗变成功：出枪最多者成为新船长，弃掉揭示的枪', () => {
    const state = reachSubmit();
    const cap = state.captain;
    const bySeat: Record<number, number> = {};
    // 找出非船长三个座位给不同枪数
    const nonCap = state.players.filter((p) => p.seatId !== cap);
    bySeat[nonCap[0].seatId] = 3;
    bySeat[nonCap[1].seatId] = 1;
    submitAll(state, (s) => bySeat[s] ?? 0);
    passWindow(state); // 揭示后窗口
    // nonCap[0] 出3把是唯一最多 → 新船长
    expect(state.captain).toBe(nonCap[0].seatId);
    expect(state.players[nonCap[0].seatId].guns).toBe(0); // 3-3
    expect(state.players[nonCap[1].seatId].guns).toBe(2); // 3-1
    expect(state.round).toBe(2);
    expect(state.stage).toBe('roundStart');
  });

  it('哗变平局：由现任船长开始指定退出者，最后留下者任船长', () => {
    const state = reachSubmit(6, 7);
    const cap = state.captain;
    const nonCap = state.players.filter((p) => p.seatId !== cap);
    const a = nonCap[0].seatId;
    const b = nonCap[1].seatId;
    const bySeat: Record<number, number> = {};
    bySeat[a] = 2;
    bySeat[b] = 2;
    submitAll(state, (s) => bySeat[s] ?? 0);
    passWindow(state);
    expectPending(state, 'tiePick', cap);
    // 船长指定 a 退出
    applyCommand(state, cap, { type: 'choosePlayer', seat: a });
    // 剩 b → b 成为船长
    expect(state.captain).toBe(b);
    expect(state.players[a].guns).toBe(1); // 3-2
    expect(state.players[b].guns).toBe(1); // 3-2
  });

  it('重复提交被拒绝', () => {
    const state = reachSubmit();
    const p = topPending(state)!;
    const firstActor = p.actorSeat;
    applyCommand(state, firstActor, { type: 'submitGuns', count: 1 });
    // 该玩家此时不再是被等待者；若其再次提交应被拒绝
    expect(() => applyCommand(state, firstActor, { type: 'submitGuns', count: 2 })).toThrow(
      /等待|提交/,
    );
  });

  it('出枪数超过持有量被拒绝', () => {
    const state = reachSubmit();
    const p = topPending(state)!;
    expect(() => applyCommand(state, p.actorSeat, { type: 'submitGuns', count: 4 })).toThrow();
  });
});

describe('航海流程', () => {
  function reachNavigatorChoice(n = 6, seed = 7) {
    const state = makeState(n, seed);
    passWindow(state);
    applyCommand(state, state.captain, {
      type: 'appoint',
      lieutenant: (state.captain + 1) % n,
      navigator: (state.captain + 2) % n,
    });
    passWindow(state);
    submitAll(state, () => 0);
    passWindow(state); // 揭示后窗口
    passWindow(state); // beforeDraw 窗口
    // 自动完成船长/副手弃牌
    let guard = 0;
    while (topPending(state)?.kind === 'chooseCard' && guard++ < 5) {
      const p = topPending(state)!;
      const cards = p.data.cards as string[];
      applyCommand(state, p.actorSeat, { type: 'chooseCard', cardId: cards[0] });
    }
    expect(state.stage).toBe('navNavigator');
    return state;
  }

  it('船长与副手弃牌后，领航员看到两张牌', () => {
    const state = reachNavigatorChoice();
    const nav = state.navigator;
    const p = topPending(state)!;
    expect(p.kind).toBe('navigatorChoose');
    expect(p.actorSeat).toBe(nav);
    expect((p.data.cards as string[]).length).toBe(2);
  });

  it('领航员弃牌后必须等待船长公开，船长行动后才移动；牌数守恒', () => {
    const state = reachNavigatorChoice();
    const cardSum = () => {
      const capRem = state.navigation.captainCards.filter(
        (c) => !(state.navigation.captainDiscarded ?? []).includes(c),
      ).length;
      const ltRem = state.navigation.lieutenantCards.filter(
        (c) => !(state.navigation.lieutenantDiscarded ?? []).includes(c),
      ).length;
      // 日志中的牌即船长/副手剩余牌的洗混副本，不重复计
      const handsLive =
        state.navigation.logbook.length > 0
          ? state.navigation.logbook.length
          : ['navCaptainDiscard', 'navLieutenantDiscard'].includes(state.stage)
            ? capRem + ltRem
            : 0;
      return (
        state.navDeck.length +
        state.navDiscard.length +
        handsLive +
        state.players.reduce((a, p) => a + p.resumeCount, 0)
      );
    };
    const totalBefore = cardSum();
    expect(totalBefore).toBe(23);
    const p = topPending(state)!;
    const cards = p.data.cards as string[];
    const startHex = state.shipHex;
    applyCommand(state, state.navigator, { type: 'navigatorAction', action: 'discard', cardId: cards[0] });
    expect(topPending(state)?.kind).toBe('captainReveal');
    expect(topPending(state)?.actorSeat).toBe(state.captain);
    expect(state.playedCardThisRound).toBe(cards[1]);
    expect(state.shipHex).toBe(startHex);
    expect(() => applyCommand(state, state.lieutenant, { type: 'revealNavigation' })).toThrow();
    applyCommand(state, state.captain, { type: 'revealNavigation' });
    expect(state.shipHex).not.toBe(startHex);
    expect(cardSum()).toBe(23);
  });

  it('领航员跳海：出局、紧急领航员任命、无忠诚质询', () => {
    const state = reachNavigatorChoice();
    const oldNav = state.navigator;
    applyCommand(state, oldNav, { type: 'navigatorAction', action: 'jumpShip' });
    expect(state.players[oldNav].eliminated).toBe(true);
    expect(state.players[oldNav].eliminationReason).toBe('overboard');
    expectPending(state, 'emergencyNavigator', state.captain);
    const newNav = state.players.find((p) => !p.eliminated && p.seatId !== state.captain && p.seatId !== state.lieutenant)!.seatId;
    applyCommand(state, state.captain, { type: 'choosePlayer', seat: newNav });
    expect(state.navigator).toBe(newNav);
    // 直接进入新的航海抽牌
    expect(['navNavigator', 'navCaptainDiscard', 'navLieutenantDiscard', 'draw']).toContain(state.stage);
  });
});
