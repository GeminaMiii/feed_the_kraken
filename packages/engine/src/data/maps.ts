// 地图数据（重建版）
//
// ⚠️ 数据来源与核验状态（详见 local_docs/2026-09-06_盘面美工与热插拔.md）：
// - 长航程（31格）：格子 id 沿用棋盘编号 h1..h31（与引擎测试 effects.test.ts 中的
//   shipHex 坐标一致）；拓扑与出口表转录自社区逆向数据 docs/rules-sources/community_mapLong.js
//   （EXIT_TABLE 为其数字实现的预计算出口，已含自洽性校验），行动格分布与官方照片核对一致。
// - 快航程（22格）：id 采用 h{row}_{col}；依据官方正视图照片（pics/short.jpeg）逐格转录重建，
//   含几何邻接与箭头方向推断；个别边缘格的出口存在少量主观判断。
// 两者均标记 dataStatus: 'unverified'，建议与实体板逐格复核。
//
// 坐标约定：row 越大越靠北（1 = 南端起点），col 为水平列（渲染时不交错）。
// 出口方向：north=黄牌 / west=红牌 / east=蓝牌；目标为格子 id 或 victory_* 终点。

import type { GameMap, MapActionKind, MapHex } from '../types';

type HexInit = {
  row: number;
  col: number;
  north: string;
  west: string;
  east: string;
  action?: MapActionKind;
  supply?: boolean;
};

function buildMap(init: Record<string, HexInit>): Record<string, MapHex> {
  const hexes: Record<string, MapHex> = {};
  for (const [id, h] of Object.entries(init)) {
    hexes[id] = {
      id,
      row: h.row,
      col: h.col,
      exits: { north: h.north, west: h.west, east: h.east },
      ...(h.action ? { action: h.action } : {}),
      ...(h.supply ? { supply: true } : {}),
    };
  }
  return hexes;
}

// ============ 长航程（8-11人，31格 + 3胜利终点） ============
// 来源：community_mapLong.js NODES/EXIT_TABLE（num=h1..h31）。
// 行动格：4舱搜(h5-h8) 2鞭刑(h16,h17) 1割舌(h13) 3献祭(h23,h24,h27)；补给线以北(row>=4)为供应区。
const LONG_INIT: Record<string, HexInit> = {
  // r1（南端）
  'h1': { row: 1, col: 0, north: 'h4', west: 'h2', east: 'h3' },
  'h2': { row: 1, col: -1, north: 'h5', west: 'h5', east: 'h4' },
  'h3': { row: 1, col: 1, north: 'h6', west: 'h4', east: 'h6' },
  // r2
  'h4': { row: 2, col: 0, north: 'h8', west: 'h5', east: 'h6' },
  'h5': { row: 2, col: -1, north: 'h10', west: 'h7', east: 'h8', action: 'cabinSearch' },
  'h6': { row: 2, col: 1, north: 'h11', west: 'h8', east: 'h9', action: 'cabinSearch' },
  // r3
  'h7': { row: 3, col: -2, north: 'h12', west: 'h12', east: 'h10', action: 'cabinSearch' },
  'h8': { row: 3, col: 0, north: 'h10', west: 'h10', east: 'h11', action: 'cabinSearch' },
  'h9': { row: 3, col: 2, north: 'h14', west: 'h11', east: 'h14' },
  'h10': { row: 3, col: -1, north: 'h16', west: 'h12', east: 'h13' },
  'h11': { row: 3, col: 1, north: 'h17', west: 'h13', east: 'h14' },
  // r4（补给线以北）
  'h12': { row: 4, col: -2, north: 'h19', west: 'h15', east: 'h16', supply: true },
  'h13': { row: 4, col: 0, north: 'h20', west: 'h16', east: 'h17', action: 'offWithTongue', supply: true },
  'h14': { row: 4, col: 2, north: 'h21', west: 'h17', east: 'h18', supply: true },
  'h15': { row: 4, col: -3, north: 'h19', west: 'h22', east: 'h19', supply: true },
  'h16': { row: 4, col: -1, north: 'h23', west: 'h19', east: 'h20', action: 'flogging', supply: true },
  'h17': { row: 4, col: 1, north: 'h24', west: 'h20', east: 'h21', action: 'flogging', supply: true },
  'h18': { row: 4, col: 3, north: 'h21', west: 'h21', east: 'h25', supply: true },
  // r5
  'h19': { row: 5, col: -2, north: 'h23', west: 'h26', east: 'h23', supply: true },
  'h20': { row: 5, col: 0, north: 'h27', west: 'h23', east: 'h24', supply: true },
  'h21': { row: 5, col: 2, north: 'h24', west: 'h24', east: 'h28', supply: true },
  'h22': { row: 5, col: -3, north: 'victory_pirate', west: 'victory_pirate', east: 'h26', supply: true },
  'h23': { row: 5, col: -1, north: 'h29', west: 'h26', east: 'h27', action: 'feedTheKraken', supply: true },
  'h24': { row: 5, col: 1, north: 'h30', west: 'h27', east: 'h28', action: 'feedTheKraken', supply: true },
  'h25': { row: 5, col: 3, north: 'victory_sailor', west: 'h28', east: 'victory_sailor', supply: true },
  // r6
  'h26': { row: 6, col: -2, north: 'victory_pirate', west: 'victory_pirate', east: 'h29', supply: true },
  'h27': { row: 6, col: 0, north: 'h31', west: 'h29', east: 'h30', action: 'feedTheKraken', supply: true },
  'h28': { row: 6, col: 2, north: 'victory_sailor', west: 'h30', east: 'victory_sailor', supply: true },
  'h29': { row: 6, col: -1, north: 'victory_pirate', west: 'victory_pirate', east: 'h31', supply: true },
  'h30': { row: 6, col: 1, north: 'victory_sailor', west: 'h31', east: 'victory_sailor', supply: true },
  // r7（北端海妖）
  'h31': { row: 7, col: 0, north: 'victory_cult', west: 'victory_cult', east: 'victory_cult', supply: true },
};

