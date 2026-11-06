// 写真ビューアのタッチ操作
//   ・左右スワイプ: 前後の写真へ
//   ・下スワイプ: 閉じる
//   ・ピンチ / ダブルタップ: 拡大・縮小 (拡大中はドラッグで移動)
//   ・シングルタップ: 操作ボタンの表示切替
import { useCallback, useRef, useState, type PointerEvent } from 'react';

interface Options {
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onTap: () => void;
}

export interface GestureState {
  scale: number;
  x: number;
  y: number;
  dragX: number;
  dragY: number;
  animating: boolean;
}

const INITIAL: GestureState = { scale: 1, x: 0, y: 0, dragX: 0, dragY: 0, animating: false };

export function useGestures({ onPrev, onNext, onClose, onTap }: Options) {
  const [state, setState] = useState<GestureState>(INITIAL);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef({ x: 0, y: 0, t: 0, scale: 1, dist: 0, px: 0, py: 0, moved: false, axis: '' as '' | 'x' | 'y' });
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const reset = useCallback(() => setState(INITIAL), []);

  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const s = stateRef.current;
    start.current = {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      scale: s.scale,
      dist: pointers.current.size === 2 ? dist() : 0,
      px: s.x,
      py: s.y,
      moved: pointers.current.size > 1,
      axis: '',
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const st = start.current;
    if (pointers.current.size === 2) {
      if (!st.dist) st.dist = dist();
      const scale = Math.min(4, Math.max(1, st.scale * (dist() / st.dist)));
      setState((s) => ({ ...s, scale, animating: false, ...(scale === 1 ? { x: 0, y: 0 } : {}) }));
      st.moved = true;
      return;
    }
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) st.moved = true;
    if (stateRef.current.scale > 1) {
      setState((s) => ({ ...s, x: st.px + dx, y: st.py + dy, animating: false }));
      return;
    }
    if (!st.axis && st.moved) st.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (st.axis === 'x') setState((s) => ({ ...s, dragX: dx, dragY: 0, animating: false }));
    else if (st.axis === 'y' && dy > 0) setState((s) => ({ ...s, dragY: dy, dragX: 0, animating: false }));
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    const st = start.current;
    const s = stateRef.current;
    const elapsed = performance.now() - st.t;

    if (!st.moved && elapsed < 300) {
      const now = performance.now();
      if (now - lastTap.current < 300) {
        // ダブルタップ: タップ位置を中心に拡大 / 元に戻す
        if (tapTimer.current) clearTimeout(tapTimer.current);
        lastTap.current = 0;
        if (s.scale > 1) setState({ ...INITIAL, animating: true });
        else {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const cx = e.clientX - rect.left - rect.width / 2;
          const cy = e.clientY - rect.top - rect.height / 2;
          setState({ ...INITIAL, scale: 2.5, x: -cx * 1.5, y: -cy * 1.5, animating: true });
        }
      } else {
        lastTap.current = now;
        tapTimer.current = setTimeout(onTap, 300);
      }
      return;
    }

    if (s.scale > 1) return;
    const velocity = Math.abs(s.dragX) / Math.max(elapsed, 1);
    if (s.dragX < -70 || (s.dragX < -20 && velocity > 0.5)) {
      setState({ ...INITIAL });
      onNext();
    } else if (s.dragX > 70 || (s.dragX > 20 && velocity > 0.5)) {
      setState({ ...INITIAL });
      onPrev();
    } else if (s.dragY > 120) {
      onClose();
    } else {
      setState({ ...INITIAL, animating: true });
    }
  };

  return {
    state,
    reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
