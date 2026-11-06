// アップロードキュー
//   ・選択したファイルは「参照」だけを持つ (中身はアップロード直前に読む = メモリ節約)
//   ・同時実行数を制限して順番に処理
//   ・通信エラーは自動で再試行し、それでも失敗したものだけを手動で再試行できる
//   ・画面を移動してもキューは保持される (グローバルストア)
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import { errorCode, isNetworkError, toMessage } from '@/lib/errors';
import type { MediaType } from '@/types/db';
import type { UploadHandle } from './transport';

// 画像処理・送信のコードはアップロード開始時に読み込む (初回表示を軽くする)
const loadPipeline = () =>
  Promise.all([import('./fileTypes'), import('./media'), import('./transport')]).then(([f, m, t]) => ({
    detectType: f.detectType,
    prepareMedia: m.prepareMedia,
    uploadBlob: t.uploadBlob,
  }));

export type UploadStatus = 'queued' | 'preparing' | 'uploading' | 'finalizing' | 'done' | 'error' | 'duplicate' | 'canceled';

export interface UploadItem {
  id: string;
  albumId: string;
  file: File;
  name: string;
  size: number;
  mediaType: MediaType | null;
  status: UploadStatus;
  /** 0〜1 */
  progress: number;
  error: string | null;
  attempts: number;
  photoId: string | null;
  /** 重複判定用の指紋 (準備完了後に設定) */
  hash: string | null;
}

interface UploadState {
  items: UploadItem[];
  concurrency: number;
  enqueue: (albumId: string, files: File[]) => void;
  retry: (id: string) => void;
  retryAllFailed: () => void;
  cancel: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  setConcurrency: (n: number) => void;
}

const FINISHED: UploadStatus[] = ['done', 'duplicate', 'canceled'];
export const isActive = (s: UploadStatus) => s === 'preparing' || s === 'uploading' || s === 'finalizing';
export const isFinished = (s: UploadStatus) => FINISHED.includes(s);

const MAX_AUTO_RETRY = 3;
const BACKOFF_MS = [2000, 5000, 10000];

const handles = new Map<string, UploadHandle[]>();
const canceled = new Set<string>();

let savedConcurrency = 3;
try {
  savedConcurrency = Number(localStorage.getItem('photolink.concurrency')) || 3;
} catch {
  /* private mode など */
}

export const useUploadStore = create<UploadState>((set, get) => ({
  items: [],
  concurrency: savedConcurrency,

  enqueue(albumId, files) {
    const existing = new Set(
      get()
        .items.filter((i) => i.albumId === albumId && i.status !== 'canceled')
        .map((i) => `${i.name}:${i.size}:${i.file.lastModified}`),
    );
    const added: UploadItem[] = [];
    for (const file of files) {
      const k = `${file.name}:${file.size}:${file.lastModified}`;
      if (existing.has(k)) continue; // 同じファイルを二重に追加しない
      existing.add(k);
      added.push({
        id: crypto.randomUUID(),
        albumId,
        file,
        name: file.name || 'photo',
        size: file.size,
        mediaType: file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null,
        status: 'queued',
        progress: 0,
        error: null,
        attempts: 0,
        photoId: null,
        hash: null,
      });
    }
    set((s) => ({ items: [...s.items, ...added] }));
    pump();
  },

  retry(id) {
    canceled.delete(id);
    patch(id, { status: 'queued', error: null, attempts: 0, progress: 0 });
    pump();
  },

  retryAllFailed() {
    set((s) => ({
      items: s.items.map((i) => (i.status === 'error' ? { ...i, status: 'queued', error: null, attempts: 0, progress: 0 } : i)),
    }));
    pump();
  },

  cancel(id) {
    canceled.add(id);
    handles.get(id)?.forEach((h) => h.abort());
    patch(id, { status: 'canceled' });
    pump();
  },

  remove(id) {
    get().cancel(id);
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },

  clearFinished() {
    set((s) => ({ items: s.items.filter((i) => !isFinished(i.status)) }));
  },

  setConcurrency(n) {
    const v = Math.min(6, Math.max(1, Math.round(n)));
    try {
      localStorage.setItem('photolink.concurrency', String(v));
    } catch {
      /* ignore */
    }
    set({ concurrency: v });
    pump();
  },
}));

