// 端末にある写真との照合
//   ブラウザはスマホの写真フォルダを勝手に読めないため、ユーザーに写真 (PC はフォルダ) を選んでもらい、
//   アルバムの写真と「見た目の指紋」で比較して、実際に持っている写真を判定する。
//   選んだファイルは端末内で縮小して指紋を作るだけで、どこにも送信しない。
import { getSignedUrl } from '@/lib/signedUrls';
import type { Photo } from '@/types/db';
import { dhashFromSource, isSamePhoto } from './phash';

export interface Fingerprint {
  hash: string;
  /** 縦横比 (幅 / 高さ) */
  ratio: number;
}

const CONCURRENCY = 2;

async function runPool<T, R>(items: T[], fn: (item: T) => Promise<R>, onProgress: (done: number, total: number) => void): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  onProgress(0, items.length);
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
      onProgress(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_decode_failed'));
    img.src = src;
  });
}

async function imageFingerprint(file: Blob): Promise<Fingerprint | null> {
  // 縮小しながら読み込める環境では小さく読み込む (メモリ節約)
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { resizeWidth: 64, resizeQuality: 'medium', imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      bitmap = null;
    }
  }
  if (bitmap) {
    try {
      // 縦横比は縮小前と同じ (resizeWidth のみ指定すると高さは比率を保って決まる)
      return { hash: dhashFromSource(bitmap, bitmap.width, bitmap.height), ratio: bitmap.width / bitmap.height };
    } finally {
      bitmap.close();
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return { hash: dhashFromSource(img, img.naturalWidth, img.naturalHeight), ratio: img.naturalWidth / img.naturalHeight };
  } catch {
    return null; // この端末で読めない形式
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 動画はサムネイルと同じ位置 (0.5 秒、短い動画は半分) のフレームで比較する */
function videoFingerprint(file: Blob): Promise<Fingerprint | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let done = false;
    const finish = (r: Fingerprint | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const timer = setTimeout(() => finish(null), 10_000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      try {
        if (!video.videoWidth) return finish(null);
        finish({ hash: dhashFromSource(video, video.videoWidth, video.videoHeight), ratio: video.videoWidth / video.videoHeight });
      } catch {
        finish(null);
      }
    };
    video.onerror = () => finish(null);
    video.src = url;
    video.load();
  });
}

function isVideoFile(f: File) {
  return f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(f.name);
}
function isMediaFile(f: File) {
  return isVideoFile(f) || f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name);
}

/** 端末で選んだファイルの指紋 (読めないファイルは除外) */
export async function fingerprintDeviceFiles(files: File[], onProgress: (done: number, total: number) => void): Promise<Fingerprint[]> {
  const media = files.filter(isMediaFile);
  const results = await runPool(media, (f) => (isVideoFile(f) ? videoFingerprint(f) : imageFingerprint(f)), onProgress);
  return results.filter((r): r is Fingerprint => r !== null);
}

// アルバムの写真の指紋 (アップロード時に保存した値。古い写真はサムネイルから計算してキャッシュ)
const albumCache = new Map<string, Fingerprint | null>();

async function albumPhotoFingerprint(photo: Photo): Promise<Fingerprint | null> {
  if (albumCache.has(photo.id)) return albumCache.get(photo.id)!;
  let fp: Fingerprint | null = null;
  if (photo.phash && photo.width && photo.height) {
    fp = { hash: photo.phash, ratio: photo.width / photo.height };
  } else if (photo.thumb_path) {
    try {
      const img = await loadImage(await getSignedUrl('photos', photo.thumb_path), true);
      fp = { hash: dhashFromSource(img, img.naturalWidth, img.naturalHeight), ratio: img.naturalWidth / img.naturalHeight };
    } catch {
      fp = null;
    }
  }
  albumCache.set(photo.id, fp);
  return fp;
}

export async function fingerprintAlbumPhotos(
  photos: Photo[],
  onProgress: (done: number, total: number) => void,
): Promise<Map<string, Fingerprint | null>> {
  const results = await runPool(photos, albumPhotoFingerprint, onProgress);
  return new Map(photos.map((p, i) => [p.id, results[i]]));
}

/** 端末に同じ写真があるアルバムの写真 ID */
export function findOwned(album: Map<string, Fingerprint | null>, device: Fingerprint[]): Set<string> {
  const owned = new Set<string>();
  for (const [id, fp] of album) {
    if (fp && device.some((d) => isSamePhoto(fp, d))) owned.add(id);
  }
  return owned;
}

/** フォルダ選択 (webkitdirectory) が使えるか。スマホでは使えないことが多いため PC のみ */
export function supportsFolderPick(): boolean {
  return 'webkitdirectory' in document.createElement('input') && !window.matchMedia('(pointer: coarse)').matches;
}
