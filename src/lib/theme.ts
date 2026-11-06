// テーマ (ライト / ダーク / システムに合わせる)
import { create } from 'zustand';

export type ThemePref = 'system' | 'light' | 'dark';

function read(): ThemePref {
  try {
    const v = localStorage.getItem('photolink.theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && media?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#121110' : '#faf9f7'));
}

export const useTheme = create<{ pref: ThemePref; setPref: (p: ThemePref) => void }>((set) => ({
  pref: read(),
  setPref(pref) {
    try {
      localStorage.setItem('photolink.theme', pref);
    } catch {
      /* ignore */
    }
    apply(pref);
    set({ pref });
  },
}));

export function initTheme() {
  apply(useTheme.getState().pref);
  media?.addEventListener('change', () => apply(useTheme.getState().pref));
}
