// 複数の写真・動画をまとめて保存する
//   iPhone : 共有シートを開き「N 枚の画像を保存」で写真アプリにまとめて保存
//            (Safari はタップ直後しか共有シートを開けないため ①取得 → ②タップで共有 の 2 段階)
//   Android: 1 件ずつ自動でダウンロード (ギャラリーアプリから見える場所に保存される)
//   PC     : ZIP ファイル 1 つにまとめてダウンロード
import { getSignedUrl } from '@/lib/signedUrls';
import { canShareFiles, isAndroid, isIOS } from '@/lib/platform';
import type { Photo } from '@/types/db';
import { filenameFor, triggerDownload } from './download';

/** 1 回で保存できる件数 (スマホのメモリ不足を防ぐ) */
export const BULK_DOWNLOAD_MAX = 50;
/** 共有シートで渡す合計サイズの上限 */
const SHARE_MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const FETCH_CONCURRENCY = 3;

export type BulkMethod = 'share' | 'sequential' | 'zip';

export function bulkMethod(photos: Photo[]): BulkMethod {
  const total = photos.reduce((n, p) => n + p.size_bytes, 0);
  if (isIOS() && total <= SHARE_MAX_TOTAL_BYTES && canShareFiles(photos.slice(0, 2).map((p) => new File([], filenameFor(p), { type: p.mime_type })))) {
    return 'share';
  }
  if (isAndroid()) return 'sequential';
  return 'zip';
}

/** 同じファイル名が重ならないよう「名前 (2).jpg」のように番号を付ける */
export function uniqueNames(photos: Photo[]): string[] {
  const used = new Map<string, number>();
  return photos.map((p) => {
    const name = filenameFor(p);
    const key = name.toLowerCase();
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    if (n === 0) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${n + 1})${name.slice(dot)}` : `${name} (${n + 1})`;
  });
}

async function fetchBlob(photo: Photo): Promise<Blob> {
  const url = await getSignedUrl('photos', photo.storage_path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download_failed status: ${res.status}`);
  return res.blob();
}

/** オリジナルを同時 3 件ずつ取得して File にする */
export async function fetchFiles(photos: Photo[], onProgress: (done: number, total: number) => void): Promise<File[]> {
  const names = uniqueNames(photos);
  const files: File[] = new Array(photos.length);
  let next = 0;
  let done = 0;
  onProgress(0, photos.length);
  async function worker() {
    while (next < photos.length) {
      const i = next++;
      const blob = await fetchBlob(photos[i]);
      files[i] = new File([blob], names[i], { type: photos[i].mime_type, lastModified: Date.parse(photos[i].taken_at ?? photos[i].created_at) });
      onProgress(++done, photos.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, photos.length) }, worker));
  return files;
}

/** iPhone: 共有シートでまとめて渡す (タップのイベント内で呼ぶこと)。共有できなければ ZIP で保存 */
export async function shareFiles(files: File[], zipName: string): Promise<'shared' | 'canceled' | 'zipped'> {
  try {
    await navigator.share({ files });
    return 'shared';
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'canceled';
    await saveZip(files, zipName);
    return 'zipped';
  }
}

/** Android: 署名付きダウンロード URL を 1 件ずつ開く */
export async function downloadSequential(photos: Photo[], onProgress: (done: number, total: number) => void): Promise<void> {
  const names = uniqueNames(photos);
  onProgress(0, photos.length);
  for (let i = 0; i < photos.length; i++) {
    const url = await getSignedUrl('photos', photos[i].storage_path, { download: names[i] });
    triggerDownload(url, names[i]);
    onProgress(i + 1, photos.length);
    // 連続で開くとブラウザに間引かれるため少し待つ
    await new Promise((r) => setTimeout(r, 700));
  }
}

/** PC: ZIP にまとめて保存 (写真は圧縮済みのため無圧縮で格納し、処理を軽くする) */
export async function saveZip(files: File[], zipName: string): Promise<void> {
  const { zipSync } = await import('fflate');
  const entries: Record<string, [Uint8Array, { level: 0; mtime: number }]> = {};
  for (const f of files) {
    entries[f.name] = [new Uint8Array(await f.arrayBuffer()), { level: 0, mtime: f.lastModified || Date.now() }];
  }
  const zipped = zipSync(entries);
  const url = URL.createObjectURL(new Blob([zipped as BlobPart], { type: 'application/zip' }));
  triggerDownload(url, zipName);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function zipNameFor(albumTitle: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${albumTitle.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'PhotoLink'}_${ymd}.zip`;
}
