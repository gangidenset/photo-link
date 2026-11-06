import { memo, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ImageOff, Play } from 'lucide-react';
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
}

/** 月別の見出し付きグリッド + 無限スクロール */
export function PhotoGrid({ photos, albumId, hasMore, loadingMore, onLoadMore, query = '' }: Props) {
  const sentinel = useRef<HTMLDivElement>(null);

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
            {g.items.map((p) => (
              <Link
                key={p.id}
                to={`/albums/${albumId}/photos/${p.id}${query}`}
                className="block aspect-square focus-visible:outline-2 focus-visible:outline-accent"
                aria-label={`${p.media_type === 'video' ? '動画' : '写真'} (${p.uploader?.display_name ?? ''})`}
              >
                <PhotoThumb photo={p} className="size-full" />
              </Link>
            ))}
          </div>
        </section>
      ))}
      <div ref={sentinel} className="flex h-16 items-center justify-center">
        {loadingMore && <Spinner />}
      </div>
    </div>
  );
}
