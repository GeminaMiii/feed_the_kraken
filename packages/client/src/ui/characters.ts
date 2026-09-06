// 官方角色卡面（public/characters/<id>.jpg，来源 funtails 官方 PnP 原画）。
// 窃癖者（chr_kleptomaniac）暂无官方图，取不到时返回 null，界面需自行兜底。
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
]);

export function characterFaceUrl(id: string | null | undefined): string | null {
  return id && KNOWN_FACES.has(id) ? `/characters/${id}.jpg` : null;
}
