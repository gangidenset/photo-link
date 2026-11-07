// 写真・動画のダウンロード
//   iPhone など: <a download> では「写真」アプリに保存できないため、共有シート (Web Share API) を使い
//                「画像を保存」「ビデオを保存」を選べるようにする。
//                Safari は「タップ直後」でないと共有シートを開けないため、
//                ① ファイルを取得 → ② 「保存」ボタンをタップして共有シート、の 2 段階にする。
//   Android / PC: 署名付きダウンロード URL (Content-Disposition: attachment) を開く。
//   ※ 分岐は端末名ではなく「ファイル共有ができるか」で判定する。
import { getSignedUrl } from '@/lib/signedUrls';
import { canShareFiles, isTouchDevice } from '@/lib/platform';
import type { Photo } from '@/types/db';

const SHARE_MAX_BYTES = 200 * 1024 * 1024;

export function filenameFor(photo: Photo): string {
  const ext = photo.storage_path.split('.').pop() ?? 'jpg';
  const base = photo.original_filename?.replace(/\.[^.]+$/, '') || `photolink-${photo.id.slice(0, 8)}`;
  return `${base.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
}

/** 共有シートで保存する方式を使うか */
export function prefersShareSheet(photo: Photo): boolean {
  if (!isTouchDevice() || photo.size_bytes > SHARE_MAX_BYTES || typeof navigator.canShare !== 'function') return false;
  return canShareFiles([new File([], filenameFor(photo), { type: photo.mime_type })]);
}

/** ① オリジナルを取得して File にする */
export async function fetchOriginalFile(photo: Photo): Promise<File> {
  const url = await getSignedUrl('photos', photo.storage_path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download_failed status: ${res.status}`);
  const blob = await res.blob();
  return new File([blob], filenameFor(photo), { type: photo.mime_type });
}

/** ② 共有シートを開く (タップのイベント内で呼ぶこと) */
export async function shareFile(file: File): Promise<'shared' | 'canceled' | 'downloaded'> {
  try {
    await navigator.share({ files: [file] });
    return 'shared';
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'canceled';
    const url = URL.createObjectURL(file);
    triggerDownload(url, file.name);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return 'downloaded';
  }
}

/** 通常のダウンロード (Android / PC) */
export async function directDownload(photo: Photo): Promise<void> {
  const name = filenameFor(photo);
  const url = await getSignedUrl('photos', photo.storage_path, { download: name });
  triggerDownload(url, name);
}

export function triggerDownload(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
