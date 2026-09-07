import type { Command, PlayerView, ViewPending } from '@ftk/engine';

// With two cards the UI selects what to keep; the engine always takes a discard ID.
// Smuggler hands discard one card at a time, retaining all other cards.
export function cardChoice(cards: string[], selected: string | null, navigator: boolean) {
  if (!selected || !cards.includes(selected) || cards.length < 2) return null;
  const discarded = cards.length === 2 ? cards.find((id) => id !== selected)! : selected;
  const kept = cards.filter((id) => id !== discarded);
  const command: Command = navigator
    ? { type: 'navigatorAction', action: 'discard', cardId: discarded }
    : { type: 'chooseCard', cardId: discarded };
  return { discarded, kept, command };
}

export function gunBounds(view: PlayerView, pending: ViewPending) {
  const guns = Math.max(0, view.you.guns);
  const max = Math.max(0, Math.min(guns, typeof pending.data.yourMax === 'number' ? pending.data.yourMax : guns));
  const min = Math.max(0, Math.min(max, typeof pending.data.yourMin === 'number' ? pending.data.yourMin : 0));
  return { min, max };
}

export function appointmentCandidates(view: PlayerView, role: 'lieutenant' | 'navigator') {
  const other = role === 'navigator' ? view.lieutenant : view.navigator;
  const eligible = view.players.filter((p) => !p.eliminated && p.seatId !== view.captain && p.seatId !== other);
  const onDuty = eligible.filter((p) => !p.offDuty);
  return onDuty.length ? onDuty : eligible;
}

export function convertibleCandidates(view: PlayerView) {
  return view.players.filter((p) => !p.eliminated && !p.unconvertible
    && p.seatId !== view.you.seatId && !view.you.teammates.includes(p.seatId)
    && p.faction !== 'cultLeader' && p.faction !== 'cultist').map((p) => p.seatId);
}
