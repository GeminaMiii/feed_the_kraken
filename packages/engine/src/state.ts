import {
  GameState,
  PlayerState,
  RoomConfig,
  Faction,
  CharacterDef,
} from './types';
import { NAV_DECK_FULL, NAV_DECK_QUICK, RITUAL_DECK, START_GUNS, GUN_SUPPLY, offDutyCount } from './data/gamedata';
import { CHARACTERS, SUGGESTED_EXCLUDE_5_6 } from './data/characters';
import { getLongMap, getMap } from './data/maps';
import { Rng } from './rng';

export const SAVE_VERSION = 3;

export function createGameState(
  seats: { seatId: number; name: string }[],
  config: RoomConfig,
  rng: Rng,
): GameState {
  const n = seats.length;
  if (n < 5 || n > 11) throw new Error('人数必须为 5-11 人');
  // 官方规则：5-7 人用短航程，8 人及以上用长航程
  const mapId = config.mapId === 'auto' ? (n <= 7 ? 'quick' : 'long') : config.mapId;
  const map = getMap(mapId);

  // ===== 1. 阵营分配 =====
  const factions = assignFactions(n, rng);

  // ===== 2. 角色牌 =====
  const characterPool = buildCharacterPool(config, rng); // 21张非船长，已洗混
  const dealt = characterPool.slice(0, n - 1); // 发出的 n-1 张
  const leftover = characterPool.slice(n - 1); // 剩余 22-n 张（船长补抽来源）
  dealt.push(CHARACTERS.find((c) => c.id === 'chr_captain')!);
  rng.shuffle(dealt);

  // 找到船长牌持有者
  const captainIdx = dealt.findIndex((c) => c.id === 'chr_captain');
  if (captainIdx < 0) throw new Error('内部错误：船长牌未发出');
  const captainSeat = seats[captainIdx].seatId;
  // 船长弃掉船长牌，从剩余牌中随机抽一张
  dealt[captainIdx] = leftover.splice(rng.int(leftover.length), 1)[0];

  const players: PlayerState[] = seats.map((s, i) => ({
    seatId: s.seatId,
    name: s.name,
    faction: factions[i],
    characterId: dealt[i].id,
    characterRevealed: false,
    guns: START_GUNS,
    resumeCount: 0,
    resumes: [],
    offDuty: false,
    noTongue: false,
    eliminated: false,
    eliminationReason: null,
    cabinSearched: false,
    flogged: false,
    notFactions: [],
  }));

  // ===== 3. 牌堆 =====
  const navDeck = (mapId === 'quick' ? NAV_DECK_QUICK.map((c) => c.id) : NAV_DECK_FULL.map((c) => c.id)).slice();
  rng.shuffle(navDeck);
  const ritualOrder = RITUAL_DECK.slice();
  rng.shuffle(ritualOrder);

  const state: GameState = {
    version: SAVE_VERSION,
    eventSeq: 0,
    mapId: map.id,
    map,
    shipHex: map.startHexId,
    prevShipHex: map.startHexId,
    config,
    players,
    playerCount: n,
    seatCount: n,
    round: 1,
    captain: captainSeat,
    lieutenant: -1,
    navigator: -1,
    navDeck,
    navDiscard: [],
    recentDiscards: [],
    cultRitual: { deckOrder: ritualOrder, revealedCount: 0, pendingRitual: null },
    stage: 'roundStart',
    pending: [],
    activation: null,
    mutiny: freshMutiny(0),
    navigation: {
      stage: 'none',
      emergency: false,
      captainCards: [],
      lieutenantCards: [],
      smugglerSeat: null,
      logbook: [],
    },
    pendingMapAction: null,
    playedCardThisRound: null,
    yellowPlayedThisRound: false,
    crossedSupplyLine: false,
    gunSupply: GUN_SUPPLY - n * START_GUNS,
    offDutyCount: offDutyCount(n),
    gunsmithActive: [],
    nextMutinyModifiers: { excludedSeats: [], forcedMinBySeat: {}, equalizer: false },
    result: null,
    seededRngState: (rng as unknown as { exportState(): number[] }).exportState(),
    log: [],
  };

  // 海盗互识在各自视图中体现（投影层处理），这里记录公共日志
  pushLog(state, `游戏开始：${n} 名船员启航。`);
  pushLog(state, '—— 第 1 轮 ——');
  pushLog(state, '船长在酝酿任命航海组……（各角色可在任命前启动）');
  // 打开第一轮「任命前」窗口
  state.activation = { windowKind: 'beforeAppointment', passedSeats: [], options: [] };
  return state;
}

