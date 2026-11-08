// 見やすさの設定 (端末ごとに保存)
//   textSize  : 文字の大きさ。画面全体 (rem 単位) がまとめて拡大される
//   simpleMode: かんたんモード。使う機能だけに絞った大きな表示 (祖父母のスマホ向け)
import { create } from 'zustand';

export type TextSize = 'standard' | 'large' | 'xlarge';

export const TEXT_SIZE_LABEL: Record<TextSize, string> = { standard: '標準', large: '大', xlarge: '特大' };

const KEY_SIZE = 'photolink.textSize';
const KEY_SIMPLE = 'photolink.simpleMode';

function readSize(): TextSize {
  try {
    const v = localStorage.getItem(KEY_SIZE);
    return v === 'large' || v === 'xlarge' ? v : 'standard';
  } catch {
    return 'standard';
  }
}
function readSimple(): boolean {
  try {
    return localStorage.getItem(KEY_SIMPLE) === '1';
  } catch {
    return false;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode など */
  }
}

/** かんたんモードでは文字を「大」以上にする */
export function effectiveTextSize(size: TextSize, simple: boolean): TextSize {
  return simple && size === 'standard' ? 'large' : size;
}

function apply(size: TextSize, simple: boolean) {
  const el = document.documentElement;
  el.dataset.textSize = effectiveTextSize(size, simple);
  el.dataset.simple = simple ? '1' : '0';
}

interface DisplayState {
  textSize: TextSize;
  simpleMode: boolean;
  setTextSize: (s: TextSize) => void;
  setSimpleMode: (v: boolean) => void;
}

export const useDisplay = create<DisplayState>((set, get) => ({
  textSize: readSize(),
  simpleMode: readSimple(),
  setTextSize(textSize) {
    save(KEY_SIZE, textSize);
    apply(textSize, get().simpleMode);
    set({ textSize });
  },
  setSimpleMode(simpleMode) {
    save(KEY_SIMPLE, simpleMode ? '1' : '0');
    apply(get().textSize, simpleMode);
    set({ simpleMode });
  },
}));

export const useSimpleMode = () => useDisplay((s) => s.simpleMode);

export function initDisplay() {
  const { textSize, simpleMode } = useDisplay.getState();
  apply(textSize, simpleMode);
}
