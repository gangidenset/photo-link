import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, ImageIcon, Info, Loader2, MoreHorizontal, Share, Trash2, X } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { setAlbumCover, useAlbum } from '@/features/albums/api';
import { CommentsSheet, ReactionBar, useComments } from '@/features/social/Social';
import { getSignedUrl, peekSignedUrl, useSignedUrl } from '@/lib/signedUrls';
import { toMessage } from '@/lib/errors';
import { formatBytes, formatDateTime, formatDuration } from '@/lib/format';
import type { PhotoWithUploader } from '@/types/db';
import { Avatar, Button, IconButton, Sheet, SheetItem, Spinner } from '@/components/ui';
import { toast } from '@/components/toast';
import { deletePhoto, useAlbumPhotos, usePhoto } from './api';
import { directDownload, fetchOriginalFile, prefersShareSheet, shareFile } from './download';
import { useGestures } from './useGestures';

/** このブラウザでオリジナルを直接表示できるか (HEIC は Safari のみ) */
function canDisplayOriginal(mime: string) {
  if (mime === 'image/heic' || mime === 'image/heif') {
    return /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|Android/.test(navigator.userAgent);
  }
  return mime.startsWith('image/');
}

export function PhotoViewerPage() {
  const { albumId, photoId } = useParams();
  const [params] = useSearchParams();
  const by = params.get('by');
  const navigate = useNavigate();
  const { userId } = useAuth();
  const { data: album } = useAlbum(albumId);
  const list = useAlbumPhotos(albumId, by);
  const photos = useMemo(() => list.data?.pages.flat() ?? [], [list.data]);
  const index = photos.findIndex((p) => p.id === photoId);
  const single = usePhoto(index === -1 ? photoId : undefined);
  const photo: PhotoWithUploader | null | undefined = index >= 0 ? photos[index] : single.data;
  const prev = index > 0 ? photos[index - 1] : null;
  const next = index >= 0 && index < photos.length - 1 ? photos[index + 1] : null;

  const [uiVisible, setUiVisible] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [preparedFile, setPreparedFile] = useState<File | null>(null);
  const [downloading, setDownloading] = useState(false);
  const { data: comments = [] } = useComments(photo?.id);

  const query = by ? `?by=${by}` : '';
  const go = useCallback(
    (p: PhotoWithUploader | null) => p && navigate(`/albums/${albumId}/photos/${p.id}${query}`, { replace: true }),
    [albumId, navigate, query],
  );
  const close = useCallback(() => navigate(`/albums/${albumId}${query}`, { replace: true }), [albumId, navigate, query]);

  const { state, reset, handlers } = useGestures({
    onPrev: () => go(prev),
    onNext: () => go(next),
    onClose: close,
    onTap: () => setUiVisible((v) => !v),
  });

  // 写真が変わったらズームをリセット
  useEffect(() => {
    reset();
    setPreparedFile(null);
  }, [photoId, reset]);

  // 終わりに近づいたら次のページを読み込む
  useEffect(() => {
    if (index >= 0 && index > photos.length - 5 && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, [index, photos.length, list]);

  // 前後の写真を先読み
  useEffect(() => {
    for (const p of [prev, next]) {
      const url = p && peekSignedUrl('photos', p.preview_path ?? p.thumb_path);
      if (url) new Image().src = url;
    }
  }, [prev, next]);

  // キーボード操作 (PC)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (commentsOpen || infoOpen || menuOpen) return;
      if (e.key === 'ArrowLeft') go(prev);
      else if (e.key === 'ArrowRight') go(next);
      else if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, prev, next, close, commentsOpen, infoOpen, menuOpen]);

  const isAlbumOwner = album?.owner_id === userId;
  const canDelete = photo && (photo.uploader_id === userId || isAlbumOwner);

  async function onDownload() {
    if (!photo) return;
    setMenuOpen(false);
    setDownloading(true);
    try {
      if (prefersShareSheet(photo)) {
        setPreparedFile(await fetchOriginalFile(photo)); // 次のタップで共有シートを開く
      } else {
        await directDownload(photo);
      }
    } catch (e) {
      toast(toMessage(e), 'error');
    } finally {
      setDownloading(false);
    }
  }

  async function onDelete() {
    if (!photo || !window.confirm('この写真を削除しますか？元に戻せません。')) return;
    setMenuOpen(false);
    const target = next ?? prev;
    try {
      await deletePhoto(photo);
      toast('削除しました');
      if (target) go(target);
      else close();
    } catch (e) {
      toast(toMessage(e), 'error');
    }
  }

  if (!photo) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black text-white">
        {list.isLoading || single.isLoading ? <Spinner /> : <p>写真が見つかりません</p>}
        <button className="pt-safe absolute top-0 left-0 p-4" onClick={close} aria-label="閉じる">
          <X className="size-6" />
        </button>
      </div>
    );
  }

  const bgOpacity = Math.max(0.4, 1 - state.dragY / 400);

  return (
    <div className="fixed inset-0 z-50 overflow-hidden text-white select-none" style={{ backgroundColor: `rgba(0,0,0,${bgOpacity})` }}>
      {/* メディア */}
      {photo.media_type === 'video' ? (
        <VideoSlide photo={photo} />
      ) : (
        <div className="absolute inset-0 touch-none" {...handlers}>
          <div
            className="flex size-full items-center justify-center"
            style={{
              transform: `translate3d(${state.x + state.dragX}px, ${state.y + state.dragY}px, 0) scale(${state.scale * (1 - state.dragY / 1500)})`,
              transition: state.animating ? 'transform 0.25s ease-out' : 'none',
            }}
          >
            <ImageSlide photo={photo} />
          </div>
        </div>
      )}

      {/* 上部バー */}
      <div
        className={`pt-safe absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent transition-opacity ${uiVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <div className="px-safe flex h-14 items-center gap-2">
          <IconButton label="閉じる" className="-ml-2 hover:bg-white/10" onClick={close}>
            <X className="size-6" />
          </IconButton>
          <Avatar path={photo.uploader?.avatar_path} name={photo.uploader?.display_name} size={30} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold">{photo.uploader?.display_name ?? '退会したメンバー'}</p>
            <p className="truncate text-xs text-white/70">{formatDateTime(photo.taken_at ?? photo.created_at)}</p>
          </div>
          <IconButton label="詳細情報" className="hover:bg-white/10" onClick={() => setInfoOpen(true)}>
            <Info className="size-5" />
          </IconButton>
          <IconButton label="メニュー" className="hover:bg-white/10" onClick={() => setMenuOpen(true)}>
            <MoreHorizontal className="size-5" />
          </IconButton>
        </div>
      </div>

      {/* 前後ボタン (PC・動画用) */}
      {uiVisible && prev && (
        <button aria-label="前の写真" onClick={() => go(prev)} className="absolute top-1/2 left-2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 sm:block">
          <ChevronLeft className="size-6" />
        </button>
      )}
      {uiVisible && next && (
        <button aria-label="次の写真" onClick={() => go(next)} className="absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 sm:block">
          <ChevronRight className="size-6" />
        </button>
      )}

      {/* 下部バー */}
      <div
        className={`pb-safe absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent transition-opacity ${uiVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <div className="px-safe mx-auto flex max-w-2xl items-center gap-1 pt-6 pb-2">
          <div className="min-w-0 flex-1">
            <ReactionBar photoId={photo.id} commentCount={comments.length} onOpenComments={() => setCommentsOpen(true)} />
          </div>
          {photo.media_type === 'video' && (prev || next) && (
            <div className="flex sm:hidden">
              <IconButton label="前へ" disabled={!prev} onClick={() => go(prev)} className="disabled:opacity-30">
                <ChevronLeft className="size-6" />
              </IconButton>
              <IconButton label="次へ" disabled={!next} onClick={() => go(next)} className="disabled:opacity-30">
                <ChevronRight className="size-6" />
              </IconButton>
            </div>
          )}
          <IconButton label="ダウンロード" className="hover:bg-white/10" onClick={onDownload} disabled={downloading}>
            {downloading ? <Loader2 className="size-5 animate-spin" /> : <Download className="size-5" />}
          </IconButton>
        </div>
      </div>

      {/* iPhone: 取得完了後、タップで共有シート (「画像を保存」で写真アプリへ) */}
      {preparedFile && (
        <div className="absolute inset-x-0 bottom-28 flex justify-center px-4">
          <Button
            className="shadow-xl"
            onClick={async () => {
              const r = await shareFile(preparedFile);
              if (r !== 'canceled') setPreparedFile(null);
            }}
          >
            <Share className="size-5" />
            保存・共有する
          </Button>
        </div>
      )}

      <CommentsSheet open={commentsOpen} onClose={() => setCommentsOpen(false)} photoId={photo.id} isAlbumOwner={isAlbumOwner} />

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)}>
        <div className="py-2">
          <SheetItem icon={<Download className="size-5" />} onClick={onDownload}>
            オリジナルをダウンロード
          </SheetItem>
          {isAlbumOwner && photo.media_type === 'image' && photo.thumb_path && (
            <SheetItem
              icon={<ImageIcon className="size-5" />}
              onClick={async () => {
                setMenuOpen(false);
                try {
                  await setAlbumCover(photo.album_id, photo.id);
                  toast('カバーに設定しました');
                } catch (e) {
                  toast(toMessage(e), 'error');
                }
              }}
            >
              アルバムのカバーに設定
            </SheetItem>
          )}
          {canDelete && (
            <SheetItem icon={<Trash2 className="size-5" />} danger onClick={onDelete}>
              削除
            </SheetItem>
          )}
        </div>
      </Sheet>

      <Sheet open={infoOpen} onClose={() => setInfoOpen(false)} title="詳細情報">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 px-5 pb-6 text-sm">
          <dt className="text-ink-3">投稿者</dt>
          <dd>{photo.uploader?.display_name ?? '退会したメンバー'}</dd>
          <dt className="text-ink-3">撮影日時</dt>
          <dd>{photo.taken_at ? formatDateTime(photo.taken_at) : '不明'}</dd>
          <dt className="text-ink-3">投稿日時</dt>
          <dd>{formatDateTime(photo.created_at)}</dd>
          <dt className="text-ink-3">ファイル名</dt>
          <dd className="break-all">{photo.original_filename || '-'}</dd>
          <dt className="text-ink-3">サイズ</dt>
          <dd>
            {formatBytes(photo.size_bytes)}
            {photo.width && photo.height && ` ・ ${photo.width} × ${photo.height}`}
            {photo.duration_sec != null && ` ・ ${formatDuration(photo.duration_sec)}`}
          </dd>
          <dt className="text-ink-3">形式</dt>
          <dd>{photo.mime_type}</dd>
        </dl>
      </Sheet>
    </div>
  );
}

