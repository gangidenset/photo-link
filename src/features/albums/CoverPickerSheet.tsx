// アルバムのカバー画像を、アルバム内の写真から選ぶシート (オーナーのみ)
//   ※ カバーにできるのは写真 (動画は不可)。DB 側でも同じアルバムの写真であることを確認している
import { useMemo, useState } from 'react';
import { Check, ImageOff } from 'lucide-react';
import { toMessage } from '@/lib/errors';
import { Button, Sheet, Spinner } from '@/components/ui';
import { toast } from '@/components/toast';
import { useAlbumPhotos } from '@/features/photos/api';
import { PhotoThumb } from '@/features/photos/PhotoGrid';
import { setAlbumCover } from './api';

interface Props {
  open: boolean;
  onClose: () => void;
  albumId: string;
  currentCoverId: string | null;
}

export function CoverPickerSheet({ open, onClose, albumId, currentCoverId }: Props) {
  const photos = useAlbumPhotos(open ? albumId : undefined, null);
  const [saving, setSaving] = useState<string | null>(null);
  const candidates = useMemo(
    () => (photos.data?.pages.flat() ?? []).filter((p) => p.media_type === 'image' && p.thumb_path),
    [photos.data],
  );

  async function choose(photoId: string) {
    if (photoId === currentCoverId) return onClose();
    setSaving(photoId);
    try {
      await setAlbumCover(albumId, photoId);
      toast('カバー画像を変更しました');
      onClose();
    } catch (e) {
      toast(toMessage(e), 'error');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="カバー画像を選ぶ">
      <div className="px-4 pb-6">
        {photos.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : candidates.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-ink-2">
            <ImageOff className="size-8 text-ink-3" />
            カバーにできる写真がありません。先に写真を追加してください。
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5 p-1 sm:grid-cols-4">
              {candidates.map((p) => {
                const current = p.id === currentCoverId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void choose(p.id)}
                    disabled={!!saving}
                    aria-label={current ? '現在のカバー' : 'この写真をカバーにする'}
                    aria-pressed={current}
                    className={`relative aspect-square overflow-hidden rounded-lg ${current ? 'ring-3 ring-accent ring-offset-2 ring-offset-surface' : ''}`}
                  >
                    <PhotoThumb photo={p} className="size-full" />
                    {current && (
                      <span className="absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full bg-accent text-accent-ink">
                        <Check className="size-4" strokeWidth={3} />
                      </span>
                    )}
                    {saving === p.id && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <Spinner className="text-white" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {photos.hasNextPage && (
              <Button
                variant="secondary"
                block
                className="mt-4"
                loading={photos.isFetchingNextPage}
                onClick={() => void photos.fetchNextPage()}
              >
                さらに表示
              </Button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
