// アップロードする写真の画質設定 (端末ごとに保存)
//   original: 元の画質のまま保存 (画質優先)
//   standard: 長辺 2048px の JPEG に縮小して保存 (容量優先。スマホで見る分には差はほぼ分からない)
//   ※ 動画は対象外 (ブラウザ内での圧縮は時間と電池を大きく使うため)
import { create } from 'zustand';

export type UploadQuality = 'original' | 'standard';

export const STANDARD_MAX_EDGE = 2048;
export const STANDARD_JPEG_QUALITY = 0.85;
/** 1 枚あたりの目安サイズ (容量の案内表示用) */
export const APPROX_BYTES: Record<UploadQuality, number> = {
  original: 3.3 * 1024 * 1024,
  standard: 0.7 * 1024 * 1024,
};

const KEY = 'photolink.uploadQuality';

function read(): UploadQuality {
  try {
    return localStorage.getItem(KEY) === 'original' ? 'original' : 'standard';
  } catch {
    return 'standard';
  }
}

export const useUploadQuality = create<{ quality: UploadQuality; setQuality: (q: UploadQuality) => void }>((set) => ({
  quality: read(),
  setQuality(quality) {
    try {
      localStorage.setItem(KEY, quality);
    } catch {
      /* private mode など */
    }
    set({ quality });
  },
}));

/** 縦横比を保って長辺を max 以下にしたサイズ (元が小さければそのまま) */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
