import React from 'react';
import { getLongMap, getQuickMap, NAV_CARD_MAP, DIRECTION_ZH } from '@ftk/engine';
import type { PlayerView, GameMap } from '@ftk/engine';

// 地图渲染：基于引擎地图数据程序化绘制（原创程序化素材，不使用原版扫描件）
const ACTION_ICON: Record<string, string> = {
  cabinSearch: '🔍',
  feedTheKraken: '🐙',
  flogging: '🪢',
  offWithTongue: '🗡️',
};

// 交错六边形几何：相邻行（整数行↔交错行）垂直间距 = 0.75*六边形高度
// 格子尺寸按地图列数自适应：列少的地图（短航程）格子更大，铺满容器
function buildLayout(map: GameMap) {
  const hexes = Object.values(map.hexes);
  const rows = [...new Set(hexes.map((h) => h.row))].sort((a, b) => a - b);
  const cols = [...new Set(hexes.map((h) => h.col))].sort((a, b) => a - b);
  const minRow = rows[0];
  const maxRow = rows[rows.length - 1];
  const minCol = cols[0];
  const maxCol = cols[cols.length - 1];
  const colSpan = maxCol - minCol + 1;
  const COL_W = Math.min(150, Math.max(88, 880 / colSpan)); // 同行相邻列间距
  const RW = COL_W * 0.48;   // 六边形半宽
  const RH = COL_W * 0.55;   // 六边形半高
  const ROW_H = RH * 1.5;    // 半行间距（交错咬合）
  const width = (maxCol - minCol) * COL_W + COL_W * 0.9;
  const height = (maxRow - minRow) * ROW_H + RH * 2.6;
  const pos = (row: number, col: number) => ({
    cx: (col - minCol) * COL_W + COL_W * 0.75,
    cy: (maxRow - row) * ROW_H + RH * 1.4,
  });
  return { pos, width, height, RW, RH };
}