function patch(id: string, p: Partial<UploadItem>) {
  useUploadStore.setState((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
}

// 進捗の更新は 1 件あたり 150ms に 1 回まで (100 件同時でも画面が重くならないように)
const lastProgressAt = new Map<string, number>();
function setProgress(id: string, progress: number) {
  const now = performance.now();
  if (progress < 1 && now - (lastProgressAt.get(id) ?? 0) < 150) return;
  lastProgressAt.set(id, now);
  patch(id, { progress });
}

// アルバムの再読み込みはまとめて行う
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleRefresh(albumId: string) {
  if (refreshTimers.has(albumId)) return;
  refreshTimers.set(
    albumId,
    setTimeout(() => {
      refreshTimers.delete(albumId);
      void queryClient.invalidateQueries({ queryKey: ['photos', albumId] });
      void queryClient.invalidateQueries({ queryKey: ['albums'] });
      void queryClient.invalidateQueries({ queryKey: ['album', albumId] });
      void queryClient.invalidateQueries({ queryKey: ['recent-photos'] });
    }, 1500),
  );
}

function pump() {
  const { items, concurrency } = useUploadStore.getState();
  let active = items.filter((i) => isActive(i.status)).length;
  for (const item of items) {
    if (active >= concurrency) break;
    if (item.status !== 'queued') continue;
    active++;
    patch(item.id, { status: 'preparing', progress: 0.01 });
    void processItem(item.id);
  }
  updateKeepAwake();
}

class SkipError extends Error {}

async function processItem(id: string) {
  const get = () => useUploadStore.getState().items.find((i) => i.id === id);
  const item = get();
  if (!item) return;
  const assertNotCanceled = () => {
    if (canceled.has(id)) throw new SkipError('canceled');
  };

  try {
    const { detectType, prepareMedia, uploadBlob } = await loadPipeline();
    const type = await detectType(item.file);
    if (!type) throw new Error('unsupported_type');
    patch(id, { mediaType: type.mediaType });

    const prepared = await prepareMedia(item.file, type.mime, type.mediaType);
    assertNotCanceled();
    setProgress(id, 0.05);

    // 同じキュー内で同じ写真を同時に送らない
    const sameInQueue = useUploadStore
      .getState()
      .items.some(
        (i) =>
          i.id !== id &&
          i.albumId === item.albumId &&
          i.hash === prepared.contentHash &&
          i.status !== 'canceled' &&
          i.status !== 'error',
      );
    patch(id, { hash: prepared.contentHash });
    if (sameInQueue) {
      patch(id, { status: 'duplicate', progress: 1 });
      return;
    }

    const hasThumb = prepared.thumb !== null;
    const { data, error } = await supabase.rpc('begin_photo_upload', {
      p_album_id: item.albumId,
      p_media_type: type.mediaType,
      p_mime_type: type.mime,
      p_size_bytes: prepared.original.size,
      p_content_hash: prepared.contentHash,
      p_original_filename: item.name.slice(0, 255),
      p_taken_at: prepared.takenAt?.toISOString() ?? null,
      p_width: prepared.width,
      p_height: prepared.height,
      p_duration_sec: prepared.durationSec ? Math.round(prepared.durationSec * 100) / 100 : null,
      p_has_thumb: hasThumb,
    });
    if (error) {
      if (error.message === 'duplicate') {
        patch(id, { status: 'duplicate', progress: 1 });
        return;
      }
      throw error;
    }
    const reserved = data as { id: string; storage_path: string; thumb_path: string | null; preview_path: string | null };
    patch(id, { photoId: reserved.id, status: 'uploading' });
    assertNotCanceled();

    // 送信量に応じた進捗 (準備 5% + 送信 90% + 完了処理 5%)
    const parts: { path: string; blob: Blob; type: string }[] = [];
    if (reserved.thumb_path && prepared.thumb) parts.push({ path: reserved.thumb_path, blob: prepared.thumb, type: 'image/jpeg' });
    if (reserved.preview_path && prepared.preview) parts.push({ path: reserved.preview_path, blob: prepared.preview, type: 'image/jpeg' });
    parts.push({ path: reserved.storage_path, blob: prepared.original, type: type.mime });
    const total = parts.reduce((n, p) => n + p.blob.size, 0);
    let doneBytes = 0;
    for (const part of parts) {
      assertNotCanceled();
      const handle = uploadBlob(
        part.path,
        part.blob,
        part.type,
        (loaded) => setProgress(id, 0.05 + 0.9 * ((doneBytes + loaded) / total)),
        `${reserved.id}:${part.path}`,
      );
      handles.set(id, [handle]);
      await handle.promise;
      doneBytes += part.blob.size;
    }
    handles.delete(id);

    patch(id, { status: 'finalizing', progress: 0.97 });
    const { error: completeError } = await supabase.rpc('complete_photo_upload', {
      p_photo_id: reserved.id,
      p_has_thumb: hasThumb,
    });
    if (completeError) throw completeError;

    patch(id, { status: 'done', progress: 1, error: null });
    scheduleRefresh(item.albumId);
  } catch (err) {
    handles.delete(id);
    if (err instanceof SkipError || canceled.has(id)) {
      patch(id, { status: 'canceled' });
    } else {
      const attempts = (get()?.attempts ?? 0) + 1;
      if (isNetworkError(err) && attempts < MAX_AUTO_RETRY) {
        patch(id, { status: 'error', error: '通信エラー。自動で再試行します…', attempts });
        setTimeout(() => {
          const cur = get();
          if (cur && cur.status === 'error' && !canceled.has(id)) {
            patch(id, { status: 'queued' });
            pump();
          }
        }, BACKOFF_MS[attempts - 1] ?? 10000);
      } else {
        const code = errorCode(err);
        const message =
          code === 'file_read_failed'
            ? 'ファイルを読み込めませんでした。iCloud の写真の場合は「写真」アプリで一度表示してから再試行してください。'
            : toMessage(err);
        patch(id, { status: 'error', error: message, attempts });
      }
    }
  } finally {
    lastProgressAt.delete(id);
    pump();
  }
}

// ---------------------------------------------------------------- 画面スリープ防止・離脱警告
type WakeLockSentinelLike = { release: () => Promise<void> };
let wakeLock: WakeLockSentinelLike | null = null;
let wakeLockPending = false;

function onBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = '';
}

function updateKeepAwake() {
  const busy = useUploadStore.getState().items.some((i) => isActive(i.status) || i.status === 'queued');
  if (busy) {
    window.addEventListener('beforeunload', onBeforeUnload);
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } };
    if (!wakeLock && !wakeLockPending && nav.wakeLock && document.visibilityState === 'visible') {
      wakeLockPending = true;
      nav.wakeLock
        .request('screen')
        .then((l) => (wakeLock = l))
        .catch(() => undefined)
        .finally(() => (wakeLockPending = false));
    }
  } else {
    window.removeEventListener('beforeunload', onBeforeUnload);
    void wakeLock?.release().catch(() => undefined);
    wakeLock = null;
  }
}

if (typeof document !== 'undefined') {
  // 画面が再表示されたらスリープ防止を取り直す (OS により自動解除されるため)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      wakeLock = null;
      updateKeepAwake();
    }
  });
}

/** 全体の進捗 (表示用) */
export function summarize(items: UploadItem[]) {
  const relevant = items.filter((i) => i.status !== 'canceled');
  const totalBytes = relevant.reduce((n, i) => n + i.size, 0) || 1;
  const doneBytes = relevant.reduce((n, i) => n + i.size * (isFinished(i.status) ? 1 : i.progress), 0);
  return {
    total: relevant.length,
    done: relevant.filter((i) => i.status === 'done').length,
    duplicates: relevant.filter((i) => i.status === 'duplicate').length,
    failed: relevant.filter((i) => i.status === 'error' && !i.error?.includes('自動で再試行')).length,
    remaining: relevant.filter((i) => !isFinished(i.status) && i.status !== 'error').length,
    percent: Math.round((doneBytes / totalBytes) * 100),
  };
}
