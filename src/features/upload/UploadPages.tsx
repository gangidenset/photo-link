import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Camera, CheckCircle2, Copy, Film, ImageIcon, Images, Loader2, RotateCw, Trash2, Video, X } from 'lucide-react';
import { useAlbum } from '@/features/albums/api';
import { formatBytes } from '@/lib/format';
import { Button, EmptyState, FullPageSpinner, IconButton, PageHeader, ProgressBar } from '@/components/ui';
import { ACCEPT_ATTR } from './fileTypes';
import { isActive, isAutoRetrying, summarize, useUploadStore, type UploadItem } from './uploadStore';

// ---------------------------------------------------------------- 選択済みファイルのプレビュー
// 表示範囲に入ったものだけ画像を読み込む (100 枚以上選んでも重くならない)
const SelectedTile = memo(function SelectedTile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isVideo = file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm)$/i.test(file.name);

  useEffect(() => {
    if (isVideo) return;
    const el = ref.current;
    if (!el) return;
    let objectUrl: string | null = null;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !objectUrl) {
          objectUrl = URL.createObjectURL(file);
          setUrl(objectUrl);
        } else if (!entry.isIntersecting && objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          setUrl(null);
        }
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, isVideo]);

  return (
    <div ref={ref} className="relative aspect-square overflow-hidden rounded-lg bg-surface-2">
      {url && !failed ? (
        <img src={url} alt="" className="size-full object-cover" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 p-1 text-ink-3">
          {isVideo ? <Film className="size-6" /> : <ImageIcon className="size-6" />}
          <span className="w-full truncate text-center text-[10px]">{file.name}</span>
        </div>
      )}
      <button
        aria-label={`${file.name} を選択から外す`}
        onClick={onRemove}
        className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
      >
        <X className="size-4" />
      </button>
    </div>
  );
});

