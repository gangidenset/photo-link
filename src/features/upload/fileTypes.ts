import type { MediaType } from '@/types/db';

// 許可するファイル形式 (DB の CHECK 制約・Storage バケットの設定と一致させる)
const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

const ALLOWED = new Set(Object.values(EXT_TO_MIME));

// 端末によって file.type が空・別名になることがあるため正規化する
const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/heic-sequence': 'image/heic',
  'image/heif-sequence': 'image/heif',
  'video/x-m4v': 'video/mp4',
  'video/mov': 'video/quicktime',
};

export interface DetectedType {
  mime: string;
  mediaType: MediaType;
}

/** ファイルの先頭バイト (マジックナンバー) から形式を判定 */
export function sniffMime(head: Uint8Array): string | null {
  const b = head;
  const ascii = (start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
  if (b.length >= 6 && ascii(0, 4) === 'GIF8') return 'image/gif';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (b.length >= 12 && ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1', 'avif'].includes(brand)) return brand === 'avif' ? null : 'image/heif';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  return null;
}

/** file.type → 拡張子 → マジックナンバーの順に判定し、許可形式なら返す */
export async function detectType(file: File): Promise<DetectedType | null> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const sniffed = sniffMime(head);
  let mime = MIME_ALIASES[file.type] ?? file.type;
  if (!ALLOWED.has(mime)) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    mime = EXT_TO_MIME[ext] ?? '';
  }
  // 中身と宣言が食い違う場合は中身を優先 (拡張子偽装対策)
  if (sniffed && ALLOWED.has(sniffed) && sniffed !== mime) {
    const bothVideo = sniffed.startsWith('video/') && mime.startsWith('video/');
    if (!bothVideo) mime = sniffed;
  }
  if (!sniffed && mime && !mime.startsWith('video/')) return null; // 画像なのに署名が不明 → 不正
  if (!ALLOWED.has(mime)) return null;
  return { mime, mediaType: mime.startsWith('video/') ? 'video' : 'image' };
}

export const ACCEPT_ATTR = 'image/*,video/*,.heic,.heif';
