// 盘面皮肤统一契约：任何棋盘组件实现 BoardProps 后即可注册进 registry 热插拔。

import type { GameMap, PlayerView } from '@ftk/engine';

export interface BoardProps {
  /** 玩家视图（船位/上次船位等） */
  view: PlayerView;
  /** 地图数据（由 GameView 按 view.mapId 取好传入，盘面自身不再关心数据来源） */
  map: GameMap;
}
