import { GameState, Command, PendingChoice } from '../types';
import { applyCommand, advance } from '../engine';
import { createGameState } from '../state';
import { SeededRng } from '../rng';
import { RoomConfig } from '../types';

export function makeState(n: number, seed = 42, config?: Partial<RoomConfig>): GameState {
  const seats = Array.from({ length: n }, (_, i) => ({ seatId: i, name: `P${i + 1}` }));
  const cfg: RoomConfig = {
    playerCount: n,
    mapId: 'long', // 测试默认长航程（坐标 h*）；快航程另有专项测试
    excludeSuggestedCharacters: false,
    roomPassword: '',
    ...config,
  };
  const rng = new SeededRng(seed);
  return createGameState(seats, cfg, rng);
}

export function topPending(state: GameState): PendingChoice | undefined {
  return state.pending[state.pending.length - 1];
}

export function findPending(state: GameState, kind: string): PendingChoice | undefined {
  return state.pending.find((p) => p.kind === kind);
}

export function cmd(state: GameState, seat: number, command: Command) {
  applyCommand(state, seat, command);
}

/** 所有存活玩家在当前窗口通过 */
export function passWindow(state: GameState) {
  if (!state.activation) return;
  const seats = state.players.filter((p) => !p.eliminated).map((p) => p.seatId);
  for (const s of seats) {
    if (state.activation && !state.activation.passedSeats.includes(s)) {
      applyCommand(state, s, { type: 'pass' });
    }
    if (!state.activation) break;
  }
}

/** 启动角色并处理其后续 pending，然后通过窗口 */
export function activate(state: GameState, seat: number, characterId: string, followUp?: (state: GameState) => void) {
  applyCommand(state, seat, { type: 'activateCharacter', characterId });
  if (followUp) followUp(state);
  // 处理激活者自身的后续 pending 链
  guardAdvance(state);
}

export function guardAdvance(state: GameState) {
  const rng = new SeededRng(0);
  advance(state, rng);
}

export function expectPending(state: GameState, kind: string, actor?: number) {
  const p = topPending(state);
  if (!p) throw new Error(`期望 pending ${kind}，实际无 pending (stage=${state.stage})`);
  if (p.kind !== kind) throw new Error(`期望 pending ${kind}，实际 ${p.kind}`);
  if (actor !== undefined && p.actorSeat !== actor)
    throw new Error(`期望 actor ${actor}，实际 ${p.actorSeat}`);
  return p;
}

/** 走完忠诚质询：所有有资格者交 0 枪（或指定数量） */
export function submitAll(state: GameState, countFor: (seat: number) => number = () => 0) {
  let guard = 0;
  while (topPending(state)?.kind === 'mutinySubmit' && guard++ < 20) {
    const p = topPending(state)!;
    applyCommand(state, p.actorSeat, { type: 'submitGuns', count: countFor(p.actorSeat) });
  }
}

/** 打开窗口并让除 keepSeats 外的所有玩家通过（窗口保持开放供 keepSeats 行动） */
export function openWindowKeep(
  state: GameState,
  kind: 'beforeAppointment' | 'afterAppointment' | 'afterReveal' | 'beforeDraw' | 'yellowRound',
  keep: number[],
) {
  state.activation = { windowKind: kind, passedSeats: [], options: [] };
  state.pending = state.pending.filter((p) => p.kind === 'activationWindow');
  for (const p of state.players) {
    if (!p.eliminated && !keep.includes(p.seatId)) {
      if (state.activation && !state.activation.passedSeats.includes(p.seatId)) {
        applyCommand(state, p.seatId, { type: 'pass' });
      }
    }
  }
}

/** 让当前激活窗口内所有玩家通过（要求无未决 pending） */
export function closeWindow(state: GameState) {
  if (!state.activation) return; // 窗口已自动关闭（激活者被自动通过），状态机已推进
  const tp = topPending(state);
  if (tp && tp.kind !== 'activationWindow') {
    throw new Error(`closeWindow 前存在未决 pending: ${tp.kind}`);
  }
  passWindow(state);
}
