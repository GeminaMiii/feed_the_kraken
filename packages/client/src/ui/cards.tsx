import React, { useEffect, useRef } from 'react';
import { CHARACTER_MAP, NAV_CARD_MAP, DIRECTION_ZH, NAV_TYPE_ZH, RITUAL_ZH } from '@ftk/engine';

const navAsset = (id: string) => {
  const c = NAV_CARD_MAP[id];
  if (!c) return `/cards/navigation/${id}.png`;
  const suffix = c.type === 'cultUprising' ? 'cult_uprising' : c.type === 'drunk' ? `drunk_${c.direction}` : c.type;
  return `/cards/navigation/nav_${suffix}.png`;
};

// 角色卡为成品整卡（含标题与技能文字），导航/仪式卡为独立插画；
// 军火库、舱室搜查尚无新图，暂沿用旧裁剪图。
export const cardAssetUrl = (id: string) => {
  if (CHARACTER_MAP[id]) return `/cards/characters/${id}.png`;
  if (NAV_CARD_MAP[id]) return navAsset(id);
  if (id.startsWith('ritual_conversion')) return '/cards/rituals/ritual_conversion_to_cult.png';
  const suffix = id.replace('ritual_', '').replace('guns_stash', 'guns-stash').replace('cult_cabin_search', 'cabin-search');
  return `/cards/ritual-${suffix}.png`;
};

export function cardTitle(id: string) {
  const nav = NAV_CARD_MAP[id];
  if (nav) return `${DIRECTION_ZH[nav.direction]} · ${NAV_TYPE_ZH[nav.type]}`;
  return RITUAL_ZH[id] ?? CHARACTER_MAP[id]?.nameZh ?? id;
}

export function cardCopy(id: string) {
  const nav = NAV_CARD_MAP[id];
  if (nav) return `执行「${NAV_TYPE_ZH[nav.type]}」导航效果，并按航向移动船只。`;
  return CHARACTER_MAP[id]?.textZh ?? ({
    ritual_conversion_1: '秘密选择一名可皈依玩家，将其变为邪教徒。',
    ritual_conversion_2: '秘密选择一名可皈依玩家，将其变为邪教徒。',
    ritual_conversion_3: '秘密选择一名可皈依玩家，将其变为邪教徒。',
    ritual_guns_stash: '秘密分配三把枪，可集中分给一名玩家。',
    ritual_cult_cabin_search: '秘密查看当前航海组三人的阵营。',
  } as Record<string, string>)[id] ?? '';
}

export const CardBack: React.FC<{ compact?: boolean }> = ({ compact }) => (
  <div className={`card-face card-back ${compact ? 'compact' : ''}`} aria-label="卡牌背面">
    <div className="card-back-seal">⚓</div><strong>FEED THE KRAKEN</strong><small>THE NORTH SEA · 1899</small>
  </div>
);

export const CardFace: React.FC<{ id: string; compact?: boolean; className?: string }> = ({ id, compact, className = '' }) => (
  <article className={`card-face ${CHARACTER_MAP[id] ? 'is-character' : ''} ${compact ? 'compact' : ''} ${className}`}>
    <div className="card-ornament"><span>{CHARACTER_MAP[id] ? 'THE CREW' : NAV_CARD_MAP[id] ? 'NAVIGATION' : 'CULT RITUAL'}</span><i>✦</i></div>
    <img src={cardAssetUrl(id)} alt="" loading="lazy" />
    <div className="card-caption"><b>{cardTitle(id)}</b>{!compact && <p>{cardCopy(id)}</p>}</div>
  </article>
);

export const CardZoom: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); const f = () => ref.current?.focus(); document.addEventListener('keydown', f); return () => document.removeEventListener('keydown', f); }, []);
  return <div className="card-zoom-mask" role="dialog" aria-modal="true" aria-label={cardTitle(id)} tabIndex={-1} ref={ref} onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}><div className="card-zoom-panel" onClick={(e) => e.stopPropagation()}><CardFace id={id} /><div className="card-zoom-copy"><h2>{cardTitle(id)}</h2><p>{cardCopy(id)}</p><button className="btn primary" onClick={onClose}>返回资料库</button></div></div></div>;
};
