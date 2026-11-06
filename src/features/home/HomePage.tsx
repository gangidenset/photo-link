import { Link } from 'react-router-dom';
import { ChevronRight, FolderPlus, Images, KeyRound } from 'lucide-react';
import { useMyProfile } from '@/features/auth/AuthProvider';
import { useAlbums } from '@/features/albums/api';
import { AlbumCover } from '@/features/albums/AlbumCover';
import { useRecentPhotos } from '@/features/photos/api';
import { PhotoThumb } from '@/features/photos/PhotoGrid';
import { formatRelative } from '@/lib/format';
import { EmptyState, FullPageSpinner } from '@/components/ui';
import { InstallBanner } from '@/features/profile/install';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'こんばんは';
  if (h < 11) return 'おはようございます';
  if (h < 18) return 'こんにちは';
  return 'こんばんは';
}

export function HomePage() {
  const { data: profile } = useMyProfile();
  const { data: albums, isLoading } = useAlbums();
  const { data: recent } = useRecentPhotos();

  return (
    <main className="pt-safe mx-auto max-w-5xl">
      <header className="px-safe pt-6 pb-4">
        <p className="text-sm text-ink-2">{greeting()}</p>
        <h1 className="text-2xl font-bold tracking-tight">{profile?.display_name ?? ''} さん</h1>
      </header>

      <div className="px-safe">
        <InstallBanner />
      </div>

      <div className="px-safe grid grid-cols-2 gap-3">
        <Link to="/albums/new" className="flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-sm transition active:scale-[0.98]">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <FolderPlus className="size-5" />
          </span>
          <span className="text-sm font-semibold">アルバム作成</span>
        </Link>
        <Link to="/join" className="flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-sm transition active:scale-[0.98]">
          <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-ink-2">
            <KeyRound className="size-5" />
          </span>
          <span className="text-sm font-semibold">コードで参加</span>
        </Link>
      </div>

      {isLoading ? (
        <FullPageSpinner />
      ) : !albums || albums.length === 0 ? (
        <EmptyState icon={<Images className="size-7" />} title="ようこそ PhotoLink へ">
          <p>アルバムを作って家族や友人を招待するか、受け取った招待リンク・コードから参加しましょう。</p>
        </EmptyState>
      ) : (
        <>
          <section className="mt-8">
            <div className="px-safe mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">アルバム</h2>
              <Link to="/albums" className="flex items-center text-sm text-ink-2">
                すべて <ChevronRight className="size-4" />
              </Link>
            </div>
            <div className="no-scrollbar flex snap-x gap-3 overflow-x-auto px-4 pb-1">
              {albums.slice(0, 10).map((a) => (
                <Link key={a.id} to={`/albums/${a.id}`} className="w-36 shrink-0 snap-start">
                  <AlbumCover path={a.cover?.thumb_path} className="aspect-square rounded-2xl" large />
                  <p className="mt-1.5 truncate text-sm font-semibold">{a.title}</p>
                  <p className="text-xs text-ink-3">{a.last_photo_at ? formatRelative(a.last_photo_at) : `${a.photo_count} 枚`}</p>
                </Link>
              ))}
            </div>
          </section>

          {recent && recent.length > 0 && (
            <section className="mt-8">
              <h2 className="px-safe mb-3 text-lg font-bold">最近の写真</h2>
              <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-6">
                {recent.map((p) => (
                  <Link key={p.id} to={`/albums/${p.album_id}/photos/${p.id}`} className="aspect-square">
                    <PhotoThumb photo={p} className="size-full" />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
