// ============================================================
// 回合提醒（T3）：标题闪烁 + toast + WebAudio 提示音 + 可选桌面通知。
// 无第三方依赖；音效由振荡器合成，无音频资产。
// ============================================================

export interface NotifySettings {
  sound: boolean;
  desktop: boolean;
}

const SETTINGS_KEY = 'ftk_notify';

export function loadNotifySettings(): NotifySettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { sound: raw.sound !== false, desktop: raw.desktop === true };
  } catch {
    return { sound: true, desktop: false };
  }
}

export function saveNotifySettings(s: NotifySettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等场景下忽略 */
  }
}

/** 请求桌面通知权限（用户在设置里开启时调用） */
export async function requestDesktopPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const p = await Notification.requestPermission();
  return p === 'granted';
}

/** 标题闪烁：3 个周期后恢复；页面可见时立即恢复 */
function flashTitle(reasonZh: string): void {
  const original = document.title;
  let on = false;
  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
    on = !on;
    document.title = on ? `🎯 ${reasonZh.slice(0, 12)} · 险恶疑航` : original;
    if (ticks >= 6 || document.visibilityState === 'visible') {
      clearInterval(timer);
      document.title = original;
    }
  }, 900);
  const restore = () => {
    clearInterval(timer);
    document.title = original;
  };
  document.addEventListener('visibilitychange', restore, { once: true });
}

/** toast：右下角滑入提示卡片 */
function showToast(reasonZh: string): void {
  const host = document.body;
  const el = document.createElement('div');
  el.className = 'myturn-toast';
  el.innerHTML = '<b>🎯 轮到你了</b><span></span>';
  (el.querySelector('span') as HTMLElement).textContent = reasonZh;
  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  };
  el.addEventListener('click', dismiss);
  host.appendChild(el);
  setTimeout(dismiss, 6000);
}

/** WebAudio 合成短促双音 */
function playChime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [660, 880]; // E5 → A5 双音
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* 音频不可用时静默失败 */
  }
}

/** 当「我需要行动」从 false → true 跳变时调用 */
export function notifyMyTurn(reasonZh: string, settings: NotifySettings): void {
  if (document.visibilityState !== 'visible') flashTitle(reasonZh);
  if (document.visibilityState !== 'visible' || settings.sound) {
    // 页面可见时靠 toast+声音；不可见时靠标题闪烁+（可选）桌面通知
  }
  showToast(reasonZh);
  if (settings.sound) playChime();
  if (settings.desktop && document.visibilityState !== 'visible' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification('险恶疑航 · 轮到你了', { body: reasonZh.slice(0, 60), tag: 'ftk-turn' });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* 通知不可用时忽略 */
    }
  }
}