function hexPoints(cx: number, cy: number, rw: number, rh: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + rw * Math.cos(a)).toFixed(1)},${(cy + rh * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

// 方向箭头：从格心指向出口方向的小三角（颜色=导航牌颜色）
function Arrow({ cx, cy, dir, color, victory, rw, rh }: { cx: number; cy: number; dir: 'north' | 'west' | 'east'; color: string; victory?: boolean; rw: number; rh: number }) {
  const dx = dir === 'west' ? -rw + 12 : dir === 'east' ? rw - 12 : 0;
  const dy = dir === 'north' ? -rh + 13 : -rh / 2 + 4;
  const rot = dir === 'north' ? 0 : dir === 'west' ? -55 : 55;
  const size = Math.max(7, rw * 0.18);
  return (
    <g transform={`translate(${cx + dx},${cy + dy}) rotate(${rot})`}>
      <polygon points={`0,${-size} ${size * 0.9},${size * 0.8} ${-size * 0.9},${size * 0.8}`} fill={color} stroke="#fff" strokeWidth={victory ? 2 : 1.4} opacity={victory ? 1 : 0.85} />
      {victory && <text x={0} y={-size - 4} textAnchor="middle" fontSize={size * 1.05} fill={color} stroke="#0d2b3e" strokeWidth={0.6}>胜</text>}
    </g>
  );
}

export const HexMap: React.FC<{ view: PlayerView }> = ({ view }) => {
  const map = view.mapId === 'quick' ? getQuickMap() : getLongMap();
  const { pos, width, height, RW, RH } = buildLayout(map);
  const rw = RW * 0.9;
  const rh = RH * 0.9;
  const moved = view.prevShipHex !== view.shipHex;
  const fromHex = map.hexes[view.prevShipHex];
  const from = moved && fromHex ? pos(fromHex.row, fromHex.col) : null;
  const toHex = map.hexes[view.shipHex];
  const to = pos(toHex.row, toHex.col);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="hexmap"
      style={{ maxWidth: width * 1.35, maxHeight: '66vh', aspectRatio: `${width} / ${height}` }}
      role="img"
      aria-label="航海地图"
    >
      <rect x={0} y={0} width={width} height={height} fill="#0d2b3e" rx={10} />
      <text x={8} y={16} fill="#e05555" fontSize={12}>↖ 绯红湾（海盗）</text>
      <text x={width - 118} y={16} fill="#4db8ff" fontSize={12}>蓝湾（水手）↗</text>
      <text x={width / 2 - 56} y={14} fill="#ffd34d" fontSize={12}>▲ 海妖之域（邪教）</text>
      {Object.values(map.hexes).map((h) => {
        const { cx, cy } = pos(h.row, h.col);
        const isShip = view.shipHex === h.id;
        const isPrev = moved && view.prevShipHex === h.id;
        const fill = h.supply ? '#3f6f8f' : h.row % 1 === 0 ? '#1e4a63' : '#1d4560';
        return (
          <g key={h.id}>
            <polygon
              points={hexPoints(cx, cy, rw, rh)}
              fill={fill}
              stroke={isShip ? '#ffd34d' : isPrev ? '#8fd3ff' : '#4a7d99'}
              strokeWidth={isShip ? 3 : isPrev ? 2 : 1.2}
            />
            {h.action && (
              <text x={cx} y={cy + rh * 0.16} textAnchor="middle" fontSize={rw * 0.44}>
                {ACTION_ICON[h.action] ?? '?'}
              </text>
            )}
            {h.id === map.startHexId && !h.action && (
              <text x={cx} y={cy + 5} textAnchor="middle" fontSize={12} fill="#9fc3d6">起点</text>
            )}
            {(['north', 'west', 'east'] as const).map((dir) => {
              const e = h.exits[dir];
              const color = dir === 'north' ? '#ffd34d' : dir === 'west' ? '#e05555' : '#4db8ff';
              const isVictory = e.startsWith('victory_');
              return <Arrow key={dir} cx={cx} cy={cy} dir={dir} color={color} victory={isVictory} rw={rw} rh={rh} />;
            })}
          </g>
        );
      })}
      {moved && from && (
        <line x1={from.cx} y1={from.cy} x2={to.cx} y2={to.cy} stroke="#ffd34d" strokeWidth={3.5} strokeDasharray="7 5" opacity={0.9} />
      )}
      <text x={to.cx} y={to.cy + 7} textAnchor="middle" fontSize={22}>⛵</text>
      <text x={8} y={height - 8} fill="#5f8fa8" fontSize={11}>
        🔍舱搜 🐙献祭 🪢鞭刑 🗡️割舌 · 箭头颜色=导航牌颜色（黄北/红西/蓝东）· 金色虚线为上次航行 · 「胜」=驶入胜利区
      </text>
    </svg>
  );
};

// 给行动面板用：某张导航牌从当前位置打出去会到哪里
export function destinationText(view: PlayerView, cardId: string): string {
  const map = view.mapId === 'quick' ? getQuickMap() : getLongMap();
  const card = NAV_CARD_MAP[cardId];
  if (!card) return '';
  const hex = map.hexes[view.shipHex];
  const dest = hex.exits[card.direction];
  const dirZh = DIRECTION_ZH[card.direction];
  if (dest.startsWith('victory_')) {
    const zh: Record<string, string> = { victory_pirate: '绯红湾（海盗胜利！）', victory_sailor: '蓝湾（水手胜利！）', victory_cult: '海妖之域（邪教胜利！）' };
    return `向${dirZh} → ${zh[dest]}`;
  }
  const dh = map.hexes[dest];
  const act = dh.action ? { cabinSearch: '舱搜', feedTheKraken: '献祭', flogging: '鞭刑', offWithTongue: '割舌' }[dh.action] : '';
  return `向${dirZh} → 新海域${act ? `（${act}格）` : ''}`;
}
