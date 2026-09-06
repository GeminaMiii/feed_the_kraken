// 盘面皮肤注册表（热插拔机制）
//
// 新增皮肤三步：
//   1. 在 boards/ 下新建组件，props 实现 BoardProps 契约（{ view, map }），默认导出；
//   2. 在 BOARD_SKINS 数组注册一条 { id, nameZh, Component }（React.lazy 自动代码分割）；
//   3. 无需改动其他任何代码——对局界面右上角下拉即可切换，选择存 localStorage。

import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { BoardProps } from './types';

export interface BoardSkin {
  id: string;
  nameZh: string;
  Component: LazyExoticComponent<ComponentType<BoardProps>>;
}

export const BOARD_SKINS: BoardSkin[] = [
  { id: 'classic', nameZh: '经典海图', Component: lazy(() => import('./ClassicBoard')) },
  { id: 'official', nameZh: '官方航海图', Component: lazy(() => import('./OfficialBoard')) },
];

export const DEFAULT_SKIN_ID = 'classic';
export const SKIN_STORAGE_KEY = 'ftk.boardSkin';

export function getSkin(id: string | null | undefined): BoardSkin {
  return BOARD_SKINS.find((s) => s.id === id) ?? BOARD_SKINS[0];
}
