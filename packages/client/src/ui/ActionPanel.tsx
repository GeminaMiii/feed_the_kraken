import React, { useState } from 'react';
import type { PlayerView, Command } from '@ftk/engine';
import { CHARACTER_MAP, NAV_CARD_MAP, DIRECTION_ZH, NAV_TYPE_ZH } from '@ftk/engine';
import type { ViewPending } from '@ftk/engine';
import { CardFace, CardZoom } from './cards';
import { appointmentCandidates, cardChoice, convertibleCandidates, gunBounds } from './actionChoices';

export const cardNameZh = (id: string) => {
  const c = NAV_CARD_MAP[id];
  return c ? `${DIRECTION_ZH[c.direction]}·${NAV_TYPE_ZH[c.type]}` : id;
};

interface Props {
  view: PlayerView;
  onCommand: (c: Command) => Promise<void>;
  onError: (msg: string) => void;
}

export const ActionPanel: React.FC<Props> = ({ view, onCommand, onError }) => {
  const myPending = view.pending.find((p) => p.mine);
  const waitingOther = view.pending.find((p) => !p.mine);
  const hasWindow = view.activationWindowKind !== null;

  if (view.result) return <ResultPanel view={view} />;
  if (view.you.eliminated) {
    return (
      <div className="panel">
        <div className="panel-title">☠️ 你已出局</div>
        <div className="hint">请保持安静，观局至终盘（游戏结束时将公开全部阵营）。</div>
        {waitingOther && <div className="hint">当前：{view.waitingFor}</div>}
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-title">🎯 你的行动</div>
      {myPending ? (
        <PendingUI key={`${view.you.seatId}:${myPending.id}:${myPending.kind}:${JSON.stringify(myPending.data.cards ?? [])}`} pending={myPending} view={view} onCommand={onCommand} onError={onError} />
      ) : hasWindow ? (
        <WindowUI view={view} onCommand={onCommand} onError={onError} />
      ) : waitingOther ? (
        <div className="hint">⏳ {view.waitingFor}</div>
      ) : (
        <div className="hint">⏳ 等待中…{view.waitingFor}</div>
      )}
    </div>
  );
};

const ResultPanel: React.FC<{ view: PlayerView }> = ({ view }) => {
  const r = view.result!;
  const winnerZh = { sailor: '忠诚水手', pirate: '海盗', cult: '邪教' }[r.winner];
  const FACTION_ZH: Record<string, string> = { sailor: '水手', pirate: '海盗', cultLeader: '邪教主', cultist: '邪教徒' };
  return (
    <div className="panel result">
      <div className="panel-title">🏴‍☠️ 对局结束</div>
      <div className="result-line">获胜阵营：{winnerZh}</div>
      <div className="result-line">{r.reasonZh}</div>
      <table className="reveal">
        <tbody>
          {view.players.map((p) => {
            const f = r.factions[p.seatId];
            return (
              <tr key={p.seatId}>
                <td>{p.name}</td>
                <td className={f === r.winner || (r.winner === 'cult' && (f === 'cultist' || f === 'cultLeader')) ? 'win' : 'lose'}>
                  {FACTION_ZH[f] ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const WindowUI: React.FC<Props> = ({ view, onCommand, onError }) => {
  const opts = view.activationOptions;
  const myOpt = opts.find((o) => o.seatId === view.you.seatId);
  const [busy, setBusy] = useState(false);
  const run = async (c: Command) => {
    setBusy(true);
    try {
      await onCommand(c);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="activation-decision">
      <div className="hint">📢 是否在当前时机亮出自己的角色身份？阵营牌与角色牌是两套不同的信息。</div>
      <div className="activation-choice-row">
        <button
          disabled={busy || !myOpt || view.youPassedWindow}
          className={`btn activation-choice ${myOpt && !view.youPassedWindow ? 'available' : ''}`}
          onClick={() => myOpt && run({ type: 'activateCharacter', characterId: myOpt.characterId })}
        >
          亮出自己的身份
        </button>
        <button
          disabled={busy || !myOpt || view.youPassedWindow}
          className={`btn activation-choice ${myOpt && !view.youPassedWindow ? 'available' : ''}`}
          onClick={() => run({ type: 'pass' })}
        >
          不亮自己的身份
        </button>
      </div>
      {myOpt && CHARACTER_MAP[myOpt.characterId] && (
        <div className="card-text">当前可亮出：{CHARACTER_MAP[myOpt.characterId].nameZh}。{CHARACTER_MAP[myOpt.characterId].textZh}</div>
      )}
      {!myOpt && <div className="hint small">当前时机不能亮出你的角色牌，无需操作，系统已自动跳过。</div>}
      {view.youPassedWindow && myOpt && <div className="hint small">你已作出选择，正在等待其他玩家。</div>}
    </div>
  );
};

// 候选目标计算（与引擎过滤器一致；服务端仍会校验）
function candidatesFor(view: PlayerView, pending: ViewPending): number[] {
  const data = pending.data as Record<string, unknown>;
  const filter = (data.filter as string) ?? '';
  const alive = view.players.filter((p) => !p.eliminated);
  const me = view.you.seatId;
  const cap = view.captain;
  const lt = view.lieutenant;
  const chosen = (data.chosen as number[]) ?? [];
  switch (filter) {
    case 'mapActionTarget':
    case 'anyAliveExceptSelf':
      return alive.filter((p) => p.seatId !== me).map((p) => p.seatId);
    case 'hasGuns':
      return alive.filter((p) => p.seatId !== me && (p.guns ?? 0) >= 1).map((p) => p.seatId);
    case 'anyAlive':
      return alive.map((p) => p.seatId);
    case 'anyAliveWithCharacter':
      return alive.map((p) => p.seatId);
    case 'offDutySource':
      return alive.filter((p) => p.offDuty).map((p) => p.seatId);
    case 'notOffDuty':
      return alive.filter((p) => !p.offDuty && p.seatId !== data.source).map((p) => p.seatId);
    case 'captainOrLieutenant':
      return [cap, lt].filter((s) => s >= 0);
    case 'aliveExceptCaptain':
      return alive.filter((p) => p.seatId !== cap && !chosen.includes(p.seatId)).map((p) => p.seatId);
    case 'agitatorTarget':
      return alive.filter((p) => p.seatId !== cap && !chosen.includes(p.seatId)).map((p) => p.seatId);
    case 'aliveExceptSelfAndCaptain':
      return alive.filter((p) => p.seatId !== me && p.seatId !== cap).map((p) => p.seatId);
    case 'mutinyRevealed': {
      const revealed = view.mutinyPublic.revealedBySeat ?? {};
      return alive.filter((p) => (revealed[p.seatId] ?? 0) > 0).map((p) => p.seatId);
    }
    case 'navTeamMember':
      return [cap, lt, view.navigator].filter((s) => s >= 0);
    case 'convertible':
      return convertibleCandidates(view);
    case 'tieCandidates':
      return ((data.candidates as number[]) ?? []).filter((s) => s !== me);
    default:
      return alive.map((p) => p.seatId);
  }
}

const PendingUI: React.FC<{ pending: ViewPending; view: PlayerView; onCommand: Props['onCommand']; onError: Props['onError'] }> = ({
  pending,
  view,
  onCommand,
  onError,
}) => {
  const [busy, setBusy] = useState(false);
  const [selLt, setSelLt] = useState<number | null>(null);
  const [alloc, setAlloc] = useState<Record<number, number>>({});
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [zoomCard, setZoomCard] = useState<string | null>(null);
  const [confirmJump, setConfirmJump] = useState(false);
  const [showCards, setShowCards] = useState(false);
  const [gunCount, setGunCount] = useState<number | null>(null);
  const run = async (c: Command) => {
    setBusy(true);
    try {
      await onCommand(c);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const data = pending.data as Record<string, unknown>;

  // Never render private pending content for another seat, even if supplied accidentally.
  if (!pending.mine) return null;

  const cardGallery = (cards: string[], choose = false) => (
    <>
      <div className="action-card-row">
        {cards.map((id) => (
          <div key={id} className={`card-choice ${selectedCard === id ? 'selected' : ''}`}>
            <CardFace id={id} />
            <button className="btn" onClick={() => setZoomCard(id)} aria-label={`放大查看 ${cardNameZh(id)}`}>放大查看</button>
            {choose && <button disabled={busy || confirmJump} className="btn" aria-pressed={selectedCard === id} onClick={() => setSelectedCard(id)}>
              {cards.length === 2 ? '保留此牌' : '弃掉此牌'}
            </button>}
          </div>
        ))}
      </div>
      {zoomCard && <CardZoom id={zoomCard} onClose={() => setZoomCard(null)} />}
    </>
  );

  const cardSelection = (navigator: boolean) => {
    const cards = (data.cards as string[]) ?? view.yourHand;
    const choice = cardChoice(cards, selectedCard, navigator);
    return <>
      <div className="hint">{cards.length === 2
        ? navigator ? '选择要执行的保留牌，再确认弃掉另一张。' : '选择要放入航海日志的保留牌，再确认弃掉另一张。'
        : navigator ? '航海日志有多张牌：每次选择并确认弃掉一张，直到剩下一张执行。' : '走私者多抽牌：选择并确认弃掉一张，其余牌全部放入航海日志。'}</div>
      <button className="btn primary reveal-card-action" disabled={busy || confirmJump} onClick={() => setShowCards(true)}>
        {cards.length === 2 ? '查看两张卡牌并选择' : '查看可选卡牌'}
      </button>
      {showCards && <div className="card-action-overlay" role="dialog" aria-modal="true" aria-label="选择导航卡" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') setShowCards(false); }} onClick={() => setShowCards(false)}>
        <div className="card-action-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="modal-heading"><div><div className="modal-kicker">当前操作 · 私密卡牌</div><div className="modal-title">请选择要处理的卡牌</div></div><button className="btn small" onClick={() => setShowCards(false)}>取消</button></div>
          {cardGallery(cards, true)}
          {choice && <div className="selection-summary" aria-live="polite">保留：{choice.kept.map(cardNameZh).join('、')}；弃掉：{cardNameZh(choice.discarded)}。</div>}
          <button className="btn primary" disabled={busy || !choice || confirmJump} onClick={() => choice && run(choice.command)}>
            {navigator && choice?.kept.length === 1 ? '确认保留并执行（弃掉另一张）' : cards.length === 2 ? '确认保留（弃掉另一张）' : '确认弃掉所选牌'}
          </button>
        </div>
      </div>}
    </>;
  };

  const ChoosePlayerUI = ({ candidates, label }: { candidates: number[]; label: string }) => (
    <div>
      <div className="hint">{label}</div>
      {candidates.length === 0 && <div className="hint small">当前没有可选目标，请稍候或联系房主。</div>}
      <div className="btns">
        {candidates.map((s) => {
          const p = view.players.find((q) => q.seatId === s)!;
          return (
            <button key={s} disabled={busy} className="btn" onClick={() => run({ type: 'choosePlayer', seat: s })}>
              {p.name}
              {p.isCaptain ? '（船长）' : p.isLieutenant ? '（副手）' : p.isNavigator ? '（领航员）' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );

  switch (pending.kind) {
    case 'appointTeam': {
      const navigatorOnly = data.navigatorOnly === true;
      const eligible = appointmentCandidates(view, 'navigator');
      const eligibleLt = appointmentCandidates(view, 'lieutenant');
      if (navigatorOnly) {
        return (
          <div>
            <div className="hint">请任命领航员（副手已定）</div>
            <div className="btns">{eligible.map((p) => <button key={p.seatId} disabled={busy} className="btn primary"
              onClick={() => run({ type: 'appoint', lieutenant: view.lieutenant, navigator: p.seatId })}>{p.name}</button>)}</div>
          </div>
        );
      }
      return (
        <div>
          <div className="hint">① 选择副手</div>
          <div className="btns">
            {eligibleLt.map((p) => (
              <button key={p.seatId} disabled={busy} className={`btn ${selLt === p.seatId ? 'sel' : ''}`} onClick={() => setSelLt(p.seatId)}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="hint">② 选择领航员并确认</div>
          <div className="btns">
            {eligible
              .filter((p) => p.seatId !== selLt)
              .map((p) => (
                <button
                  key={p.seatId}
                  disabled={busy || selLt === null}
                  className="btn primary"
                  onClick={() => run({ type: 'appoint', lieutenant: selLt!, navigator: p.seatId })}
                >
                  {selLt === null ? '（先选副手）' : `任命 ${view.players.find((q) => q.seatId === selLt)?.name} + ${p.name}`}
                </button>
              ))}
          </div>
        </div>
      );
    }
    case 'consultantLieutenant':
      return (
        <ChoosePlayerUI
          candidates={appointmentCandidates(view, 'lieutenant').map((p) => p.seatId)}
          label="顾问：指定新任副手"
        />
      );
    case 'mutinySubmit': {
      const { min, max } = gunBounds(view, pending);
      const cnt = Math.max(min, Math.min(max, gunCount ?? min));
      return (
        <div>
          <div className="hint">🤫 忠诚质询：秘密选择要亮出的枪数（{min} 至 {max} 把）。所有人都提交后同时揭示。</div>
          {view.mutinyPublic.threshold > 0 && <div className="hint small">成功哗变需要 {view.mutinyPublic.threshold} 把枪（总表决为公开信息，但每人的选择保密）。</div>}
          <div className="stepper">
            <button disabled={busy || cnt <= min} onClick={() => setGunCount(cnt - 1)}>−</button>
            <span className="count">{cnt}</span>
            <button disabled={busy || cnt >= max} onClick={() => setGunCount(cnt + 1)}>＋</button>
          </div>
          <button
            disabled={busy}
            className="btn primary"
            onClick={() => run({ type: 'submitGuns', count: cnt })}
          >
            提交（保密）
          </button>
        </div>
      );
    }
    case 'tiePick':
      return <ChoosePlayerUI candidates={(data.candidates as number[]) ?? []} label="平局：指定一名玩家退出船长争夺" />;
    case 'emergencyNavigator':
      return (
        <ChoosePlayerUI
          candidates={view.players.filter((p) => !p.eliminated && p.seatId !== view.captain && p.seatId !== view.lieutenant).map((p) => p.seatId)}
          label="紧急航海：指定紧急领航员（可指定停职玩家）"
        />
      );
    case 'choosePlayer':
      return <ChoosePlayerUI candidates={candidatesFor(view, pending)} label={pending.reasonZh} />;
    case 'chooseCard': {
      if (data.archivistRedraw) {
        return (
          <div>
            <div className="hint">{pending.reasonZh}？</div>
            <button className="btn primary" onClick={() => setShowCards(true)}>查看刚抽到的导航卡</button>
            {showCards && <div className="card-action-overlay" role="dialog" aria-modal="true" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') setShowCards(false); }} onClick={() => setShowCards(false)}><div className="card-action-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="modal-heading"><div className="modal-title">档案员 · 检查导航卡</div><button className="btn small" onClick={() => setShowCards(false)}>取消</button></div>
              {cardGallery(view.yourHand)}
              <div className="btns"><button disabled={busy} className="btn primary" onClick={() => run({ type: 'chooseCard', cardId: '__redraw__' })}>弃掉并重抽</button><button disabled={busy} className="btn" onClick={() => run({ type: 'pass' })}>保留当前卡牌</button></div>
            </div></div>}
          </div>
        );
      }
      return (
        <div>
          {cardSelection(false)}
        </div>
      );
    }
    case 'navigatorChoose': {
      return (
        <div>
          {cardSelection(true)}
          {!confirmJump ? <button disabled={busy} className="btn danger" onClick={() => setConfirmJump(true)}>拒令跳海…</button> : (
            <div className="selection-summary" role="alert">
              <p>跳海会立即出局，弃掉全部导航牌，并触发紧急航海。此操作不可撤销；邪教主跳海也不会获胜。</p>
              <button disabled={busy} className="btn" onClick={() => setConfirmJump(false)}>取消，继续选牌</button>
              <button disabled={busy} className="btn danger" onClick={() => run({ type: 'navigatorAction', action: 'jumpShip' })}>确认跳海并永久出局</button>
            </div>
          )}
        </div>
      );
    }
    case 'captainReveal':
      return (
        <div className="captain-reveal-action">
          <div className="hint">副手与领航员已经完成秘密决策。最终卡牌仍在关闭的航海日志中，只有你点击后才会向全员公开并执行。</div>
          <button disabled={busy} className="btn primary big" onClick={() => run({ type: 'revealNavigation' })}>打开航海日志并执行导航牌</button>
        </div>
      );
    case 'floggingSelfDeclare': {
      const z = { sailor: '水手（蓝）', pirate: '海盗（红）', cult: '邪教（黄/绿）' };
      return (
        <div>
          <div className="hint">鞭刑：请选择与你「当前阵营」对应的牌（这是秘密声明，之后将公开一个你不属于的阵营）。</div>
          <div className="btns">
            {(['sailor', 'pirate', 'cult'] as const).map((d) => (
              <button key={d} disabled={busy} className="btn" onClick={() => run({ type: 'floggingDeclare', declares: d })}>
                {z[d]}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case 'gunsStash': {
      const total = Object.values(alloc).reduce((a, b) => a + b, 0);
      return (
        <div>
          <div className="hint">邪教军火库：将恰好 3 把枪分配给任意玩家（可给自己，可集中）。分配结果保密。</div>
          <div className="btns">
            {view.players.filter((p) => !p.eliminated).map((p) => (
              <div key={p.seatId} className="alloc-row">
                <span>{p.name}</span>
                <button disabled={busy} onClick={() => setAlloc({ ...alloc, [p.seatId]: Math.max(0, (alloc[p.seatId] ?? 0) - 1) })}>−</button>
                <span>{alloc[p.seatId] ?? 0}</span>
                <button disabled={busy} onClick={() => setAlloc({ ...alloc, [p.seatId]: (alloc[p.seatId] ?? 0) + 1 })}>＋</button>
              </div>
            ))}
          </div>
          <button
            disabled={busy || total !== 3}
            className="btn primary"
            onClick={() => run({ type: 'allocateGuns', alloc })}
          >
            {total === 3 ? '确认分配' : `已分配 ${total}/3`}
          </button>
        </div>
      );
    }
    case 'telescopeDecision':
      return (
        <div>
          <div className="hint">望远镜已经看到牌堆顶，但卡面仍保持私密。</div>
          <button className="btn primary" onClick={() => setShowCards(true)}>查看望远镜中的导航卡</button>
          {showCards && <div className="card-action-overlay" role="dialog" aria-modal="true" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') setShowCards(false); }} onClick={() => setShowCards(false)}><div className="card-action-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading"><div className="modal-title">望远镜 · 牌堆顶</div><button className="btn small" onClick={() => setShowCards(false)}>取消</button></div>
            {typeof data.cardPreview === 'string' && cardGallery([data.cardPreview])}
            <div className="btns"><button disabled={busy} className="btn" onClick={() => run({ type: 'telescopeDecision', discard: true })}>面朝下弃入深海</button><button disabled={busy} className="btn primary" onClick={() => run({ type: 'telescopeDecision', discard: false })}>放回牌堆顶</button></div>
          </div></div>}
        </div>
      );
    case 'instigatorAnswer':
      return (
        <div>
          <div className="hint">{pending.reasonZh}（你当前有 {view.you.guns} 把枪）</div>
          <div className="btns">
            <button disabled={busy} className="btn primary" onClick={() => run({ type: 'instigatorAnswer', join: true })}>
              全部加入
            </button>
            <button disabled={busy} className="btn" onClick={() => run({ type: 'instigatorAnswer', join: false })}>
              不加入
            </button>
          </div>
        </div>
      );
    default:
      return <div className="hint">{pending.reasonZh}</div>;
  }
};
