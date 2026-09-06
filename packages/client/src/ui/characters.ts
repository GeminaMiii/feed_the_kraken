// 官方角色卡面（public/characters/<id>.jpg，来源 funtails 官方 PnP 原画）。
// 注意：chr_kleptomaniac 目前临时借用吟游诗人卡面占位（官方图缺，找到后替换文件即可）。
const KNOWN_FACES = new Set([
  'chr_captain',
  'chr_peacemaker',
  'chr_troublemaker',
  'chr_gunsmith',
  'chr_minstrel',
  'chr_gunslinger',
  'chr_herbalist',
  'chr_bosun',
  'chr_lookout',
  'chr_master_strategist',
  'chr_agitator',
  'chr_smuggler',
  'chr_consultant',
  'chr_chief_cook',
  'chr_archivist',
  'chr_rabble_rouser',
  'chr_mentor',
  'chr_spiritualist',
  'chr_debt_collector',
  'chr_equalizer',
  'chr_instigator',
  'chr_kleptomaniac', // TODO: 占位图（借用吟游诗人），待补官方图
]);

export function characterFaceUrl(id: string | null | undefined): string | null {
  return id && KNOWN_FACES.has(id) ? `/characters/${id}.jpg` : null;
}
