import { NavCardDef } from '../types';

// ============ 导航牌 ============
// 长航程 23 张全用；快航程移除 1 黄暴动、1 蓝醉酒、2 红武装（共19张）。

function buildDeck(): NavCardDef[] {
  const deck: NavCardDef[] = [];
  const add = (type: NavCardDef['type'], direction: NavCardDef['direction'], n: number) => {
    for (let i = 1; i <= n; i++) deck.push({ id: `nav_${type}_${direction}_${i}`, type, direction });
  };
  add('cultUprising', 'north', 6);
  add('drunk', 'east', 4);
  add('disarmed', 'east', 2);
  add('drunk', 'west', 5);
  add('mermaid', 'west', 2);
  add('telescope', 'west', 2);
  add('armed', 'west', 2);
  return deck;
}

export const NAV_DECK_FULL: NavCardDef[] = buildDeck();

export const QUICK_REMOVE = new Set([
  'nav_cultUprising_north_6',
  'nav_drunk_east_1',
  'nav_armed_west_1',
  'nav_armed_west_2',
]);

export const NAV_DECK_QUICK: NavCardDef[] = NAV_DECK_FULL.filter((c) => !QUICK_REMOVE.has(c.id));

export const NAV_CARD_MAP: Record<string, NavCardDef> = Object.fromEntries(
  NAV_DECK_FULL.map((c) => [c.id, c]),
);

export const NAV_TYPE_ZH: Record<string, string> = {
  cultUprising: '邪教暴动',
  drunk: '醉酒',
  disarmed: '缴械',
  mermaid: '美人鱼',
  telescope: '望远镜',
  armed: '武装',
};

export const DIRECTION_ZH: Record<string, string> = {
  north: '北',
  east: '东',
  west: '西',
};

/** 航向在实体导航牌上的固定颜色：北黄、东蓝、西红。 */
export const DIRECTION_COLOR_ZH: Record<string, string> = {
  north: '黄色',
  east: '蓝色',
  west: '红色',
};

/** 导航牌文字效果；界面说明与引擎动作共用同一组类型语义。 */
export const NAV_EFFECT_ZH: Record<NavCardDef['type'], string> = {
  cultUprising: '航海结束时翻开并执行一张邪教仪式牌',
  drunk: '船长职移交给符合条件且履历牌最少的玩家',
  disarmed: '领航员向供应区交出 1 把枪',
  mermaid: '船长选择另一名玩家，令其秘密查看最近 3 张弃牌',
  telescope: '船长选择另一名玩家，令其秘密查看牌堆顶导航牌并决定弃掉或放回',
  armed: '领航员从供应区获得 1 把枪',
};

// ============ 邪教仪式牌 ============

export const RITUAL_DECK = [
  'ritual_conversion_1',
  'ritual_conversion_2',
  'ritual_conversion_3',
  'ritual_guns_stash',
  'ritual_cult_cabin_search',
];

export const RITUAL_ZH: Record<string, string> = {
  ritual_conversion_1: '皈依邪教',
  ritual_conversion_2: '皈依邪教',
  ritual_conversion_3: '皈依邪教',
  ritual_guns_stash: '邪教军火库',
  ritual_cult_cabin_search: '邪教舱室搜查',
};

// ============ The Crew 卡：哗变所需枪数 / 停职数 ============

export function mutinyThreshold(playerCount: number): number {
  if (playerCount <= 7) return 3;
  if (playerCount <= 9) return 4;
  return 5;
}

export function offDutyCount(playerCount: number): number {
  if (playerCount <= 6) return 1;
  if (playerCount <= 8) return 2;
  return 3;
}

// ============ 阵营配置 ============

export function teamComposition(playerCount: number): { sailors: number; pirates: number }[] {
  switch (playerCount) {
    case 5:
      return [
        { sailors: 3, pirates: 1 },
        { sailors: 2, pirates: 2 },
      ];
    case 6:
      return [{ sailors: 3, pirates: 2 }];
    case 7:
      return [{ sailors: 4, pirates: 2 }];
    case 8:
      return [{ sailors: 4, pirates: 3 }];
    case 9:
      return [{ sailors: 5, pirates: 3 }];
    case 10:
      return [{ sailors: 5, pirates: 4 }];
    case 11:
      return [{ sailors: 5, pirates: 4 }];
    default:
      throw new Error(`不支持的人数: ${playerCount}`);
  }
}

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 11;

export const START_GUNS = 3;
export const GUN_SUPPLY = 40; // 基础版 40 把枪
