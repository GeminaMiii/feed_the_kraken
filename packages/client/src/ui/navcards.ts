// 导航牌展示工具（从盘面组件中抽出，供行动面板与各盘面皮肤共用）

import { DIRECTION_ZH, NAV_CARD_MAP, getLongMap, getQuickMap } from '@ftk/engine';
import type { PlayerView } from '@ftk/engine';

const ACTION_ZH: Record<string, string> = {
  cabinSearch: '舱搜',
  feedTheKraken: '献祭',
  flogging: '鞭刑',
  offWithTongue: '割舌',
};

// 某张导航牌从当前位置打出去会到哪里
export function destinationText(view: PlayerView, cardId: string): string {
  const map = view.mapId === 'quick' ? getQuickMap() : getLongMap();
  const card = NAV_CARD_MAP[cardId];
  if (!card) return '';
  const hex = map.hexes[view.shipHex];
  if (!hex) return '';
  const dest = hex.exits[card.direction];
  const dirZh = DIRECTION_ZH[card.direction];
  if (dest.startsWith('victory_')) {
    const zh: Record<string, string> = {
      victory_pirate: '绯红湾（海盗胜利！）',
      victory_sailor: '蓝湾（水手胜利！）',
      victory_cult: '海妖之域（邪教胜利！）',
    };
    return `向${dirZh} → ${zh[dest]}`;
  }
  const dh = map.hexes[dest];
  const act = dh?.action ? ACTION_ZH[dh.action] ?? '' : '';
  return `向${dirZh} → 新海域${act ? `（${act}格）` : ''}`;
}
