// 署名付き URL のキャッシュ
//   非公開バケットの画像は、期限付きの「署名付き URL」でのみ表示できる。
//   一覧表示で 1 枚ずつリクエストすると遅いため、同時に要求されたパスをまとめて
//   1 回の API 呼び出しで取得し、期限の少し前まで使い回す。
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';

type Bucket = 'photos' | 'avatars';

const EXPIRES_IN = 60 * 60; // 1 時間
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface Entry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, Entry>();
const pending = new Map<Bucket, Set<string>>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let version = 0;

const key = (bucket: Bucket, path: string) => `${bucket}:${path}`;

function notify() {
  version++;
  listeners.forEach((l) => l());
}

async function flush() {
  timer = null;
  const batches = [...pending.entries()];
  pending.clear();
  for (const [bucket, set] of batches) {
    const paths = [...set];
    // API の 1 回あたりの上限を考慮して 100 件ずつ
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      try {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrls(chunk, EXPIRES_IN);
        if (error) throw error;
        const expiresAt = Date.now() + EXPIRES_IN * 1000;
        for (const item of data ?? []) {
          if (item.signedUrl && item.path) cache.set(key(bucket, item.path), { url: item.signedUrl, expiresAt });
        }
      } catch (e) {
        console.warn('signed url error', e);
      } finally {
        chunk.forEach((p) => inflight.delete(key(bucket, p)));
      }
    }
  }
  notify();
}

function request(bucket: Bucket, path: string) {
  const k = key(bucket, path);
  if (inflight.has(k)) return;
  inflight.add(k);
  let set = pending.get(bucket);
  if (!set) pending.set(bucket, (set = new Set()));
  set.add(path);
  if (!timer) timer = setTimeout(flush, 16);
}

/** キャッシュ済みの URL を返す。なければ取得を予約して null */
export function peekSignedUrl(bucket: Bucket, path: string | null | undefined): string | null {
  if (!path) return null;
  const entry = cache.get(key(bucket, path));
  if (entry && entry.expiresAt - Date.now() > REFRESH_MARGIN_MS) return entry.url;
  request(bucket, path);
  return entry && entry.expiresAt > Date.now() ? entry.url : null;
}

/** 1 件だけ即時に取得 (ダウンロード・動画再生用)。download 指定でファイル名付きダウンロード URL */
export async function getSignedUrl(
  bucket: Bucket,
  path: string,
  options?: { download?: string | boolean },
): Promise<string> {
  if (!options?.download) {
    const cached = cache.get(key(bucket, path));
    if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) return cached.url;
  }
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, EXPIRES_IN, options);
  if (error || !data) throw error ?? new Error('signed_url_failed');
  if (!options?.download) cache.set(key(bucket, path), { url: data.signedUrl, expiresAt: Date.now() + EXPIRES_IN * 1000 });
  return data.signedUrl;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React フック: パスから署名付き URL を得る (取得中は null) */
export function useSignedUrl(bucket: Bucket, path: string | null | undefined): string | null {
  useSyncExternalStore(subscribe, () => version);
  return peekSignedUrl(bucket, path);
}

export function clearSignedUrlCache() {
  cache.clear();
  notify();
}
