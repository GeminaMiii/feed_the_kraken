// ============================================================
// T12 无障碍：弹窗通用 hook。
// - Escape 关闭
// - Tab/Shift+Tab 焦点圈闭（focus trap）
// - 打开时自动聚焦容器内首个可聚焦元素，关闭后焦点还原到触发元素
// 用法：useModalDismiss(ref, active, onClose)——active 为弹窗开启状态，
// effect 随 active 重跑，保证每次打开都聚焦、每次关闭都还原。
// ============================================================

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalDismiss(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose; // 每次渲染同步最新闭包，避免固化

  useEffect(() => {
    if (!active) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // 打开时聚焦：容器内第一个可聚焦元素，退化到容器本身（需 tabIndex={-1}）
    const first = el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus?.();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      // 焦点圈闭：Tab 循环限制在容器内
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const idx = items.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      if (e.shiftKey) {
        items[(idx <= 0 ? items.length : idx) - 1].focus();
      } else {
        items[(idx + 1) % items.length].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