function ImageSlide({ photo }: { photo: PhotoWithUploader }) {
  const thumb = useSignedUrl('photos', photo.thumb_path);
  const preview = useSignedUrl('photos', photo.preview_path);
  const [original, setOriginal] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // プレビューがない (古い端末で生成失敗など) 場合のみオリジナルを表示
  useEffect(() => {
    setLoaded(false);
    setOriginal(null);
    if (!photo.preview_path && canDisplayOriginal(photo.mime_type)) {
      getSignedUrl('photos', photo.storage_path).then(setOriginal).catch(() => undefined);
    }
  }, [photo]);

  const src = preview ?? original;
  return (
    <div className="relative flex size-full items-center justify-center">
      {thumb && !loaded && <img src={thumb} alt="" className="absolute max-h-full max-w-full object-contain blur-sm" draggable={false} />}
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={`relative max-h-full max-w-full object-contain transition-opacity ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {!thumb && !src && <Spinner />}
    </div>
  );
}

function VideoSlide({ photo }: { photo: PhotoWithUploader }) {
  const poster = useSignedUrl('photos', photo.thumb_path);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    setSrc(null);
    setError(false);
    getSignedUrl('photos', photo.storage_path).then(setSrc).catch(() => setError(true));
  }, [photo]);
  return (
    <div className="absolute inset-0 flex items-center justify-center pt-14 pb-24">
      {error ? (
        <p className="px-6 text-center text-sm text-white/80">
          この端末では再生できない形式の可能性があります。ダウンロードしてお試しください。
        </p>
      ) : src ? (
        <video
          key={src}
          src={src}
          poster={poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          className="max-h-full max-w-full"
          onError={() => setError(true)}
        />
      ) : (
        <Spinner />
      )}
    </div>
  );
}