function assignFactions(n: number, rng: Rng): Faction[] {
  const factions: Faction[] = [];
  for (let i = 0; i < n; i++) factions.push('sailor');
  // 官方人数配置表
  const table: Record<number, { s: number; p: number; cl: number; cu: number }> = {
    5: { s: 3, p: 1, cl: 1, cu: 0 }, // 5人局特殊：3/1 或 2/2
    6: { s: 3, p: 2, cl: 1, cu: 0 },
    7: { s: 4, p: 2, cl: 1, cu: 0 },
    8: { s: 4, p: 3, cl: 1, cu: 0 },
    9: { s: 5, p: 3, cl: 1, cu: 0 },
    10: { s: 5, p: 4, cl: 1, cu: 0 },
    11: { s: 5, p: 4, cl: 1, cu: 1 },
  };
  let comp = table[n];
  if (n === 5) {
    // 5个袋子（3水手+2海盗）随机移除1个：3/5 概率 3S1P，2/5 概率 2S2P
    comp = rng.int(5) < 3 ? { s: 3, p: 1, cl: 1, cu: 0 } : { s: 2, p: 2, cl: 1, cu: 0 };
  }
  const arr: Faction[] = [];
  for (let i = 0; i < comp.s; i++) arr.push('sailor');
  for (let i = 0; i < comp.p; i++) arr.push('pirate');
  for (let i = 0; i < comp.cl; i++) arr.push('cultLeader');
  for (let i = 0; i < comp.cu; i++) arr.push('cultist');
  return rng.shuffle(arr);
}

function buildCharacterPool(config: RoomConfig, rng: Rng): CharacterDef[] {
  let pool = CHARACTERS.filter((c) => c.id !== 'chr_captain');
  if (config.excludeSuggestedCharacters) {
    pool = pool.filter((c) => !SUGGESTED_EXCLUDE_5_6.includes(c.id));
  }
  const deck = pool.slice();
  rng.shuffle(deck);
  return deck; // 21张非船长，洗混
}

export function freshMutiny(threshold: number): GameState['mutiny'] {
  return {
    stage: 'none',
    submissions: {},
    submittedOrder: [],
    threshold,
    revealedTotal: 0,
    troublemakerTarget: null,
    peacemakerTarget: null,
    instigatorTarget: null,
    instigatorAnswerPending: false,
    equalizerActive: false,
    rabbleRouserActive: false,
    forcedMin: 0,
    forcedMinBySeat: {},
    excludedFromMutiny: [],
    maxRevealPerPlayer: null,
    succeeded: null,
    tieChain: [],
    tiePicker: null,
  };
}

export function pushLog(state: GameState, textZh: string, visibility: 'public' | number = 'public') {
  state.eventSeq += 1;
  state.log.push({ id: state.eventSeq, ts: Date.now(), textZh, visibility });
  if (state.log.length > 600) state.log.splice(0, state.log.length - 600);
}

export function seatOf(state: GameState, seatId: number): PlayerState {
  const p = state.players.find((p) => p.seatId === seatId);
  if (!p) throw new Error(`座位不存在: ${seatId}`);
  return p;
}

export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.eliminated);
}

export function clockwiseFrom(state: GameState, seatId: number): PlayerState[] {
  const idx = state.players.findIndex((p) => p.seatId === seatId);
  const out: PlayerState[] = [];
  for (let i = 1; i <= state.players.length; i++) {
    out.push(state.players[(idx + i) % state.players.length]);
  }
  return out;
}
