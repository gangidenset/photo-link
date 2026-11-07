// 一括保存のシート
//   ・保存済みの写真が含まれていれば「未保存だけ / すべて」を選んでもらう (重複保存の確認)
//   ・50 件ずつ順番に保存 (iPhone は 50 件ごとに「保存・共有する」をタップ)
//   ・保存できた分を記録し、次回の確認に使う
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Share } from 'lucide-react';
import { toMessage } from '@/lib/errors';
import type { PhotoWithUploader } from '@/types/db';
import { Button, ErrorBox, ProgressBar, Sheet } from '@/components/ui';
import { markDownloaded } from './api';
import {
  BULK_DOWNLOAD_MAX,
  bulkMethod,
  downloadSequential,
  fetchFiles,
  saveZip,
  shareFiles,
  zipNameFor,
  type BulkMethod,
} from './bulkDownload';

type Phase = 'confirm' | 'running' | 'ready' | 'done' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  albumTitle: string;
  photos: PhotoWithUploader[];
  savedIds: Set<string>;
  /** 保存済みが含まれないときは確認を省いてすぐ始める */
  autoStart?: boolean;
  onFinished?: () => void;
}

const METHOD_NOTE: Record<BulkMethod, string> = {
  share: '準備ができたら「保存・共有する」をタップし、「画像を保存」を選ぶと写真アプリに保存されます。',
  sequential: '1 件ずつ自動でダウンロードされます。「複数のファイルをダウンロード」の確認が出たら許可してください。',
  zip: 'ZIP ファイルにまとめてダウンロードされます。',
};

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function BulkSaveSheet({ open, onClose, title, albumTitle, photos, savedIds, autoStart, onFinished }: Props) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [batchIndex, setBatchIndex] = useState(0);
  const [batchCount, setBatchCount] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [prepared, setPrepared] = useState<File[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const batches = useRef<PhotoWithUploader[][]>([]);
  const cancelled = useRef(false);
  const doneBefore = useRef(0);

  const already = photos.filter((p) => savedIds.has(p.id));
  const unsaved = photos.filter((p) => !savedIds.has(p.id));
  const method = photos.length > 0 ? bulkMethod(photos.slice(0, BULK_DOWNLOAD_MAX)) : 'zip';
  const zipBase = zipNameFor(albumTitle).replace(/\.zip$/, '');

  // 開くたびに初期化
  useEffect(() => {
    if (!open) return;
    cancelled.current = false;
    setPhase('confirm');
    setPrepared(null);
    setError(null);
    setSavedCount(0);
    if (autoStart && already.length === 0 && photos.length > 0) start(photos);
    return () => {
      cancelled.current = true;
    };
    // 開いた時点の内容で判定する (閉じたら、実行中の 50 件が終わった時点で止める)
  }, [open]);

  function start(list: PhotoWithUploader[]) {
    batches.current = chunk(list, BULK_DOWNLOAD_MAX);
    doneBefore.current = 0;
    setBatchCount(batches.current.length);
    setProgress({ done: 0, total: list.length });
    void runBatch(0);
  }

  async function finishBatch(i: number, batch: PhotoWithUploader[]) {
    await markDownloaded(batch);
    doneBefore.current += batch.length;
    setSavedCount(doneBefore.current);
    if (i + 1 < batches.current.length && !cancelled.current) {
      void runBatch(i + 1);
    } else {
      setPhase('done');
      onFinished?.();
    }
  }

  async function runBatch(i: number) {
    const batch = batches.current[i];
    setBatchIndex(i);
    setPhase('running');
    setPrepared(null);
    const onProgress = (done: number) => setProgress((p) => ({ ...p, done: doneBefore.current + done }));
    try {
      const m = bulkMethod(batch);
      if (m === 'sequential') {
        await downloadSequential(batch, onProgress);
        await finishBatch(i, batch);
        return;
      }
      const files = await fetchFiles(batch, onProgress);
      if (cancelled.current) return;
      if (m === 'share') {
        setPrepared(files);
        setPhase('ready'); // 次のタップで共有シートを開く
        return;
      }
      const suffix = batches.current.length > 1 ? `_${i + 1}` : '';
      await saveZip(files, `${zipBase}${suffix}.zip`);
      await finishBatch(i, batch);
    } catch (e) {
      setError(toMessage(e));
      setPhase('error');
    }
  }

  async function onShare() {
    if (!prepared) return;
    const result = await shareFiles(prepared, `${zipBase}_${batchIndex + 1}.zip`);
    if (result === 'canceled') return; // もう一度タップできるようにそのまま
    await finishBatch(batchIndex, batches.current[batchIndex]);
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="space-y-4 px-5 pb-6">
        {photos.length === 0 ? (
          <p className="text-sm text-ink-2">保存できる写真がありません。</p>
        ) : phase === 'confirm' ? (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-surface-2 p-3">
                <dt className="text-xs text-ink-3">未保存</dt>
                <dd className="text-xl font-bold">{unsaved.length} 件</dd>
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <dt className="text-xs text-ink-3">保存済み</dt>
                <dd className="text-xl font-bold">{already.length} 件</dd>
              </div>
            </dl>
            {already.length > 0 && (
              <p className="text-sm text-ink-2">
                {already.length} 件は以前に保存しています。同じ写真が端末に重複しないよう、未保存の分だけ保存できます。
              </p>
            )}
            <p className="text-xs text-ink-3">
              {METHOD_NOTE[method]}
              {Math.max(unsaved.length, 1) > BULK_DOWNLOAD_MAX && ` ${BULK_DOWNLOAD_MAX} 件ずつ順番に保存します。`}
            </p>
            <div className="space-y-2">
              {unsaved.length > 0 && (
                <Button block onClick={() => start(unsaved)}>
                  <Download className="size-5" />
                  {already.length > 0 ? `未保存の ${unsaved.length} 件だけ保存` : `${unsaved.length} 件を保存`}
                </Button>
              )}
              {already.length > 0 && (
                <Button block variant="secondary" onClick={() => start(photos)}>
                  {unsaved.length > 0 ? `保存済みも含めて ${photos.length} 件を保存` : `もう一度 ${photos.length} 件を保存`}
                </Button>
              )}
            </div>
          </>
        ) : phase === 'running' ? (
          <div className="space-y-3 py-2">
            <ProgressBar value={progress.done / Math.max(progress.total, 1)} className="h-2" />
            <p className="text-sm text-ink-2">
              {method === 'sequential' ? 'ダウンロード中' : '準備中'} {progress.done} / {progress.total} 件
              {batchCount > 1 && ` (${batchIndex + 1} / ${batchCount} 回目)`}
            </p>
            <p className="text-xs text-ink-3">この画面を開いたままお待ちください。</p>
          </div>
        ) : phase === 'ready' ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-2">
              {prepared?.length} 件の準備ができました{batchCount > 1 && ` (${batchIndex + 1} / ${batchCount} 回目)`}。
              下のボタンを押して「画像を保存」を選んでください。
            </p>
            <Button block onClick={onShare}>
              <Share className="size-5" />
              {prepared?.length} 件を保存・共有する
            </Button>
          </div>
        ) : phase === 'done' ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="size-10 text-success" />
            <p className="font-semibold">{savedCount} 件を保存しました</p>
            <Button block variant="secondary" onClick={onClose}>
              閉じる
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <ErrorBox message={error} />
            {savedCount > 0 && <p className="text-sm text-ink-2">{savedCount} 件は保存済みです。</p>}
            <Button block onClick={() => void runBatch(batchIndex)}>
              続きから再試行
            </Button>
            <Button block variant="secondary" onClick={onClose}>
              閉じる
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
