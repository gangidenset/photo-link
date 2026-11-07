// 写真・動画の前処理: 撮影日時、指紋 (重複判定用ハッシュ)、サムネイル生成
import type { MediaType } from '@/types/db';
import { processVideo, stripImageGps } from './privacy';
import { dhashFromSource } from '@/features/photos/phash';
import { STANDARD_JPEG_QUALITY, STANDARD_MAX_EDGE, type UploadQuality } from './quality';

const THUMB_MAX = 480;
const PREVIEW_MAX = 1600;

export interface PreparedMedia {
  /** アップロードするオリジナル (位置情報除去済み。容量優先なら縮小した JPEG) */
  original: Blob;
  /** オリジナルの形式 (容量優先で縮小した場合は image/jpeg) */
  mime: string;
  contentHash: string;
  takenAt: Date | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  thumb: Blob | null;
  preview: Blob | null;
  /** 見た目の指紋 (端末の写真との照合用) */
  phash: string | null;
}

function safeHash(source: CanvasImageSource, w: number, h: number): string | null {
  try {
    return dhashFromSource(source, w, h);
  } catch {
    return null;
  }
}

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 動画の指紋: 全体を読むとメモリを使うため「サイズ + 先頭 1MB + 末尾 1MB」のハッシュ */
async function videoFingerprint(file: Blob): Promise<string> {
  const MB = 1024 * 1024;
  const head = await file.slice(0, MB).arrayBuffer();
  const tail = await file.slice(Math.max(0, file.size - MB)).arrayBuffer();
  const merged = new Uint8Array(head.byteLength + tail.byteLength);
  merged.set(new Uint8Array(head), 0);
  merged.set(new Uint8Array(tail), head.byteLength);
  return `vfp:${file.size}:${await sha256Hex(merged)}`;
}

async function readTakenAt(file: Blob): Promise<Date | null> {
  try {
    const exifr = (await import('exifr')).default;
    const tags = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
    const d: unknown = tags?.DateTimeOriginal ?? tags?.CreateDate ?? null;
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 画像のデコード
// 大きな画像を同時に何枚もデコードするとスマートフォンのメモリが不足するため、1 枚ずつ処理する
let decodeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = decodeChain.then(fn, fn);
  decodeChain = run.catch(() => undefined);
  return run;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_decode_failed'));
    };
    img.src = url;
  });
}

async function decodeImage(blob: Blob, mime: string): Promise<HTMLImageElement> {
  try {
    return await loadImage(blob);
  } catch (e) {
    // Chrome / Android などは HEIC を表示できないため、変換ライブラリを必要な時だけ読み込む
    if (mime === 'image/heic' || mime === 'image/heif') {
      const heic2any = (await import('heic2any')).default;
      const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.85 });
      return loadImage(Array.isArray(converted) ? converted[0] : converted);
    }
    throw e;
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

