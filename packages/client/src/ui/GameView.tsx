import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { RoomFullView, SessionInfo } from '../api';
import { sendChat, sendCommand, getSocket } from '../api';
import { PlayersPanel } from './PlayersPanel';
import { ActionPanel, cardNameZh } from './ActionPanel';
import { destinationText } from './navcards';
import { BOARD_SKINS, DEFAULT_SKIN_ID, SKIN_STORAGE_KEY, getSkin } from './boards/registry';
import { characterFaceUrl } from './characters';
import { CHARACTER_MAP, getMap } from '@ftk/engine';
import type { PlayerView } from '@ftk/engine';
import type { Command } from '@ftk/engine';

const cardLabel = (id: string) => cardNameZh(id);

// 自己的角色牌面板（常显，含技能说明）
const YourCharacter: React.FC<{ view: PlayerView; acting: boolean }> = ({ view, acting }) => {
  const cid = view.you.characterId;
  if (!cid) return null;
  const def = CHARACTER_MAP[cid];
  if (!def) return null;
  const face = characterFaceUrl(cid);
  return (
    <div className={`panel char-panel ${view.you.characterRevealed ? 'revealed' : ''}`}>
      <div className="panel-title">
        {acting ? '🤖 代打角色的牌' : '🎭 你的角色牌'}
        {view.you.characterRevealed ? '（已亮出）' : '（背面）'}
      </div>
      <div className="char-body">
        {face && <img className="char-face" src={face} alt={def.nameZh} />}
        <div className="char-info">
          <div className="char-name">{def.nameZh}</div>
          <div className="card-text">{def.textZh}</div>
        </div>
      </div>
    </div>
  );
};

export const GameView: React.FC<{
  session: SessionInfo;
  full: RoomFullView;
  onLeave: () => void;
}> = ({ session, full, onLeave }) => {
  const view = full.game!;
  const [chatText, setChatText] = useState('');
  const [err, setErr] = useState('');
  const [actingSeat, setActingSeat] = useState<number | null>(null); // 代打的机器人座位
  const logRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  // 盘面皮肤（热插拔）：选择持久化到 localStorage，切换即时生效
  const [skinId, setSkinId] = useState<string>(() => {
    try {
      return localStorage.getItem(SKIN_STORAGE_KEY) ?? DEFAULT_SKIN_ID;
    } catch {
      return DEFAULT_SKIN_ID;
    }
  });
  const skin = getSkin(skinId);
  const Board = skin.Component;
  const map = useMemo(() => getMap(view.mapId), [view.mapId]);
  const changeSkin = (id: string) => {
    setSkinId(id);
    try {
      localStorage.setItem(SKIN_STORAGE_KEY, id);
    } catch {
      /* 隐私模式等场景下忽略 */
    }
  };
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [full.log.length]);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [full.chat.length]);

  const botViews = full.botViews ?? {};
  const botSeats = Object.keys(botViews)
    .map(Number)
    .sort((a, b) => a - b);
  const activeView = actingSeat !== null && botViews[actingSeat] ? botViews[actingSeat] : view;

  const onCommand = async (c: Command) => {
    setErr('');
    await sendCommand(getSocket(session.roomId), c, actingSeat ?? undefined);
  };

  return (
    <div className="game">
      <header className="topbar">
        <span className="title">⚓ 险恶疑航</span>
        <span className="room-id">房间 {session.roomId}</span>
        <span className="stage">
          第 {view.round} 轮 · {view.stageZh}
        </span>
        <span className="waiting">{view.waitingFor}</span>
        <button className="btn small" onClick={onLeave}>
          退出
        </button>
      </header>
      {err && <div className="err">⚠ {err}</div>}
      <div className="game-main">
        <div className="col left">
          <PlayersPanel view={view} />
        </div>
        <div className="col mid">
          <div className="board-bar">
            <select
              className="skin-select"
              value={skinId}
              onChange={(e) => changeSkin(e.target.value)}
              title="切换盘面皮肤（即时生效）"
            >
              {BOARD_SKINS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameZh}
                </option>
              ))}
            </select>
            <Suspense fallback={<div className="panel board-loading">🗺️ 盘面加载中…</div>}>
              <Board view={view} map={map} />
            </Suspense>
          </div>
          <div className="deck-info">
            <span className="pill">🂠 抽牌堆 <b>{view.navDeckCount}</b></span>
            <span className="pill">🌊 弃牌堆 <b>{view.navDiscardCount}</b></span>
            {view.ritualsRevealed.length > 0 && <span className="pill">🔮 已揭示仪式：{view.ritualsRevealed.join('、')}</span>}
          </div>
          {botSeats.length > 0 && (
            <div className="bot-switch">
              <span className="hint">代打对象：</span>
              <button
                className={`btn small ${actingSeat === null ? 'sel' : ''}`}
                onClick={() => setActingSeat(null)}
              >
                自己
              </button>
              {botSeats.map((sid) => (
                <button
                  key={sid}
                  className={`btn small ${actingSeat === sid ? 'sel' : ''}`}
                  onClick={() => setActingSeat(sid)}
                >
                  {view.players.find((p) => p.seatId === sid)?.name ?? `P${sid + 1}`}
                  {botViews[sid].pending.some((p) => p.mine) ? ' ●' : ''}
                </button>
              ))}
            </div>
          )}
          <YourCharacter view={activeView} acting={actingSeat !== null} />
          <ActionPanel key={`${actingSeat ?? 'me'}-${activeView.stage}`} view={activeView} onCommand={onCommand} onError={setErr} />
          {activeView.yourHand.length > 0 && (
            <div className="hand-strip">
              <span className="hint">
                {actingSeat !== null ? '该机器人' : '你'}的手牌（{activeView.yourHand.length} 张，保密）·
                保留的牌将被执行：
              </span>
              {activeView.yourHand.map((c) => (
                <span key={c} className="minicard">
                  {cardLabel(c)}
                  <small> {destinationText(activeView, c)}</small>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="col right">
          <div className="panel">
            <div className="panel-title">📜 航海日志</div>
            <div className="log" ref={logRef}>
              {full.log.map((l) => (
                <div key={l.id} className="log-line">
                  {l.textZh}
                </div>
              ))}
            </div>
          </div>
          <div className="panel">
            <div className="panel-title">💬 船员频道</div>
            <div className="log chat" ref={chatRef}>
              {full.chat.map((m) => (
                <div key={m.id} className="chat-line">
                  <b>{m.name}：</b>
                  {m.text}
                </div>
              ))}
            </div>
            <form
              className="chat-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!chatText.trim()) return;
                try {
                  await sendChat(getSocket(session.roomId), chatText.trim());
                  setChatText('');
                } catch (ex) {
                  setErr((ex as Error).message);
                }
              }}
            >
              <input value={chatText} onChange={(e) => setChatText(e.target.value)} maxLength={200} placeholder="与船员对话…" />
              <button className="btn small" type="submit">
                发送
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