export function UploadPickerPage() {
  const { albumId } = useParams();
  const { data: album, isLoading } = useAlbum(albumId);
  const [files, setFiles] = useState<File[]>([]);
  const libraryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const enqueue = useUploadStore((s) => s.enqueue);
  const navigate = useNavigate();

  const totalBytes = useMemo(() => files.reduce((n, f) => n + f.size, 0), [files]);
  const videoCount = useMemo(() => files.filter((f) => f.type.startsWith('video/')).length, [files]);

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}:${f.size}:${f.lastModified}`))];
    });
  }

  function start() {
    if (!albumId || files.length === 0) return;
    enqueue(albumId, files);
    setFiles([]);
    navigate('/uploads');
  }

  if (isLoading) return <FullPageSpinner />;
  if (!album) return <EmptyState icon={<Images className="size-7" />} title="アルバムが見つかりません" />;

  return (
    <>
      <PageHeader title="写真・動画を追加" back={`/albums/${albumId}`} />
      <main className={`px-safe mx-auto max-w-3xl py-4 ${files.length > 0 ? 'pb-24' : ''}`}>
        <p className="mb-4 text-sm text-ink-2">
          投稿先: <span className="font-semibold text-ink">{album.title}</span>
        </p>

        {/* iOS / Android 共通: 標準のファイル選択 (写真ライブラリ・カメラ) を使う */}
        <input
          ref={libraryInput}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={videoInput}
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <div className="grid grid-cols-3 gap-3">
          <PickButton icon={<Images className="size-7" />} label="ライブラリ" onClick={() => libraryInput.current?.click()} primary />
          <PickButton icon={<Camera className="size-7" />} label="写真を撮る" onClick={() => cameraInput.current?.click()} />
          <PickButton icon={<Video className="size-7" />} label="動画を撮る" onClick={() => videoInput.current?.click()} />
        </div>

        {files.length > 0 ? (
          <>
            <div className="mt-6 mb-3 flex items-center justify-between">
              <p className="text-sm">
                <span className="font-semibold">{files.length} 件</span>
                <span className="text-ink-3">
                  {' '}
                  ({videoCount > 0 && `動画 ${videoCount} 件 ・ `}
                  {formatBytes(totalBytes)})
                </span>
              </p>
              <button className="text-sm text-ink-2" onClick={() => setFiles([])}>
                すべて外す
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {files.map((f, i) => (
                <SelectedTile key={`${f.name}:${f.size}:${f.lastModified}`} file={f} onRemove={() => setFiles((prev) => prev.filter((_, j) => j !== i))} />
              ))}
            </div>
          </>
        ) : (
          <div className="mt-8 rounded-2xl border border-dashed border-line p-6 text-center text-sm text-ink-2">
            <p>複数の写真・動画をまとめて選べます。</p>
            <p className="mt-1 text-xs text-ink-3">写真は元の画質のまま保存されます。位置情報 (GPS) は自動的に削除されます。</p>
          </div>
        )}
      </main>

      {files.length > 0 && (
        <div className="bottom-nav-offset px-safe fixed inset-x-0 z-30 flex justify-center">
          <Button className="w-full max-w-md shadow-lg" onClick={start}>
            {files.length} 件をアップロード
          </Button>
        </div>
      )}
    </>
  );
}

function PickButton({ icon, label, onClick, primary }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition active:scale-[0.97] ${
        primary ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------- アップロード進捗
const STATUS_LABEL: Record<UploadItem['status'], string> = {
  queued: '待機中',
  preparing: '準備中',
  uploading: '送信中',
  finalizing: '仕上げ中',
  done: '完了',
  error: '失敗',
  duplicate: '投稿済みのためスキップ',
  canceled: 'キャンセル',
};

const UploadRow = memo(function UploadRow({ item }: { item: UploadItem }) {
  const retry = useUploadStore((s) => s.retry);
  const remove = useUploadStore((s) => s.remove);
  const autoRetrying = isAutoRetrying(item);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="shrink-0">
        {item.status === 'done' ? (
          <CheckCircle2 className="size-5 text-success" />
        ) : item.status === 'duplicate' ? (
          <Copy className="size-5 text-ink-3" />
        ) : item.status === 'error' && !autoRetrying ? (
          <AlertCircle className="size-5 text-danger" />
        ) : isActive(item.status) || autoRetrying ? (
          <Loader2 className="size-5 animate-spin text-accent" />
        ) : item.mediaType === 'video' ? (
          <Film className="size-5 text-ink-3" />
        ) : (
          <ImageIcon className="size-5 text-ink-3" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <span className="shrink-0 text-xs text-ink-3">{formatBytes(item.size)}</span>
        </div>
        {isActive(item.status) ? (
          <div className="mt-1.5 flex items-center gap-2">
            <ProgressBar value={item.progress} />
            <span className="w-9 shrink-0 text-right text-xs text-ink-3 tabular-nums">{Math.round(item.progress * 100)}%</span>
          </div>
        ) : (
          <p className={`mt-0.5 text-xs ${item.status === 'error' && !autoRetrying ? 'text-danger' : 'text-ink-3'}`}>
            {item.status === 'error' ? item.error : STATUS_LABEL[item.status]}
          </p>
        )}
      </div>
      {item.status === 'error' && !autoRetrying && (
        <IconButton label="再試行" onClick={() => retry(item.id)}>
          <RotateCw className="size-5" />
        </IconButton>
      )}
      {item.status !== 'done' && item.status !== 'duplicate' && (
        <IconButton label="取り消す" onClick={() => remove(item.id)} className="text-ink-3">
          <X className="size-5" />
        </IconButton>
      )}
    </li>
  );
});

export function UploadsPage() {
  const items = useUploadStore((s) => s.items);
  const retryAllFailed = useUploadStore((s) => s.retryAllFailed);
  const clearFinished = useUploadStore((s) => s.clearFinished);
  const sum = summarize(items);
  const albumIds = [...new Set(items.map((i) => i.albumId))];
  const [filter, setFilter] = useState<'all' | 'failed'>('all');
  const shown = filter === 'failed' ? items.filter((i) => i.status === 'error') : items;

  return (
    <>
      <PageHeader title="アップロード" back />
      <main className="mx-auto max-w-2xl py-4">
        {items.length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="size-7" />} title="アップロード中のファイルはありません" />
        ) : (
          <>
            <section className="px-safe">
              <div className="rounded-2xl bg-surface p-5 shadow-sm">
                <div className="flex items-end justify-between">
                  <p className="text-3xl font-bold tabular-nums">{sum.percent}%</p>
                  <p className="text-sm text-ink-2">
                    {sum.remaining > 0 ? `残り ${sum.remaining} 件` : '完了しました'}
                  </p>
                </div>
                <ProgressBar value={sum.percent / 100} className="mt-3 h-2" />
                <p className="mt-3 text-xs text-ink-3">
                  完了 {sum.done} / {sum.total} 件
                  {sum.duplicates > 0 && ` ・ スキップ ${sum.duplicates} 件`}
                  {sum.failed > 0 && <span className="text-danger"> ・ 失敗 {sum.failed} 件</span>}
                </p>
                {sum.remaining > 0 && (
                  <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-xs text-ink-2">
                    アップロード中はこの画面 (またはアプリ) を開いたままにしてください。画面を閉じると中断されますが、再開すると続きから送信します。
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {sum.failed > 0 && (
                    <Button size="sm" onClick={retryAllFailed}>
                      <RotateCw className="size-4" />
                      失敗した {sum.failed} 件を再試行
                    </Button>
                  )}
                  {sum.remaining === 0 && (
                    <Button size="sm" variant="secondary" onClick={clearFinished}>
                      <Trash2 className="size-4" />
                      完了したものを消去
                    </Button>
                  )}
                  {albumIds.length === 1 && (
                    <Link to={`/albums/${albumIds[0]}`}>
                      <Button size="sm" variant="secondary">
                        アルバムを見る
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            </section>

            {sum.failed > 0 && (
              <div className="px-safe mt-4 flex gap-2">
                <button onClick={() => setFilter('all')} className={`rounded-full px-3 py-1 text-sm ${filter === 'all' ? 'bg-ink text-bg' : 'bg-surface-2'}`}>
                  すべて
                </button>
                <button onClick={() => setFilter('failed')} className={`rounded-full px-3 py-1 text-sm ${filter === 'failed' ? 'bg-ink text-bg' : 'bg-surface-2'}`}>
                  失敗のみ
                </button>
              </div>
            )}

            <ul className="mt-3 divide-y divide-line">
              {shown.map((item) => (
                <UploadRow key={item.id} item={item} />
              ))}
            </ul>
          </>
        )}
      </main>
    </>
  );
}
