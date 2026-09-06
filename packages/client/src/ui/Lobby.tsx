import React, { useState } from 'react';
import type { RoomFullView, SessionInfo } from '../api';
import { sendLobby, getSocket } from '../api';

export const Lobby: React.FC<{
  session: SessionInfo;
  full: RoomFullView;
  onLeave: () => void;
  onStart: () => void;
}> = ({ session, full, onLeave, onStart }) => {
  const lobby = full.lobby!;
  const [ready, setReady] = useState(
    lobby.seats.find((s) => s.seatId === lobby.yourSeat)?.ready ?? false,
  );
  const [err, setErr] = useState('');
  const act = async (payload: Record<string, unknown>) => {
    setErr('');
    try {
      await sendLobby(getSocket(session.roomId), payload);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const started = lobby.status !== 'lobby';
  if (started) {
    // 对局已开始但视图尚未切换 — 显示等待
    return (
      <div className="lobby">
        <h1>对局即将开始…</h1>
      </div>
    );
  }
  return (
    <div className="lobby">
      <header className="topbar">
        <span className="title">⚓ 险恶疑航 · 大厅</span>
        <span className="room-id">房间码 {lobby.roomId}</span>
        <span>
          {lobby.seats.filter((s) => s.ready).length}/{lobby.playerCount} 准备
        </span>
        <button className="btn small" onClick={onLeave}>
          退出
        </button>
      </header>
      {err && <div className="err">⚠ {err}</div>}
      <div className="lobby-main">
        <div className="panel">
          <div className="panel-title">🪑 船员座位（{lobby.seats.length}/{lobby.playerCount}）</div>
          {lobby.seats.map((s) => (
            <div key={s.seatId} className={`seat ${s.connected ? '' : 'discon'}`}>
              <span>
                P{s.seatId + 1} · {s.name}
                {s.isBot ? ' 🤖' : ''}
                {s.seatId === lobby.yourSeat ? '（你）' : ''}
                {s.isHost ? ' 👑' : ''}
              </span>
              <span className="seat-actions">
                <span className={`badge ${s.ready ? 'ready' : ''}`}>{s.ready ? '已准备' : '未准备'}</span>
                {!s.connected && <span className="badge discon">离线</span>}
                {lobby.youAreHost && s.seatId !== lobby.yourSeat && (
                  <>
                    <button className="btn tiny" onClick={() => act({ action: 'removePlayer', seatId: s.seatId })}>
                      移除
                    </button>
                    <button className="btn tiny" onClick={() => act({ action: 'transferHost', seatId: s.seatId })}>
                      转移房主
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}
          <div className="hint">
            把房间码 <b>{lobby.roomId}</b> 发给你的朋友，在同一网站首页输入即可加入。
          </div>
        </div>
        <div className="panel">
          <div className="panel-title">⚙️ 对局设置</div>
          <div className="hint">人数：{lobby.playerCount} · 地图：{lobby.mapId === 'auto' ? '自动（5-7人短航程 / 8人以上长航程）' : lobby.mapId === 'quick' ? '短航程' : '长航程'}</div>
          {lobby.youAreHost && (
            <label className="field">
              切换地图
              <select value={lobby.mapId} onChange={(e) => act({ action: 'setMap', mapId: e.target.value })}>
                <option value="auto">自动（5-7人短航程 / 8人以上长航程）</option>
                <option value="quick">短航程</option>
                <option value="long">长航程</option>
              </select>
            </label>
          )}
          <div className="hint">口令：{lobby.hasPassword ? '已设置' : '无'}</div>
          {lobby.youAreHost && lobby.seats.length < lobby.playerCount && (
            <button className="btn big" onClick={() => act({ action: 'addBot' })}>
              🤖 添加机器人（自动代打，用于调试）
            </button>
          )}
          {lobby.youAreHost ? (
            <button
              className="btn primary big"
              disabled={lobby.seats.length !== lobby.playerCount}
              onClick={() => act({ action: 'start' }).then(onStart)}
            >
              {lobby.seats.length === lobby.playerCount ? '🚢 开始对局' : `还需 ${lobby.playerCount - lobby.seats.length} 名玩家`}
            </button>
          ) : (
            <button className="btn primary big" onClick={() => act({ action: 'ready', ready: !ready }).then(() => setReady(!ready))}>
              {ready ? '取消准备' : '✔ 准备'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

