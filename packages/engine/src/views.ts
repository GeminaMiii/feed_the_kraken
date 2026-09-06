// ============================================================
// 玩家视图投影 — 集中控制信息可见性。
// 任何客户端只应收到 buildPlayerView 的输出；秘密数据不得进入。
// ============================================================

import {
  ActivationOption,
  Faction,
  GameState,
  PlayerView,
  PendingChoice,
  ViewPending,
  ViewPlayer,
} from './types';
import { CHARACTER_MAP } from './data/characters';
import { alivePlayers, seatOf } from './state';
import { cardNameZh, ritualNameZh } from './engine';

const STAGE_ZH: Record<string, string> = {
  roundStart: '回合开始（任命前）',
  appoint: '任命航海组',
  afterAppoint: '任命后（角色窗口）',
  mutinySubmit: '忠诚质询（秘密出枪）',
  mutinySubmitWait: '忠诚质询（等待全员出枪）',
  mutinyReveal: '枪数揭示',
  mutinyResolve: '哗变结算',
  preDraw: '航海准备（抽牌前）',
  draw: '抽取导航牌',
  navCaptainDiscard: '船长弃牌',
  navLieutenantDiscard: '副手弃牌',
  navNavigator: '领航员抉择',
  resolveNavCard: '执行导航牌',
  yellowWindow: '黄牌回合（角色窗口）',
  offDuty: '停职结算',
  roundEnd: '回合结束',
  ended: '对局结束',
};

export const STAGE_LABELS = STAGE_ZH;

export function waitingForText(state: GameState): string {
  if (state.result) return '对局已结束';
  const pending = state.pending[state.pending.length - 1];
  if (pending && pending.kind !== 'activationWindow') {
    return `等待 ${seatOf(state, pending.actorSeat).name}：${pending.reasonZh}`;
  }
  if (state.activation) {
    const notPassed = alivePlayers(state).filter(
      (p) => !state.activation!.passedSeats.includes(p.seatId),
    );
    const kindZh: Record<string, string> = {
      beforeAppointment: '任命前角色窗口',
      afterAppointment: '任命后角色窗口',
      beforeDraw: '抽牌前角色窗口',
      afterReveal: '枪揭示后角色窗口',
      yellowRound: '黄牌回合角色窗口',
      free: '自由窗口',
    };
    return `角色窗口（${kindZh[state.activation.windowKind] ?? state.activation.windowKind}）：等待 ${notPassed.map((p) => p.name).join('、') || '无人'} 出牌或通过`;
  }
  return STAGE_ZH[state.stage] ?? state.stage;
}

function teammatesOf(state: GameState, seatId: number): number[] {
  const me = seatOf(state, seatId);
  const out: number[] = [];
  if (!me.faction) return out;
  if (me.faction === 'pirate') {
    // 海盗开局互识
    for (const p of state.players) {
      if (p.seatId !== seatId && p.faction === 'pirate' && !p.eliminated) out.push(p.seatId);
    }
    // 出局海盗是否公开？出局不公开阵营 → 不加入
  }
  if (me.faction === 'cultist') {
    // 邪教徒知道吸收自己的邪教主
    for (const p of state.players) {
      if (p.seatId !== seatId && p.faction === 'cultLeader') out.push(p.seatId);
    }
  }
  return out;
}

