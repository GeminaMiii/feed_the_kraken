// 角色牌数据（重建版，22张）
// 来源：docs/RULES_NOTES.md §8 角色表（中文名/时机）+ docs/rules-sources/community_cards.md（英文原文）。
// id 前缀 chr_ 与引擎效果分支（engine.ts）一一对应；textZh 仅用于界面展示，引擎不解析。

import type { CharacterDef } from '../types';

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'chr_captain',
    nameZh: '船长',
    nameEn: 'Captain',
    textZh: '开局亮出此牌：你成为第一任船长（持有航海日志为证）。弃掉此牌并另抽一张角色牌。',
    timing: 'anytime',
  },
  {
    id: 'chr_kleptomaniac',
    nameZh: '窃癖者',
    nameEn: 'Kleptomaniac',
    textZh: '选一名玩家，从其补给中偷取1把枪加入自己的补给。',
    timing: 'anytime',
  },
  {
    id: 'chr_troublemaker',
    nameZh: '捣乱者',
    nameEn: 'Troublemaker',
    textZh: '枪揭示后立即发动：选一名玩家，其本次哗变中每把枪按2把计。',
    timing: 'afterReveal',
  },
  {
    id: 'chr_gunsmith',
    nameZh: '军械师',
    nameEn: 'Gunsmith',
    textZh: '弃1把枪亮出此牌。只要此牌保持亮出，每次成功哗变后你可收回本次所用的1把枪。',
    timing: 'gunCost',
  },
  {
    id: 'chr_peacemaker',
    nameZh: '和平使者',
    nameEn: 'Peacemaker',
    textZh: '枪揭示后立即发动：选一名玩家，其揭示的枪全部收回补给，且不计入本次哗变。',
    timing: 'afterReveal',
  },
  {
    id: 'chr_gunslinger',
    nameZh: '枪手',
    nameEn: 'Gunslinger',
    textZh: '从供应区取2把枪加入自己的补给。',
    timing: 'anytime',
  },
  {
    id: 'chr_minstrel',
    nameZh: '吟游诗人',
    nameEn: 'Minstrel',
    textZh: '船长任命航海组后发动：选两名玩家，他们不参与即将到来的哗变。',
    timing: 'afterAppointment',
  },
  {
    id: 'chr_bosun',
    nameZh: '水手长',
    nameEn: 'Bosun',
    textZh: '抽导航牌之前发动：交换现任航海组中副手与领航员的职位。',
    timing: 'beforeDraw',
  },
  {
    id: 'chr_herbalist',
    nameZh: '草药师',
    nameEn: 'Herbalist',
    textZh: '船长任命航海组之前发动：将一张停职牌移给另一名玩家，由其代替停职。',
    timing: 'beforeAppointment',
  },
  {
    id: 'chr_lookout',
    nameZh: '瞭望员',
    nameEn: 'Look-Out',
    textZh: '查看抽牌堆顶的1张导航牌：可将其面朝下弃入深海，或放回牌堆顶。',
    timing: 'anytime',
  },
  {
    id: 'chr_master_strategist',
    nameZh: '大战略家',
    nameEn: 'Master Strategist',
    textZh: '枪揭示后立即发动：若你没有成为新船长，哗变结束后收回你揭示的枪。',
    timing: 'afterReveal',
  },
  {
    id: 'chr_smuggler',
    nameZh: '走私者',
    nameEn: 'Smuggler',
    textZh: '抽导航牌之前发动：选船长或副手，该玩家本次改抽3张导航牌。',
    timing: 'beforeDraw',
  },
  {
    id: 'chr_agitator',
    nameZh: '煽动者',
    nameEn: 'Agitator',
    textZh: '船长任命航海组后发动：选两名玩家（不能选船长），下次哗变他们各须至少揭示1把枪。',
    timing: 'afterAppointment',
  },
  {
    id: 'chr_consultant',
    nameZh: '顾问',
    nameEn: 'Consultant',
    textZh: '船长任命航海组之前发动：由你指定新任副手，船长再任命领航员。',
    timing: 'beforeAppointment',
  },
  {
    id: 'chr_chief_cook',
    nameZh: '主厨',
    nameEn: 'Chief Cook',
    textZh: '船长任命航海组后发动：船长职按顺时针移交给面前简历牌最少的玩家，新船长重新任命航海组。',
    timing: 'afterAppointment',
  },
  {
    id: 'chr_rabble_rouser',
    nameZh: '蛊惑者',
    nameEn: 'Rabble-rouser',
    textZh: '枪揭示后立即发动：本次哗变所需枪数减半（向上取整）。',
    timing: 'afterReveal',
  },
  {
    id: 'chr_archivist',
    nameZh: '档案员',
    nameEn: 'Archivist',
    textZh: '抽导航牌之前发动：选船长或副手，该玩家可弃掉已抽的导航牌重抽2张。',
    timing: 'beforeDraw',
  },
  {
    id: 'chr_mentor',
    nameZh: '导师',
    nameEn: 'Mentor',
    textZh: '选一名玩家：其角色牌翻回背面，该角色因此可以再次启动。',
    timing: 'anytime',
  },
  {
    id: 'chr_spiritualist',
    nameZh: '通灵者',
    nameEn: 'Spiritualist',
    textZh: '在本轮有人打出黄色导航牌的回合发动：选两名玩家，各交1把枪给你指定的一名玩家。',
    timing: 'yellowRound',
  },
  {
    id: 'chr_debt_collector',
    nameZh: '讨债人',
    nameEn: 'Debt Collector',
    textZh: '船长任命航海组后发动：选航海组中一名玩家，其须给航海组内其他成员各1把枪。',
    timing: 'afterAppointment',
  },
  {
    id: 'chr_equalizer',
    nameZh: '平权者',
    nameEn: 'Equalizer',
    textZh: '船长任命航海组后发动：下次哗变只需1把枪即可成功，且每人至多揭示1把枪。',
    timing: 'afterAppointment',
  },
  {
    id: 'chr_instigator',
    nameZh: '教唆者',
    nameEn: 'Instigator',
    textZh: '枪揭示后立即发动：选一名玩家（不能选船长），其可将全部枪加入本次哗变；若不加，哗变后你将其角色牌翻回背面（可再次启动）。',
    timing: 'afterReveal',
  },
];

export const CHARACTER_MAP: Record<string, CharacterDef> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
);

// 官方建议 5-6 人局排除的角色（讨债人/吟游诗人/导师）；房间配置可开启
export const SUGGESTED_EXCLUDE_5_6: string[] = [
  'chr_debt_collector',
  'chr_minstrel',
  'chr_mentor',
];
