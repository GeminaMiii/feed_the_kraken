import React, { useRef, useState } from 'react';
import type { PlayerView, ViewPlayer } from '@ftk/engine';
import { CHARACTER_MAP, NAV_CARD_MAP, NAV_TYPE_ZH, DIRECTION_ZH } from '@ftk/engine';
import { characterFaceUrl } from './characters';
import { useModalDismiss } from './useModalDismiss';

const cardNameZh = (id: string) => {
  const c = NAV_CARD_MAP[id];
  return c ? `${DIRECTION_ZH[c.direction]}·${NAV_TYPE_ZH[c.type]}` : id;
};

const FACTION_ZH: Record<string, string> = {
  sailor: '水手',
  pirate: '海盗',
  cultLeader: '邪教主',
  cultist: '邪教徒',
};

const NOT_ZH: Record<string, string> = { sailor: '水手', pirate: '海盗', cult: '邪教', cultLeader: '邪教主', cultist: '邪教徒' };

export const PlayersPanel: React.FC<{ view: PlayerView }> = ({ view }) => {
  const [inspecting, setInspecting] = useState<{ name: string; cid: string } | null>(null);
  const def = inspecting ? CHARACTER_MAP[inspecting.cid] : null;
  const modalRef = useRef<HTMLDivElement>(null);
  useModalDismiss(modalRef, !!(inspecting && def), () => setInspecting(null));
  return (
    <div className="players">
      {view.players.map((p) => (
        <PlayerCard
          key={p.seatId}
          p={p}
          view={view}
          onInspectCharacter={(cid) => setInspecting({ name: p.name, cid })}
        />
      ))}
      {inspecting && def && (
        <div className="modal-mask" onClick={() => setInspecting(null)}>
          <div
            ref={modalRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${inspecting.name} 的角色：${def.nameZh}`}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title">
              {inspecting.name} 的角色 · {def.nameZh}
            </div>
            <div className="char-body">
              {characterFaceUrl(inspecting.cid) && (
                <img className="char-face" src={characterFaceUrl(inspecting.cid)!} alt={def.nameZh} />
              )}
              <div className="card-text">{def.textZh}</div>
            </div>
            <button className="btn small" onClick={() => setInspecting(null)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const PlayerCard: React.FC<{
  p: ViewPlayer;
  view: PlayerView;
  onInspectCharacter: (cid: string) => void;
}> = ({ p, view, onInspectCharacter }) => {
  const isMe = p.seatId === view.you.seatId;
  const teammate = view.you.teammates.includes(p.seatId);
  const dead = p.eliminated;
  return (
    <div className={`pcard ${dead ? 'dead' : ''} ${isMe ? 'me' : ''}`}>
      <div className="prow">
        <span className="pname">
          {p.name}
          {isMe ? '（你）' : ''}
        </span>
        <span className="badges">
          {p.isCaptain && <span className="badge cap">船</span>}
          {p.isLieutenant && <span className="badge lt">副</span>}
          {p.isNavigator && <span className="badge nav">航</span>}
          {p.offDuty && <span className="badge off">停职</span>}
          {p.noTongue && <span className="badge off">割舌</span>}
          {!p.connected && <span className="badge discon">离线</span>}
        </span>
      </div>
      <div className="prow small">
        <span>🔫{p.guns}</span>
        <span title="作为船长打出的导航牌（公开履历）">📜{p.resumeCount}{p.resumes.length > 0 && ':'}</span>
        {p.resumes.map((c, i) => (
          <span key={i} className="badge resume">{cardNameZh(c)}</span>
        ))}
        {dead && <span className="dead-tag">{p.eliminationReason === 'overboard' ? '跳海' : '献祭'}出局</span>}
        {teammate && <span className="badge mate">队友</span>}
        {p.notFactions.map((f) => (
          <span key={f} className="badge notf">非{NOT_ZH[f]}</span>
        ))}
      </div>
      <div className="prow small">
        {p.characterRevealed && p.revealedCharacterId && (
          <span
            className="badge chr clickable"
            title="点击查看技能"
            onClick={() => onInspectCharacter(p.revealedCharacterId!)}
          >
            {CHARACTER_MAP[p.revealedCharacterId]?.nameZh ?? p.revealedCharacterId} ⓘ
          </span>
        )}
        {p.characterRevealed && p.revealedCharacterId && characterFaceUrl(p.revealedCharacterId) && (
          <img
            className="pface clickable"
            src={characterFaceUrl(p.revealedCharacterId)!}
            alt={CHARACTER_MAP[p.revealedCharacterId]?.nameZh ?? ''}
            title="点击查看技能"
            onClick={() => onInspectCharacter(p.revealedCharacterId!)}
          />
        )}
        {isMe && view.you.faction && <span className="badge mefac">{FACTION_ZH[view.you.faction]}</span>}
      </div>
    </div>
  );
};
