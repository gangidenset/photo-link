import { Images } from 'lucide-react';
import { useSignedUrl } from '@/lib/signedUrls';

/** アルバムのカバー画像 (未設定ならアイコン) */
export function AlbumCover({ path, className = '', large }: { path: string | null | undefined; className?: string; large?: boolean }) {
  const url = useSignedUrl('photos', path ?? null);
  return (
    <div className={`overflow-hidden bg-surface-2 ${className}`}>
      {url ? (
        <img src={url} alt="" loading="lazy" decoding="async" className="animate-fade-in size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-ink-3">
          <Images className={large ? 'size-10' : 'size-5'} />
        </div>
      )}
    </div>
  );
}
