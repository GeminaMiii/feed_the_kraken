// ============================================================
// 对局回放（T6）：基于命令日志在客户端确定性重放。
// 引擎是纯函数状态机：初始种子 + 命令序列 = 任意时刻的完整局面。
// 视图使用 spectator 投影（仅公开信息），复盘不泄露未揭示的秘密。
// ============================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createGameState,
  applyCommand,
  buildSpectatorView,
  SeededRng,
  getMap,
} from '@ftk/engine';
import type { RoomConfig, Command } from '@ftk/engine';
import type { ReplayData } from '../api';
import { apiReplay } from '../api';
import { DEFAULT_SKIN_ID, getSkin } from './boards/registry';
import { useModalDismiss } from './useModalDismiss';

/** 重放到指定 seq 的观战视图（纯计算，失败返回 null） */
function replayAt(data: ReplayData, uptoSeq: number) {
  try {
    const rng = SeededRng.fromState(data.setup.rngState);
    const state = createGameState(
      data.setup.seats.map((s) => ({ seatId: s.seatId, name: s.name })),
      data.setup.config as unknown as RoomConfig,
      rng,
    );
    for (const c of data.commands) {
      if (c.seq > uptoSeq) break;
      if (typeof c.seatId !== 'number') continue;
      try {
        applyCommand(state, c.seatId, c.payload as unknown as Command);
      } catch {
        /* 单条命令重放失败不应中断整体（理论上确定性引擎不应发生） */
      }
    }
    return buildSpectatorView(state);
  } catch {
    return null;
  }
}

export const ReplayView: React.FC<{ roomId: string; onClose: () => void }> = ({ roomId, onClose }) => {
  const [data, setData] = useState<ReplayData | null>(null);
  const [err, setErr] = useState('');
  const [upto, setUpto] = useState(0);
  const [playing, setPlaying] = useState(false);
  // T12：Esc 关闭 / 焦点圈闭
  const panelRef = useRef<HTMLDivElement>(null);
  useModalDismiss(panelRef, true, onClose);

  useEffect(() => {
    let alive = true;
    apiReplay(roomId)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setUpto(d.commands.length);
      })
      .catch((e) => setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [roomId]);

  const maxSeq = data?.commands.length ?? 0;

  // 自动播放：500ms 一步
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setUpto((u) => {
        if (u >= maxSeq) {
          setPlaying(false);
          return u;
        }
        return u + 1;
      });
    }, 500);
    return () => clearInterval(t);
  }, [playing, maxSeq]);

  const view = useMemo(() => (data ? replayAt(data, upto) : null), [data, upto]);
  const map = useMemo(() => (view ? getMap(view.mapId) : null), [view]);
  const skin = getSkin(DEFAULT_SKIN_ID);
  const Board = skin.Component;

  const stepTo = (n: number) => {
    setPlaying(false);
    setUpto(Math.max(0, Math.min(maxSeq, n)));
  };

  if (err) {
    return (
      <div className="replay-mask">
        <div className="replay panel">
          <div className="panel-title">🎥 对局复盘</div>
          <div className="err">⚠ {err}</div>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    );
  }
  if (!data || !view || !map) {
    return (
      <div className="replay-mask">
        <div className="replay panel">
          <div className="panel-title">🎥 对局复盘</div>
          <div className="hint">回放数据加载中…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="replay-mask">
      <div ref={panelRef} className="replay panel" role="dialog" aria-modal="true" aria-label="对局复盘" tabIndex={-1}>
        <header className="topbar">
          <span className="title">🎥 复盘 · 房间 {roomId}</span>
          <span className="stage">
            第 {view.round} 轮 · {view.stageZh}
          </span>
          <span className="waiting">{view.waitingFor}</span>
          <button className="btn small" onClick={onClose}>
            关闭
          </button>
        </header>
        {data.finalResult && upto >= maxSeq && (
          <div className="result-line">
            🏴‍☠️ 终局：{
              { sailor: '忠诚水手', pirate: '海盗', cult: '邪教' }[data.finalResult.winner]
            }获胜 — {data.finalResult.reasonZh}
          </div>
        )}
        <div className="replay-main">
          <div className="replay-board">
            <Board view={view} map={map} />
          </div>
          <div className="panel replay-log">
            <div className="panel-title">📜 日志（至第 {upto} 步）</div>
            <div className="log">
              {view.players.map((p) => (
                <span key={p.seatId} className="badge" style={{ marginRight: 4 }}>
                  P{p.seatId + 1} {p.name}
                </span>
              ))}
              <div className="hint small">拖动下方滑杆回看每个决策点（仅公开信息）。</div>
            </div>
          </div>
        </div>
        <div className="replay-ctrl">
          <button className="btn small" onClick={() => stepTo(0)} title="回到开局">
            ⏮
          </button>
          <button className="btn small" onClick={() => stepTo(upto - 1)}>
            ◀
          </button>
          <button className="btn small primary" onClick={() => setPlaying(!playing)}>
            {playing ? '⏸ 暂停' : '▶ 播放'}
          </button>
          <button className="btn small" onClick={() => stepTo(upto + 1)}>
            ▶
          </button>
          <button className="btn small" onClick={() => stepTo(maxSeq)} title="跳到终局">
            ⏭
          </button>
          <input
            type="range"
            min={0}
            max={maxSeq}
            value={upto}
            onChange={(e) => stepTo(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span className="hint">
            {upto} / {maxSeq}
          </span>
        </div>
      </div>
    </div>
  );
};
