// Storage へのファイル送信
//   小さいファイル (6MB 以下): 通常の HTTP アップロード (進捗付き)
//   大きいファイル: TUS (再開可能アップロード)。通信が切れても続きから送れる
import * as tus from 'tus-js-client';
import { SUPABASE_ANON_KEY, SUPABASE_URL, getAccessToken } from '@/lib/supabase';

const TUS_CHUNK = 6 * 1024 * 1024; // Supabase の推奨値 (6MB 固定)
const BUCKET = 'photos';

export interface UploadHandle {
  promise: Promise<void>;
  abort: () => void;
}

export function uploadBlob(
  path: string,
  blob: Blob,
  contentType: string,
  onProgress: (loaded: number, total: number) => void,
  fingerprint: string,
): UploadHandle {
  return blob.size > TUS_CHUNK
    ? uploadTus(path, blob, contentType, onProgress, fingerprint)
    : uploadSimple(path, blob, contentType, onProgress);
}

function uploadSimple(
  path: string,
  blob: Blob,
  contentType: string,
  onProgress: (loaded: number, total: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = (async () => {
    const token = await getAccessToken();
    await new Promise<void>((resolve, reject) => {
      xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodePath(path)}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.setRequestHeader('cache-control', 'max-age=31536000');
      xhr.setRequestHeader('x-upsert', 'true');
      xhr.timeout = 120_000;
      xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : blob.size);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(blob.size, blob.size);
          resolve();
        } else {
          reject(new Error(parseStorageError(xhr.responseText) ?? `upload_failed status: ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('network error (xhr status: 0)'));
      xhr.ontimeout = () => reject(new Error('network timeout'));
      xhr.onabort = () => reject(new Error('aborted'));
      xhr.send(blob);
    });
  })();
  return { promise, abort: () => xhr.abort() };
}

function uploadTus(
  path: string,
  blob: Blob,
  contentType: string,
  onProgress: (loaded: number, total: number) => void,
  fingerprint: string,
): UploadHandle {
  let upload: tus.Upload | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    upload = new tus.Upload(blob, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 2000, 5000, 10000, 20000],
      chunkSize: TUS_CHUNK,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: { apikey: SUPABASE_ANON_KEY, 'x-upsert': 'true' },
      metadata: {
        bucketName: BUCKET,
        objectName: path,
        contentType,
        cacheControl: '31536000',
      },
      // 写真 ID 単位で再開情報を保存 (アプリを開き直しても同じファイルなら続きから)
      fingerprint: async () => `photolink-${fingerprint}`,
      // 長時間のアップロードでもトークン切れにならないよう毎回最新を付与
      onBeforeRequest: async (req) => {
        req.setHeader('Authorization', `Bearer ${await getAccessToken()}`);
      },
      onProgress: (loaded, total) => onProgress(loaded, total),
      onSuccess: () => resolve(),
      onError: (err) => reject(new Error(parseTusError(err))),
    });
    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) upload!.resumeFromPreviousUpload(previous[0]);
        upload!.start();
      })
      .catch(() => upload!.start());
  });
  return { promise, abort: () => void upload?.abort(true) };
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function parseStorageError(text: string): string | null {
  try {
    const j = JSON.parse(text) as { message?: string; error?: string };
    return j.message ?? j.error ?? null;
  } catch {
    return null;
  }
}

function parseTusError(err: Error): string {
  const anyErr = err as Error & { originalResponse?: { getStatus(): number; getBody(): string } | null };
  const res = anyErr.originalResponse;
  if (res) return parseStorageError(res.getBody()) ?? `upload_failed status: ${res.getStatus()}`;
  return err.message.includes('network') ? 'network error' : err.message;
}
