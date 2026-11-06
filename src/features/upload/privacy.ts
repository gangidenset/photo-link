// 位置情報 (GPS) の除去
//   写真の EXIF には撮影場所の緯度経度が含まれることがある。
//   プライバシー保護のため、アップロード前に端末内で位置情報だけを 0 で塗りつぶす。
//   ファイルのバイト長は変えないため、画像の構造や他の情報 (向き・撮影日時) は壊れない。

// ---------------------------------------------------------------- TIFF (EXIF 本体)
const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const GPS_IFD_TAG = 0x8825;

/**
 * TIFF 構造内の GPS IFD を空にする。
 * @param buf ファイル全体
 * @param tiffStart TIFF ヘッダ (II*\0 / MM\0*) の開始位置
 * @param tiffEnd TIFF データの終端 (範囲外アクセス防止)
 * @returns GPS 情報を消去したら true
 */
export function zeroGpsInTiff(buf: Uint8Array, tiffStart: number, tiffEnd = buf.length): boolean {
  if (tiffStart + 8 > tiffEnd) return false;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const order = String.fromCharCode(buf[tiffStart], buf[tiffStart + 1]);
  if (order !== 'II' && order !== 'MM') return false;
  const le = order === 'II';
  if (view.getUint16(tiffStart + 2, le) !== 42) return false;

  const u16 = (o: number) => view.getUint16(o, le);
  const u32 = (o: number) => view.getUint32(o, le);
  const inRange = (o: number, len: number) => o >= tiffStart && o + len <= tiffEnd;

  const ifd0 = tiffStart + u32(tiffStart + 4);
  if (!inRange(ifd0, 2)) return false;
  const n0 = u16(ifd0);
  let changed = false;

  for (let i = 0; i < n0; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (!inRange(entry, 12)) break;
    if (u16(entry) !== GPS_IFD_TAG) continue;

    const gps = tiffStart + u32(entry + 8);
    if (!inRange(gps, 2)) continue;
    const n = u16(gps);
    for (let j = 0; j < n; j++) {
      const e = gps + 2 + j * 12;
      if (!inRange(e, 12)) break;
      const size = (TYPE_SIZES[u16(e + 2)] ?? 1) * u32(e + 4);
      if (size > 4) {
        const dataOff = tiffStart + u32(e + 8);
        if (inRange(dataOff, size)) buf.fill(0, dataOff, dataOff + size);
      }
      buf.fill(0, e, e + 12);
    }
    // エントリ数を 0 にする (空の GPS IFD として有効な構造を保つ)
    if (inRange(gps, 2)) view.setUint16(gps, 0, le);
    changed = true;
  }
  return changed;
}

// ---------------------------------------------------------------- XMP 内の GPS
const XMP_GPS_RE = /(exif:GPS[A-Za-z]+)(="[^"]*"|>[^<]*<)/g;

