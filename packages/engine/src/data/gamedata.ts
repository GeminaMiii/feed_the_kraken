// 导航牌 / 仪式牌 / 全局数值（重建版）
// 来源：docs/RULES_NOTES.md §3/§5 + docs/rules-sources/rulebook_en.txt（牌堆构成）+ community_cards.md。
// 牌堆构成（规则书 P4/P6）：
//   长航程 23 张 = 黄·邪教暴动6 + 蓝·醉酒4 + 蓝·缴械2 + 红·醉酒5 + 红·美人鱼2 + 红·望远镜2 + 红·武装2
//   快航程 19 张 = 长航程移除 黄·邪教暴动1、蓝·醉酒1、红·武装2
// 仪式牌 5 张 = 皈依邪教×3 + 邪教军火库×1 + 邪教舱搜×1（id 约定与 engine.executeRitual 匹配）

import type { Direction, NavCardDef, NavCardType } from '../types';

export const NAV_TYPE_ZH: Record<NavCardType, string> = {
  cultUprising: '邪教暴动',
  drunk: '醉酒',
  disarmed: '缴械',
  mermaid: '美人鱼',
  telescope: '望远镜',
  armed: '武装',
};

export const DIRECTION_ZH: Record<Direction, string> = {
  north: '北',
  east: '东',
  west: '西',
};

function card(id: string, type: NavCardType, direction: Direction): NavCardDef {
  return { id, type, direction };
}

const NAV_DECK: NavCardDef[] = [
  // 黄（北）·邪教暴动 ×6
  card('nav_cultUprising_north_1', 'cultUprising', 'north'),
  card('nav_cultUprising_north_2', 'cultUprising', 'north'),
  card('nav_cultUprising_north_3', 'cultUprising', 'north'),
  card('nav_cultUprising_north_4', 'cultUprising', 'north'),
  card('nav_cultUprising_north_5', 'cultUprising', 'north'),
  card('nav_cultUprising_north_6', 'cultUprising', 'north'),
  // 蓝（东）·醉酒 ×4
  card('nav_drunk_east_1', 'drunk', 'east'),
  card('nav_drunk_east_2', 'drunk', 'east'),
  card('nav_drunk_east_3', 'drunk', 'east'),
  card('nav_drunk_east_4', 'drunk', 'east'),
  // 蓝（东）·缴械 ×2
  card('nav_disarmed_east_1', 'disarmed', 'east'),
  card('nav_disarmed_east_2', 'disarmed', 'east'),
  // 红（西）·醉酒 ×5
  card('nav_drunk_west_1', 'drunk', 'west'),
  card('nav_drunk_west_2', 'drunk', 'west'),
  card('nav_drunk_west_3', 'drunk', 'west'),
  card('nav_drunk_west_4', 'drunk', 'west'),
  card('nav_drunk_west_5', 'drunk', 'west'),
  // 红（西）·美人鱼 ×2
  card('nav_mermaid_west_1', 'mermaid', 'west'),
  card('nav_mermaid_west_2', 'mermaid', 'west'),
  // 红（西）·望远镜 ×2
  card('nav_telescope_west_1', 'telescope', 'west'),
  card('nav_telescope_west_2', 'telescope', 'west'),
  // 红（西）·武装 ×2（仅长航程）
  card('nav_armed_west_1', 'armed', 'west'),
  card('nav_armed_west_2', 'armed', 'west'),
];

// 快航程：移除 1×黄暴动、1×蓝醉酒、2×红武装
const QUICK_EXCLUDE = new Set([
  'nav_cultUprising_north_6',
  'nav_drunk_east_4',
  'nav_armed_west_1',
  'nav_armed_west_2',
]);

export const NAV_DECK_FULL: NavCardDef[] = NAV_DECK;
export const NAV_DECK_QUICK: NavCardDef[] = NAV_DECK.filter((c) => !QUICK_EXCLUDE.has(c.id));

export const NAV_CARD_MAP: Record<string, NavCardDef> = Object.fromEntries(
  NAV_DECK.map((c) => [c.id, c]),
);

// 邪教仪式牌（洗混背面放置，揭示顺序执行）
export const RITUAL_DECK: string[] = [
  'ritual_conversion_1',
  'ritual_conversion_2',
  'ritual_conversion_3',
  'ritual_guns_stash',
  'ritual_cult_cabin_search',
];

export const START_GUNS = 3; // 每人开局枪数
export const GUN_SUPPLY = 40; // 供应区总枪数

export const MIN_PLAYERS = 5; // 开局最少人数
export const MAX_PLAYERS = 11; // 开局最多人数

// 停职牌数量：5-6人1张、7-8人2张、9-11人3张
export function offDutyCount(playerCount: number): number {
  if (playerCount <= 6) return 1;
  if (playerCount <= 8) return 2;
  return 3;
}

// 哗变成功所需枪数（The Crew 卡）：5-7人≥3、8-9人≥4、10-11人≥5
export function mutinyThreshold(playerCount: number): number {
  if (playerCount <= 7) return 3;
  if (playerCount <= 9) return 4;
  return 5;
}