export function buildPlayerView(state: GameState, seatId: number): PlayerView {
  const me = seatOf(state, seatId);
  const players: ViewPlayer[] = state.players.map((p) => {
    const revealed = p.characterRevealed && p.characterId ? p.characterId : null;
    return {
      seatId: p.seatId,
      name: p.name,
      connected: true, // 由服务端填充连接状态
      guns: p.guns, // 哗变外为公开信息
      resumeCount: p.resumeCount,
      offDuty: p.offDuty && state.captain !== p.seatId ? false : p.offDuty,
      noTongue: p.noTongue,
      eliminated: p.eliminated,
      eliminationReason: p.eliminationReason,
      notFactions: p.notFactions.slice(),
      resumes: p.resumes.slice(),
      unconvertible: p.cabinSearched || p.flogged,
      characterRevealed: p.characterRevealed,
      revealedCharacterId: revealed,
      isCaptain: state.captain === p.seatId,
      isLieutenant: state.lieutenant === p.seatId,
      isNavigator: state.navigator === p.seatId,
      faction: p.seatId === seatId ? p.faction : null, // 永不泄露他人阵营
      characterId: p.seatId === seatId ? p.characterId : null,
      characterRevealedSelf: p.characterRevealed,
    };
  });

  // 待处理选择（过滤 data 中的秘密字段）
  const pendings: ViewPending[] = state.pending
    .filter((p) => p.kind !== 'activationWindow')
    .map((p) => ({
      id: p.id,
      kind: p.kind,
      mine: p.actorSeat === seatId,
      actorSeat: p.actorSeat,
      reasonZh: p.reasonZh,
      data: sanitizePendingData(state, p, seatId),
    }));

  // 激活窗口选项
  let activationOptions: ActivationOption[] = [];
  if (state.activation && !me.eliminated) {
    activationOptions = computeActivationOptionsForView(state, seatId);
  }

  // 私密日志
  const log = state.log.filter((l) => l.visibility === 'public' || l.visibility === seatId);

  // 航海手牌
  let yourHand: string[] = [];
  const nav = state.navigation;
  if (state.captain === seatId && nav.captainCards.length > 0 && !isDiscarded(nav.captainDiscarded, nav.captainCards)) {
    yourHand = nav.captainCards.slice();
  } else if (state.lieutenant === seatId && nav.lieutenantCards.length > 0 && !isDiscarded(nav.lieutenantDiscarded, nav.lieutenantCards)) {
    yourHand = nav.lieutenantCards.slice();
  }
  // 领航员：日志中的两张牌仅其本人可见
  let logbookCount = 0;
  if (nav.logbook.length > 0) {
    logbookCount = nav.logbook.length;
    if (state.navigator === seatId && !state.result) {
      yourHand = nav.logbook.slice();
    }
  }

  const view: PlayerView = {
    you: {
      seatId,
      name: me.name,
      faction: me.faction,
      characterId: me.characterId,
      characterRevealed: me.characterRevealed,
      guns: me.guns,
      offDuty: me.offDuty,
      noTongue: me.noTongue,
      eliminated: me.eliminated,
      teammates: teammatesOf(state, seatId),
    },
    players,
    mapId: state.mapId,
    shipHex: state.shipHex,
    prevShipHex: state.prevShipHex,
    usedMapActions: [],
    round: state.round,
    stage: state.stage,
    stageZh: STAGE_ZH[state.stage] ?? state.stage,
    captain: state.captain,
    lieutenant: state.lieutenant,
    navigator: state.navigator,
    navDeckCount: state.navDeck.length,
    navDiscardCount: state.navDiscard.length,
    yourHand,
    logbookCount,
    pending: pendings,
    activationOptions,
    activationWindowKind: state.activation?.windowKind ?? null,
    youPassedWindow: state.activation?.passedSeats.includes(seatId) ?? false,
    result: state.result,
    notFactionsPublic: Object.fromEntries(
      state.players.map((p) => [p.seatId, p.notFactions.slice()]),
    ),
    ritualsRevealed: state.cultRitual.deckOrder
      .slice(0, state.cultRitual.revealedCount)
      .map(ritualNameZh),
    mutinyPublic: {
      stage: state.mutiny.stage,
      revealedTotal: state.mutiny.stage === 'revealed' ? state.mutiny.revealedTotal : null,
      threshold: state.mutiny.threshold,
      revealedBySeat: state.mutiny.stage === 'revealed' ? revealSubmissions(state, seatId) : null,
    },
    waitingFor: waitingForText(state),
  };
  void log;
  return view;
}

function isDiscarded(discarded: string[] | undefined, cards: string[]): boolean {
  if (!discarded || discarded.length === 0) return false;
  // 已弃牌后手中不再持有（手牌从视图移除）
  return cards.every((c) => discarded.includes(c));
}

// 哗变揭示后，揭示的枪数是公开信息
function revealSubmissions(state: GameState, viewerSeat: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const s of Object.keys(state.mutiny.submissions)) {
    const seat = Number(s);
    const v = state.mutiny.submissions[seat];
    if (v === null || v === undefined) continue;
    out[seat] = v;
  }
  return out;
}

function sanitizePendingData(state: GameState, p: PendingChoice, viewerSeat: number): Record<string, unknown> {
  const data = p.data;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(data)) {
    // 秘密字段绝不下发：牌的具体内容、提交枪数等
    if (['cards', 'cardPreview'].includes(k)) {
      // 只有当 actor 是本人时才下发可选牌列表
      if (p.actorSeat === viewerSeat) out[k] = data[k];
      else out[k] = null;
      continue;
    }
    out[k] = data[k];
  }
  // 忠诚质询：本人可知道的出枪上下限（煽动者强制为公开事件）
  if (p.kind === 'mutinySubmit' && p.actorSeat === viewerSeat) {
    out.yourMin = state.mutiny.forcedMinBySeat[viewerSeat] ?? 0;
    out.yourMax = state.mutiny.maxRevealPerPlayer ?? seatOf(state, viewerSeat).guns;
  }
  return out;
}

function computeActivationOptionsForView(state: GameState, seatId: number): ActivationOption[] {
  // 只返回本人可启动的选项
  const me = seatOf(state, seatId);
  if (me.eliminated) return [];
  const cid = me.characterId;
  if (!cid || me.characterRevealed) return [];
  const def = CHARACTER_MAP[cid];
  if (!def) return [];
  const wk = state.activation!.windowKind;
  const timingOk =
    def.timing === 'anytime' ||
    def.timing === 'gunCost' ||
    (def.timing === 'beforeAppointment' && wk === 'beforeAppointment') ||
    (def.timing === 'afterAppointment' && wk === 'afterAppointment') ||
    (def.timing === 'beforeDraw' && wk === 'beforeDraw') ||
    (def.timing === 'afterReveal' && wk === 'afterReveal') ||
    (def.timing === 'yellowRound' && wk === 'yellowRound' && state.yellowPlayedThisRound);
  if (!timingOk) return [];
  // 详细可用性由服务端在 activate 时校验；此处仅提示
  return [{ seatId, characterId: cid, needsGunCost: def.timing === 'gunCost' }];
}

// 观战/大厅公共视图（不含任何秘密）
export function buildSpectatorView(state: GameState): PlayerView {
  return buildPlayerView(state, -99);
}