function blankXmpGps(buf: Uint8Array, start: number, end: number): boolean {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(buf[i]);
  let changed = false;
  for (const m of s.matchAll(XMP_GPS_RE)) {
    const valueStart = start + (m.index ?? 0) + m[1].length + 2;
    const valueLen = m[2].length - 3;
    if (valueLen > 0) {
      buf.fill(0x20, valueStart, valueStart + valueLen);
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------- 形式別
function stripJpeg(buf: Uint8Array): boolean {
  let changed = false;
  let o = 2;
  while (o + 4 <= buf.length) {
    if (buf[o] !== 0xff) break;
    const marker = buf[o + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS 以降は画像データ
    if (marker >= 0xd0 && marker <= 0xd7) {
      o += 2;
      continue;
    }
    const len = (buf[o + 2] << 8) | buf[o + 3];
    const segStart = o + 4;
    const segEnd = Math.min(o + 2 + len, buf.length);
    if (marker === 0xe1) {
      const header = String.fromCharCode(...buf.subarray(segStart, Math.min(segStart + 29, segEnd)));
      if (header.startsWith('Exif\0\0')) {
        changed = zeroGpsInTiff(buf, segStart + 6, segEnd) || changed;
      } else if (header.startsWith('http://ns.adobe.com/xap/1.0/')) {
        changed = blankXmpGps(buf, segStart, segEnd) || changed;
      }
    }
    o = o + 2 + len;
  }
  return changed;
}

/** "Exif\0\0" に続く TIFF ヘッダをファイル全体から探す (HEIC など) */
function stripByExifMarker(buf: Uint8Array): boolean {
  let changed = false;
  for (let i = 0; i + 14 < buf.length; i++) {
    if (
      buf[i] === 0x45 && buf[i + 1] === 0x78 && buf[i + 2] === 0x69 && buf[i + 3] === 0x66 &&
      buf[i + 4] === 0 && buf[i + 5] === 0
    ) {
      changed = zeroGpsInTiff(buf, i + 6) || changed;
    }
  }
  return changed;
}

function stripWebp(buf: Uint8Array): boolean {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let changed = false;
  let o = 12;
  while (o + 8 <= buf.length) {
    const type = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
    const size = view.getUint32(o + 4, true);
    const data = o + 8;
    const end = Math.min(data + size, buf.length);
    if (type === 'EXIF') {
      const hasPrefix = String.fromCharCode(...buf.subarray(data, data + 6)) === 'Exif\0\0';
      changed = zeroGpsInTiff(buf, hasPrefix ? data + 6 : data, end) || changed;
    } else if (type === 'XMP ') {
      changed = blankXmpGps(buf, data, end) || changed;
    }
    o = data + size + (size % 2);
  }
  return changed;
}

function stripPng(buf: Uint8Array): boolean {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let changed = false;
  let o = 8;
  while (o + 12 <= buf.length) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
    const data = o + 8;
    if (type === 'eXIf') changed = zeroGpsInTiff(buf, data, data + len) || changed;
    if (type === 'IEND') break;
    o = data + len + 4; // + CRC
  }
  // 注: PNG の CRC は再計算しない (多くのデコーダは補助チャンクの CRC 不一致を無視する)
  return changed;
}

/** 画像バイト列から GPS 情報を除去する (その場で書き換え) */
export function stripImageGps(buf: Uint8Array, mime: string): boolean {
  switch (mime) {
    case 'image/jpeg':
      return stripJpeg(buf);
    case 'image/webp':
      return stripWebp(buf);
    case 'image/png':
      return stripPng(buf);
    case 'image/heic':
    case 'image/heif':
      return stripByExifMarker(buf);
    default:
      return false;
  }
}

// ---------------------------------------------------------------- 動画 (MP4 / MOV)
// 位置情報は moov ボックス内の ©xyz や com.apple.quicktime.location.ISO6709 に入る。
// 動画全体を読み込むとメモリを使うため、moov ボックスだけを読み込んで書き換え、
// 残りの部分は元ファイルの Blob をそのまま使って合成する (コピーしない)。

const ISO6709_RE = /[+-]\d{1,2}\.\d+[+-]\d{1,3}\.\d+(?:[+-]\d+(?:\.\d+)?)?(?:CRS[^/]*)?\//g;

/** moov の中身から位置情報を消去 */
export function stripMoovLocation(moov: Uint8Array): boolean {
  let changed = false;
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  // ©xyz ボックス (A9 'x' 'y' 'z')
  for (let i = 4; i + 4 <= moov.length; i++) {
    if (moov[i] === 0xa9 && moov[i + 1] === 0x78 && moov[i + 2] === 0x79 && moov[i + 3] === 0x7a) {
      const size = view.getUint32(i - 4);
      const end = i - 4 + size;
      // 誤検出防止: 妥当なサイズ (12〜512 バイト) で、文字列長がボックスに収まる場合のみ
      if (size >= 12 && size <= 512 && end <= moov.length && view.getUint16(i + 4) + 12 <= size) {
        moov.fill(0x20, i + 8, end); // 長さ・言語コード以降の座標文字列を空白に
        changed = true;
      }
    }
  }
  // ISO 6709 形式の座標文字列 (Apple の mdta メタデータ)
  const keyIdx = indexOfAscii(moov, 'com.apple.quicktime.location');
  if (keyIdx >= 0) {
    let s = '';
    for (let i = 0; i < moov.length; i++) s += String.fromCharCode(moov[i]);
    for (const m of s.matchAll(ISO6709_RE)) {
      moov.fill(0x20, m.index!, m.index! + m[0].length);
      changed = true;
    }
  }
  return changed;
}

function indexOfAscii(buf: Uint8Array, needle: string): number {
  const first = needle.charCodeAt(0);
  outer: for (let i = 0; i + needle.length <= buf.length; i++) {
    if (buf[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) if (buf[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

/** mvhd ボックスから作成日時 (撮影日時) を読む */
export function readMvhdCreationTime(moov: Uint8Array): Date | null {
  const idx = indexOfAscii(moov, 'mvhd');
  if (idx < 0 || idx + 16 > moov.length) return null;
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const version = moov[idx + 4];
  let secs: number;
  if (version === 1) {
    if (idx + 16 > moov.length) return null;
    secs = Number(view.getBigUint64(idx + 8));
  } else {
    secs = view.getUint32(idx + 8);
  }
  if (!secs) return null;
  const d = new Date((secs - 2082844800) * 1000); // 1904-01-01 起点 → UNIX 時刻
  return d.getFullYear() > 1970 ? d : null;
}

interface BoxRef {
  offset: number;
  size: number;
}

async function findTopLevelBox(file: Blob, type: string): Promise<BoxRef | null> {
  let offset = 0;
  for (let guard = 0; guard < 1000 && offset + 8 <= file.size; guard++) {
    const head = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
    let size = head.getUint32(0);
    const t = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    if (size === 1 && head.byteLength >= 16) size = Number(head.getBigUint64(8));
    else if (size === 0) size = file.size - offset;
    if (size < 8) return null;
    if (t === type) return { offset, size };
    offset += size;
  }
  return null;
}

const MAX_MOOV_BYTES = 64 * 1024 * 1024;

/**
 * 動画の位置情報を除去した Blob と撮影日時を返す。
 * moov が見つからない・大きすぎる場合は元の Blob を返す (locationStripped: false)。
 */
export async function processVideo(
  file: Blob,
  mime: string,
): Promise<{ blob: Blob; takenAt: Date | null; locationStripped: boolean }> {
  if (mime !== 'video/mp4' && mime !== 'video/quicktime') {
    return { blob: file, takenAt: null, locationStripped: false };
  }
  const moovRef = await findTopLevelBox(file, 'moov');
  if (!moovRef || moovRef.size > MAX_MOOV_BYTES) return { blob: file, takenAt: null, locationStripped: false };
  const moov = new Uint8Array(await file.slice(moovRef.offset, moovRef.offset + moovRef.size).arrayBuffer());
  const takenAt = readMvhdCreationTime(moov);
  const changed = stripMoovLocation(moov);
  if (!changed) return { blob: file, takenAt, locationStripped: true };
  const blob = new Blob(
    [file.slice(0, moovRef.offset), moov, file.slice(moovRef.offset + moovRef.size)],
    { type: mime },
  );
  return { blob, takenAt, locationStripped: true };
}