function drawScaled(source: CanvasImageSource, w: number, h: number, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function releaseCanvas(c: HTMLCanvasElement) {
  // iOS Safari はキャンバスのメモリ解放が遅いため明示的に縮小する
  c.width = 0;
  c.height = 0;
}

interface ImageDerived {
  width: number | null;
  height: number | null;
  preview: Blob | null;
  thumb: Blob | null;
  phash: string | null;
  /** 容量優先のときの縮小版 (元より大きくなる場合は null) */
  standard: Blob | null;
}

async function imageDerivatives(blob: Blob, mime: string, quality: UploadQuality): Promise<ImageDerived> {
  return serialize(async () => {
    const img = await decodeImage(blob, mime);
    const w = img.naturalWidth;
    const h = img.naturalHeight;

    // 容量優先: 長辺 2048px の JPEG を作る (アニメーション GIF は動きが消えるため対象外)
    if (quality === 'standard' && mime !== 'image/gif') {
      const stdCanvas = drawScaled(img, w, h, STANDARD_MAX_EDGE);
      img.src = '';
      const std = await toJpeg(stdCanvas, STANDARD_JPEG_QUALITY);
      const thumbCanvas = drawScaled(stdCanvas, stdCanvas.width, stdCanvas.height, THUMB_MAX);
      const thumb = await toJpeg(thumbCanvas, 0.75);
      const phash = safeHash(thumbCanvas, thumbCanvas.width, thumbCanvas.height);
      releaseCanvas(thumbCanvas);
      if (std && std.size < blob.size) {
        // 縮小版そのものを表示に使えるため、拡大表示用のプレビューは作らない (容量節約)
        const dims = { width: stdCanvas.width, height: stdCanvas.height };
        releaseCanvas(stdCanvas);
        return { ...dims, preview: null, thumb, phash, standard: std };
      }
      // 元のほうが小さい (すでに小さい画像など) → 元のまま保存し、表示用プレビューを作る
      const previewCanvas = drawScaled(stdCanvas, stdCanvas.width, stdCanvas.height, PREVIEW_MAX);
      const preview = await toJpeg(previewCanvas, 0.82);
      releaseCanvas(previewCanvas);
      releaseCanvas(stdCanvas);
      return { width: w, height: h, preview, thumb, phash, standard: null };
    }

    const previewCanvas = drawScaled(img, w, h, PREVIEW_MAX);
    img.src = '';
    const preview = await toJpeg(previewCanvas, 0.82);
    const thumbCanvas = drawScaled(previewCanvas, previewCanvas.width, previewCanvas.height, THUMB_MAX);
    const thumb = await toJpeg(thumbCanvas, 0.75);
    const phash = safeHash(thumbCanvas, thumbCanvas.width, thumbCanvas.height);
    releaseCanvas(previewCanvas);
    releaseCanvas(thumbCanvas);
    return { width: w, height: h, preview, thumb, phash, standard: null };
  });
}

// ---------------------------------------------------------------- 動画のサムネイル
interface VideoMeta {
  width: number | null;
  height: number | null;
  durationSec: number | null;
  thumb: Blob | null;
  phash: string | null;
}

function videoDerivatives(blob: Blob): Promise<VideoMeta> {
  return serialize(
    () =>
      new Promise((resolve) => {
        const url = URL.createObjectURL(blob);
        const video = document.createElement('video');
        let done = false;
        const finish = (r: VideoMeta) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          video.removeAttribute('src');
          video.load();
          URL.revokeObjectURL(url);
          resolve(r);
        };
        const meta = () => ({
          width: video.videoWidth || null,
          height: video.videoHeight || null,
          durationSec: Number.isFinite(video.duration) ? video.duration : null,
        });
        // 再生できない形式 (例: Android で HEVC) でもアップロード自体は続ける
        const timer = setTimeout(() => finish({ ...meta(), thumb: null, phash: null }), 10_000);
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.onloadedmetadata = () => {
          video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
        };
        video.onseeked = async () => {
          try {
            if (!video.videoWidth) return finish({ ...meta(), thumb: null, phash: null });
            const c = drawScaled(video, video.videoWidth, video.videoHeight, THUMB_MAX);
            const thumb = await toJpeg(c, 0.75);
            const phash = safeHash(c, c.width, c.height);
            releaseCanvas(c);
            finish({ ...meta(), thumb, phash });
          } catch {
            finish({ ...meta(), thumb: null, phash: null });
          }
        };
        video.onerror = () => finish({ width: null, height: null, durationSec: null, thumb: null, phash: null });
        video.src = url;
        video.load();
      }),
  );
}

/** アップロード前の準備: GPS 除去・指紋・撮影日時・サムネイル */
export async function prepareMedia(file: File, mime: string, mediaType: MediaType, quality: UploadQuality = 'original'): Promise<PreparedMedia> {
  if (mediaType === 'image') {
    // iCloud 上の写真はここで読み込みに失敗することがある (呼び出し側で再試行を案内)
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      throw new Error('file_read_failed');
    }
    const contentHash = `sha256:${await sha256Hex(bytes)}`;
    const takenAt = await readTakenAt(file);
    stripImageGps(bytes, mime);
    const original = new Blob([bytes as BlobPart], { type: mime });
    let derived: ImageDerived = { width: null, height: null, preview: null, thumb: null, phash: null, standard: null };
    try {
      derived = await imageDerivatives(original, mime, quality);
    } catch (e) {
      // 読み込めない形式 (Chrome での HEIC など) は元のまま保存
      console.warn('thumbnail failed', e);
    }
    const { standard, ...rest } = derived;
    // 重複判定の指紋 (contentHash) は元ファイルから作るため、画質設定が違っても同じ写真は重複と判定される
    if (standard) return { original: standard, mime: 'image/jpeg', contentHash, takenAt, durationSec: null, ...rest };
    return { original, mime, contentHash, takenAt, durationSec: null, ...rest };
  }

  let contentHash: string;
  try {
    contentHash = await videoFingerprint(file);
  } catch {
    throw new Error('file_read_failed');
  }
  const { blob, takenAt } = await processVideo(file, mime);
  const meta = await videoDerivatives(blob);
  return { original: blob, mime, contentHash, takenAt, preview: null, ...meta };
}
