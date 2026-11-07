import { memo, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download, ImageOff, Play } from 'lucide-react';
import { useSignedUrl } from '@/lib/signedUrls';
import { formatDuration, formatMonth, monthKey } from '@/lib/format';
import type { Photo, PhotoWithUploader } from '@/types/db';
import { Spinner } from '@/components/ui';

export const PhotoThumb = memo(function PhotoThumb({ photo, className = '' }: { photo: Photo; className?: string }) {
  const url = useSignedUrl('photos', photo.thumb_path);
  return (
    <div className={`relative overflow-hidden bg-surface-2 ${className}`}>
      {url ? (
        <img src={url} alt="" loading="lazy" decoding="async" className="animate-fade-in size-full object-cover" />
      ) : !photo.thumb_path ? (
        <div className="flex size-full items-center justify-center text-ink-3">
          {photo.media_type === 'video' ? <Play className="size-7" /> : <ImageOff className="size-6" />}
        </div>
      ) : null}
      {photo.media_type === 'video' && (
        <span className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">
          <Play className="size-3 fill-current" />
          {formatDuration(photo.duration_sec)}
        </span>
      )}
    </div>
  );
});

interface Props {
  photos: PhotoWithUploader[];
  albumId: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  query?: string;
  /** 複数選択モード (指定時はタップで選択の切替) */
  selection?: {
    selected: Set<string>;
    canSelect: (p: PhotoWithUploader) => boolean;
    onToggle: (p: PhotoWithUploader) => void;
    /** 保存済みの写真 (選択時に印を表示) */
    savedIds?: Set<string>;
  } | null;
  /** 長押しで選択モードを開始 */
  onLongPress?: (p: PhotoWithUploader) => void;
}

const LONG_PRESS_MS = 450;

/** 月別の見出し付きグリッド + 無限スクロール */
export function PhotoGrid({ photos, albumId, hasMore, loadingMore, onLoadMore, query = '', selection, onLongPress }: Props) {
  const sentinel = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  const startPress = (p: PhotoWithUploader) => {
    longPressed.current = false;
    if (!onLongPress || selection) return;
    cancelPress();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      navigator.vibrate?.(15);
      onLongPress(p);
    }, LONG_PRESS_MS);
  };

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: PhotoWithUploader[] }>();
    for (const p of photos) {
      const k = monthKey(p.sort_at);
      let g = map.get(k);
      if (!g) map.set(k, (g = { label: formatMonth(p.sort_at), items: [] }));
      g.items.push(p);
    }
    return [...map.entries()];
  }, [photos]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && onLoadMore(), { rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore]);

  return (
    <div>
      {groups.map(([key, g]) => (
        <section key={key} className="cv-auto">
          <h2 className="px-safe sticky top-[calc(var(--sat)+3.5rem)] z-10 bg-bg/90 py-2 text-sm font-semibold backdrop-blur">{g.label}</h2>
          <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {g.items.map((p) => {
              const label = `${p.media_type === 'video' ? '動画' : '写真'} (${p.uploader?.display_name ?? ''})`;
              if (selection) {
                const selectable = selection.canSelect(p);
                const checked = selection.selected.has(p.id);
                const saved = selection.savedIds?.has(p.id) ?? false;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={`${label}${saved ? ' (保存済み)' : ''}${selectable ? '' : ' (選択できません)'}`}
                    disabled={!selectable}
                    onClick={() => selection.onToggle(p)}
                    className="relative block aspect-square disabled:opacity-35"
                  >
                    <PhotoThumb photo={p} className={`size-full transition-transform ${checked ? 'scale-[0.88] rounded-md' : ''}`} />
                    {selectable && (
                      <span
                        className={`absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full border-2 ${
                          checked ? 'border-accent bg-accent text-accent-ink' : 'border-white bg-black/25'
                        }`}
                      >
                        {checked && <Check className="size-4" strokeWidth={3} />}
                      </span>
                    )}
                    {saved && (
                      <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        <Download className="size-3" />
                        保存済み
                      </span>
                    )}
                  </button>
                );
              }
              return (
                <Link
                  key={p.id}
                  to={`/albums/${albumId}/photos/${p.id}${query}`}
                  className="block aspect-square select-none focus-visible:outline-2 focus-visible:outline-accent [-webkit-touch-callout:none]"
                  aria-label={label}
                  onPointerDown={() => startPress(p)}
                  onPointerUp={cancelPress}
                  onPointerLeave={cancelPress}
                  onPointerCancel={cancelPress}
                  onContextMenu={(e) => onLongPress && e.preventDefault()}
                  onClick={(e) => {
                    // 長押しで選択を始めたときは写真を開かない
                    if (longPressed.current) {
                      e.preventDefault();
                      longPressed.current = false;
                    }
                  }}
                >
                  <PhotoThumb photo={p} className="size-full" />
                </Link>
              );
            })}
          </div>
        </section>
      ))}
      <div ref={sentinel} className="flex h-16 items-center justify-center">
        {loadingMore && <Spinner />}
      </div>
    </div>
  );
}
