import { CharacterDef } from '../types';

// 22 张角色牌（基础版全部组件）。
// 依据：官方 PnP 角色卡（FR/GR/RU/DK，funtails.de 2022-04）+ 社区英文整理逐条核对。
export const CHARACTERS: CharacterDef[] = [
  {
    id: 'chr_captain',
    nameZh: '船长',
    nameEn: 'Captain',
    textZh: '开局亮出此牌：你是第一任船长。拿取船长日志。弃掉此角色牌并另抽一张角色牌。',
    timing: 'anytime',
  },
  {
    id: 'chr_kleptomaniac',
    nameZh: '窃癖者',
    nameEn: 'Kleptomaniac',
    textZh: '选一名玩家：从其个人补给偷取1把枪加入自己的补给。',
    timing: 'anytime',
  },
  {
    id: 'chr_troublemaker',
    nameZh: '捣乱者',
    nameEn: 'Troublemaker',
    textZh: '枪揭示后立即：选一名玩家，其每把枪在本次哗变中按2把计算。',
    timing: 'afterReveal',
  },
  {
    id: 'chr_gunsmith',
    nameZh: '军械师',
    nameEn: 'Gunsmith',
    textZh: '弃掉1把枪以亮出此牌。只要此牌亮出，每次成功哗变后你都收回自己使用过的1把枪。',
    timing: 'gunCost',
  },
  {
    id: 'chr_peacemaker',
    nameZh: '和平使者',
    nameEn: 'Peacemaker',
    textZh: '枪揭示后立即：选一名玩家，其把揭示的枪全部收回个人补给，且不计入本次哗变。',
    timing: 'afterReveal',
  },
  {
    id: 'chr_gunslinger',
    nameZh: '枪手',
    nameEn: 'Gunslinger',
    textZh: '从供应区取2把枪加入你的个人补给。',
    timing: 'anytime',
  },
  {
    id: 'chr_minstrel',
    nameZh: '吟游诗人',
    nameEn: 'Minstrel',
    textZh: '船长任命航海组后：选两名玩家，他们不参与即将到来的哗变。',
    timing: 'afterAppointment',
  },
  {
    id: 'chr_bosun',
    nameZh: '水手长',
    nameEn: 'Bosun',
    textZh: '抽取导航牌之前：交换现任副手与领航员的职位徽章。',
    timing: 'beforeDraw',
  },
  {
    id: 'chr_herbalist',
    nameZh: '草药师',
    nameEn: 'Herbalist',
    textZh: '船长任命航海组之前：把一张停职牌移给另一名玩家，由其代替停职。',
    timing: 'beforeAppointment',
  },
  {
    id: 'chr_lookout',
    nameZh: '瞭望员',
    nameEn: 'Look-Out',
    textZh: '查看抽牌堆顶的导航牌。你可以将它面朝下弃入深海，或放回抽牌堆顶。',
    timing: 'anytime',
  },
  {
    id: 'chr_master_strategist',
    nameZh: '大战略家',
    nameEn: 'Master Strategist',
    textZh: '枪揭示后立即：如果你没有成为新船长，哗变结束后收回你揭示的枪。',
    timing: 'afterReveal',
  },
  {
    id: 'chr_smuggler',
    nameZh: '走私者',
    nameEn: 'Smuggler',
    textZh: '抽取导航牌之前：选一名担任船长或副手的玩家，该玩家本次抽3张导航牌（而不是2张）。',
    timing: 'beforeDraw',
  },
  {
    id: 'chr_agitator',
    nameZh: '煽动者',
    nameEn: 'Agitator',
    textZh: '船长任命航海组后：选两名玩家，他们在下一次哗变中必须各至少揭示1把枪。',
    timing: 'afterAppointment',
  },
  {
    id: 'chr_consultant',
    nameZh: '顾问',
    nameEn: 'Consultant',
    textZh: '船长任命航海组之前：你指定新任副手，然后船长再指定新任领航员。',
    timing: 'beforeAppointment',
  },
  {
    id: 'chr_chief_cook',
    nameZh: '主厨',
    nameEn: 'Chief Cook',
    textZh: '船长任命航海组后：船长职沿顺时针移交给面前简历牌最少的玩家。新船长任命新的航海组。',
    timing: 'afterAppointment',
  },
  {
    id: 'chr_rabble_rouser',
    nameZh: '蛊惑者',
    nameEn: 'Rabble-rouser',
    textZh: '枪揭示后立即：本次哗变所需枪数减半（向上取整）。',
    timing: 'afterReveal',
  },
  {
    id: 'chr_archivist',
    nameZh: '档案员',
    nameEn: 'Archivist',
    textZh: '抽取导航牌之前：选一名担任船长或副手的玩家，该玩家可以弃掉自己的导航牌并重抽2张。',
    timing: 'beforeDraw',
  },
  {
    id: 'chr_mentor',
    nameZh: '导师',
    nameEn: 'Mentor',
    textZh: '选一名玩家：将其角色牌翻回背面。该角色可以再次启动。',
    timing: 'anytime',
  },
  {
    id: 'chr_spiritualist',
    nameZh: '通灵者',
    nameEn: 'Spiritualist',
    textZh: '在打出过黄色导航牌的回合中：选两名玩家，两人各须把1把枪交给你指定的玩家。',
    timing: 'yellowRound',
  },
  {
    id: 'chr_debt_collector',
    nameZh: '讨债人',
    nameEn: 'Debt Collector',
    textZh: '船长任命航海组后：选航海组中的一名玩家，其须给航海组其他成员每人1把枪。',
    timing: 'afterAppointment',
  },
  {
    id: 'chr_equalizer',
    nameZh: '平权者',
    nameEn: 'Equalizer',
    textZh: '船长任命航海组后：下一次哗变只需1把枪即可成功。每名玩家至多揭示1把枪。',
    timing: 'afterAppointment',
  },
  {
    id: 'chr_instigator',
    nameZh: '教唆者',
    nameEn: 'Instigator',
    textZh: '枪揭示后立即：选一名玩家，该玩家可以将自己的全部枪加入本次哗变；若其不加，哗变后你的角色牌翻回背面（可再次启动）。',
    timing: 'afterReveal',
  },
];

export const CHARACTER_MAP: Record<string, CharacterDef> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
);

// 官方建议 5-6 人避免使用的角色（房间可配置排除）
export const SUGGESTED_EXCLUDE_5_6 = [
  'chr_debt_collector',
  'chr_minstrel',
  'chr_mentor',
];
