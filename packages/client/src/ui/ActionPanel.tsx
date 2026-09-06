import React, { useMemo, useState } from 'react';
import type { PlayerView, Command } from '@ftk/engine';
import { CHARACTER_MAP, NAV_CARD_MAP, DIRECTION_ZH, NAV_TYPE_ZH } from '@ftk/engine';
import type { ViewPending } from '@ftk/engine';
import { sendCommand } from '../api';

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
        <PendingUI key={myPending.id} pending={myPending} view={view} onCommand={onCommand} onError={onError} />
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
    <div>
      <div className="hint">📢 角色窗口：你可以亮出角色牌发动效果，或选择通过。</div>
      {myOpt && (
        <button
          disabled={busy}
          className="btn primary"
          onClick={() => run({ type: 'activateCharacter', characterId: myOpt.characterId })}
        >
          亮出「{CHARACTER_MAP[myOpt.characterId]?.nameZh}」
        </button>
      )}
      {myOpt && CHARACTER_MAP[myOpt.characterId] && (
        <div className="card-text">{CHARACTER_MAP[myOpt.characterId].textZh}</div>
      )}
      {!view.youPassedWindow && (
        <button disabled={busy} className="btn" onClick={() => run({ type: 'pass' })}>
          通过
        </button>
      )}
      {view.youPassedWindow && <div className="hint">已通过，等待其他玩家…</div>}
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
      // 客户端无法知道谁可皈依（舱搜/鞭刑是隐藏状态），列出所有非邪教可能者，交服务端校验
      return alive.filter((p) => p.seatId !== cap).map((p) => p.seatId);
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

  const ChoosePlayerUI = ({ candidates, label }: { candidates: number[]; label: string }) => (
    <div>
      <div className="hint">{label}</div>
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
      const eligible = view.players.filter(
        (p) => !p.eliminated && !p.offDuty && p.seatId !== view.captain && p.seatId !== view.lieutenant,
      );
      const eligibleLt = view.players.filter(
        (p) => !p.eliminated && !p.offDuty && p.seatId !== view.captain && p.seatId !== view.navigator,
      );
      if (navigatorOnly) {
        return (
          <ChoosePlayerUI
            candidates={eligible.map((p) => p.seatId)}
            label="请任命领航员（副手已定）"
          />
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
                  {selLt === null ? '（先选副手）' : `任命 ${view.players[selLt].name} + ${p.name}`}
                </button>
              ))}
          </div>
        </div>
      );
    }
    case 'consultantLieutenant':
      return (
        <ChoosePlayerUI
          candidates={view.players.filter((p) => !p.eliminated && p.seatId !== view.captain && p.seatId !== view.navigator).map((p) => p.seatId)}
          label="顾问：指定新任副手"
        />
      );
    case 'mutinySubmit': {
      const max = view.you.guns ?? 0;
      const forcedMin = 0; // 若被煽动，服务端会拒绝并提示
      const [cnt, setCnt] = React.useState(0);
      const [touched, setTouched] = React.useState(false);
      React.useEffect(() => {
        if (!touched) setCnt(Math.min(max, forcedMin));
      }, [max, touched]);
      return (
        <div>
          <div className="hint">🤫 忠诚质询：秘密选择要亮出的枪数（0 至全部 {max} 把）。所有人都提交后同时揭示。</div>
          {view.mutinyPublic.threshold > 0 && <div className="hint small">成功哗变需要 {view.mutinyPublic.threshold} 把枪（总表决为公开信息，但每人的选择保密）。</div>}
          <div className="stepper">
            <button disabled={busy || cnt <= 0} onClick={() => { setTouched(true); setCnt(cnt - 1); }}>−</button>
            <span className="count">{cnt}</span>
            <button disabled={busy || cnt >= max} onClick={() => { setTouched(true); setCnt(cnt + 1); }}>＋</button>
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
            <div className="btns">
              <button disabled={busy} className="btn primary" onClick={() => run({ type: 'chooseCard', cardId: '__redraw__' })}>
                弃掉重抽
              </button>
              <button disabled={busy} className="btn" onClick={() => run({ type: 'pass' })}>
                保留
              </button>
            </div>
          </div>
        );
      }
      const cards = (data.cards as string[]) ?? view.yourHand;
      return (
        <div>
          <div className="hint">{pending.reasonZh}</div>
          <div className="btns">
            {cards.map((c) => (
              <button key={c} disabled={busy} className="btn" onClick={() => run({ type: 'chooseCard', cardId: c })}>
                {cardNameZh(c)}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case 'navigatorChoose': {
      const cards = (data.cards as string[]) ?? view.yourHand;
      return (
        <div>
          <div className="hint">🧭 你是领航员：查看两张牌后选择。弃掉一张，另一张将被执行。你也可以拒令跳海（立即出局，触发紧急航海）。</div>
          <div className="hand">
            {cards.map((c) => (
              <div key={c} className="navcard">
                <div className="navcard-name">{cardNameZh(c)}</div>
                <button disabled={busy} className="btn primary" onClick={() => run({ type: 'navigatorAction', action: 'discard', cardId: c })}>
                  弃掉这张（执行另一张）
                </button>
              </div>
            ))}
          </div>
          <button disabled={busy} className="btn danger" onClick={() => run({ type: 'navigatorAction', action: 'jumpShip' })}>
            拒绝执行命令——跳海（不可撤销！）
          </button>
        </div>
      );
    }
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
          <div className="hint">{pending.reasonZh}</div>
          <div className="btns">
            <button disabled={busy} className="btn" onClick={() => run({ type: 'telescopeDecision', discard: true })}>
              面朝下弃入深海
            </button>
            <button disabled={busy} className="btn" onClick={() => run({ type: 'telescopeDecision', discard: false })}>
              放回牌堆顶
            </button>
          </div>
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
