import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  apiCreateRoom,
  apiJoinRoom,
  clearSession,
  connectSocket,
  loadSessions,
  registerSocket,
  SessionInfo,
  RoomFullView,
} from './api';
import { Lobby } from './ui/Lobby';
import { GameView } from './ui/GameView';

const emptyView: RoomFullView = { lobby: null, game: null, chat: [], log: [] };

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [view, setView] = useState<RoomFullView>(emptyView);
  const [connErr, setConnErr] = useState('');
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<import('socket.io-client').Socket | null>(null);

  // 自动恢复：本地存有会话则尝试重连
  useEffect(() => {
    const sessions = loadSessions();
    const keys = Object.keys(sessions);
    if (keys.length === 1) {
      tryResume(sessions[keys[0]]);
    } else if (keys.length > 1) {
      // 多个会话：列出选择
      setResumeList(Object.values(sessions));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tryResume = (s: SessionInfo) => {
    setSession(s);
    const socket = connectSocket(s);
    socketRef.current = socket;
    registerSocket(s.roomId, socket);
    socket.on('connect', () => {
      setConnected(true);
      setConnErr('');
      socket.emit('sync');
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (e: Error) => {
      if (/会话无效|过期/.test(e.message)) {
        clearSession(s.roomId);
        setSession(null);
        setResumeList([]);
      }
      setConnErr(`连接失败：${e.message}`);
    });
    socket.on('roomView', (v: RoomFullView) => {
      setView(v ?? emptyView);
    });
  };

  const [resumeList, setResumeList] = useState<SessionInfo[]>([]);

  const leave = useCallback(() => {
    const s = session;
    if (s) {
      try {
        import('./api').then((m) => m.getSocket(s.roomId).emit('lobby', { action: 'leave' }, () => {}));
      } catch {}
      clearSession(s.roomId);
    }
    socketRef.current?.disconnect();
    socketRef.current = null;
    setSession(null);
    setView(emptyView);
    setResumeList([]);
  }, [session]);

  if (session && view.game && view.lobby?.status !== 'lobby') {
    return (
      <>
        {!connected && <div className="conn-banner">⚡ 连接中断，正在重连…（你的座位与数据不会丢失）</div>}
        <GameView session={session} full={view} onLeave={leave} />
      </>
    );
  }
  if (session && view.lobby) {
    return (
      <>
        {!connected && <div className="conn-banner">⚡ 连接中断，正在重连…</div>}
        <Lobby
          session={session}
          full={view}
          onLeave={leave}
          onStart={() => socketRef.current?.emit('sync')}
        />
      </>
    );
  }
  return (
    <Home
      onResume={(s) => tryResume(s)}
      resumeList={resumeList}
      onClearResume={() => setResumeList([])}
      onCreated={(s) => tryResume(s)}
    />
  );
}

const Home: React.FC<{
  onResume: (s: SessionInfo) => void;
  resumeList: SessionInfo[];
  onClearResume: () => void;
  onCreated: (s: SessionInfo) => void;
}> = ({ onResume, resumeList, onClearResume, onCreated }) => {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [count, setCount] = useState(6);
  const [password, setPassword] = useState('');
  const [mapSel, setMapSel] = useState('auto');
  const [roomId, setRoomId] = useState('');
  const [joinPwd, setJoinPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const doCreate = async () => {
    setErr('');
    if (!name.trim()) return setErr('请输入昵称');
    setBusy(true);
    try {
      const s = await apiCreateRoom({
        name: name.trim(),
        playerCount: count,
        password: password || undefined,
        mapId: mapSel,
      });
      onCreated(s);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doJoin = async () => {
    setErr('');
    if (!name.trim()) return setErr('请输入昵称');
    if (!roomId.trim()) return setErr('请输入房间码');
    setBusy(true);
    try {
      const s = await apiJoinRoom(roomId.trim().toUpperCase(), name.trim(), joinPwd || undefined);
      onResume(s);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <div className="hero">
        <h1>⚓ 险恶疑航</h1>
        <p className="sub">Feed the Kraken · 5-11 人在线隐藏身份推理</p>
        <p className="sub small">忠诚水手驶向蓝湾 · 海盗奔向绯红湾 · 邪教召唤海妖</p>
      </div>
      {resumeList.length > 0 && (
        <div className="panel">
          <div className="panel-title">🔄 恢复对局</div>
          {resumeList.map((s) => (
            <div key={s.roomId} className="seat">
              <span>
                房间 {s.roomId} · {s.name}
              </span>
              <button
                className="btn small"
                onClick={() => {
                  onResume(s);
                  onClearResume();
                }}
              >
                重新加入
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="panel">
        <div className="tabs">
          <button className={`tab ${mode === 'create' ? 'on' : ''}`} onClick={() => setMode('create')}>
            创建房间
          </button>
          <button className={`tab ${mode === 'join' ? 'on' : ''}`} onClick={() => setMode('join')}>
            加入房间
          </button>
        </div>
        <label className="field">
          昵称
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} placeholder="你的船员名" />
        </label>
        {mode === 'create' ? (
          <>
            <label className="field">
              人数（5-11）
              <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[5, 6, 7, 8, 9, 10, 11].map((n) => (
                  <option key={n} value={n}>
                    {n} 人
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              地图
              <select value={mapSel} onChange={(e) => setMapSel(e.target.value)}>
                <option value="auto">自动（5-7人短航程 / 8人以上长航程）</option>
                <option value="quick">短航程</option>
                <option value="long">长航程</option>
              </select>
            </label>
            <label className="field">
              房间口令（可选）
              <input value={password} onChange={(e) => setPassword(e.target.value)} maxLength={32} placeholder="留空则无需口令" />
            </label>
            <button className="btn primary big" disabled={busy} onClick={doCreate}>
              🚢 创建房间
            </button>
          </>
        ) : (
          <>
            <label className="field">
              房间码
              <input value={roomId} onChange={(e) => setRoomId(e.target.value)} maxLength={8} placeholder="如 AB3K9X" />
            </label>
            <label className="field">
              口令（若有）
              <input value={joinPwd} onChange={(e) => setJoinPwd(e.target.value)} maxLength={32} />
            </label>
            <button className="btn primary big" disabled={busy} onClick={doJoin}>
              🎫 加入房间
            </button>
          </>
        )}
        {err && <div className="err">⚠ {err}</div>}
      </div>
      <p className="foot small">
        刷新页面或断网后，使用同一浏览器可自动恢复座位。换设备请用房间码重新加入（对局开始后无法加入）。
      </p>
    </div>
  );
};