// ============ 快航程（5-7人，22格 + 3胜利终点，无补给线） ============
// 来源：pics/short.jpeg 逐格转录；行动格 3舱搜 2献祭；起点在南。
const QUICK_INIT: Record<string, HexInit> = {
  // r1（南端起点港）
  'h1_0': { row: 1, col: 0, north: 'h3_0', west: 'h2_-1', east: 'h2_1' },
  // r2
  'h2_-1': { row: 2, col: -1, north: 'h3_-2', west: 'h3_-2', east: 'h3_0' },
  'h2_1': { row: 2, col: 1, north: 'h4_1', west: 'h3_0', east: 'h3_2' },
  // r3
  'h3_-2': { row: 3, col: -2, north: 'h5_-2', west: 'victory_pirate', east: 'h4_-1' },
  'h3_0': { row: 3, col: 0, north: 'h5_0', west: 'h4_-1', east: 'h4_1' },
  'h3_2': { row: 3, col: 2, north: 'h4_1', west: 'h4_1', east: 'victory_sailor' },
  // r4
  'h4_-1': { row: 4, col: -1, north: 'h6_-1', west: 'h5_-2', east: 'h5_0', action: 'cabinSearch' },
  'h4_1': { row: 4, col: 1, north: 'h6_1', west: 'h5_0', east: 'h5_2', action: 'cabinSearch' },
  // r5
  'h5_-2': { row: 5, col: -2, north: 'h7_-2', west: 'h6_-3', east: 'h6_-1', action: 'cabinSearch' },
  'h5_0': { row: 5, col: 0, north: 'h7_0', west: 'h6_-1', east: 'h6_1' },
  'h5_2': { row: 5, col: 2, north: 'h7_2', west: 'h6_1', east: 'victory_sailor' },
  // r6
  'h6_-3': { row: 6, col: -3, north: 'victory_pirate', west: 'victory_pirate', east: 'h7_-2' },
  'h6_-1': { row: 6, col: -1, north: 'h8_-1', west: 'h7_-2', east: 'h7_0' },
  'h6_1': { row: 6, col: 1, north: 'h8_1', west: 'h7_0', east: 'h7_2' },
  // r7
  'h7_-2': { row: 7, col: -2, north: 'victory_pirate', west: 'victory_pirate', east: 'h8_-1' },
  'h7_0': { row: 7, col: 0, north: 'victory_cult', west: 'h8_-1', east: 'h8_1' },
  'h7_2': { row: 7, col: 2, north: 'victory_sailor', west: 'h8_1', east: 'victory_sailor' },
  // r8（献祭海妖）
  'h8_-1': { row: 8, col: -1, north: 'h9_-1', west: 'victory_pirate', east: 'h9_0', action: 'feedTheKraken' },
  'h8_1': { row: 8, col: 1, north: 'h9_1', west: 'h9_0', east: 'victory_sailor', action: 'feedTheKraken' },
  // r9（北端）
  'h9_-1': { row: 9, col: -1, north: 'victory_pirate', west: 'victory_pirate', east: 'h9_0' },
  'h9_0': { row: 9, col: 0, north: 'victory_cult', west: 'h9_-1', east: 'h9_1' },
  'h9_1': { row: 9, col: 1, north: 'victory_cult', west: 'h9_0', east: 'victory_sailor' },
};

const LONG_MAP: GameMap = {
  id: 'long',
  nameZh: '长航程',
  hexes: buildMap(LONG_INIT),
  startHexId: 'h1',
  dataStatus: 'unverified',
};

const QUICK_MAP: GameMap = {
  id: 'quick',
  nameZh: '快航程',
  hexes: buildMap(QUICK_INIT),
  startHexId: 'h1_0',
  dataStatus: 'unverified',
};

export function getLongMap(): GameMap {
  return LONG_MAP;
}

export function getQuickMap(): GameMap {
  return QUICK_MAP;
}

export function getMap(mapId: 'quick' | 'long'): GameMap {
  return mapId === 'quick' ? QUICK_MAP : LONG_MAP;
}
