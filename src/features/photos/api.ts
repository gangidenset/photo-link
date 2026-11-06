import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import type { PhotoWithUploader } from '@/types/db';
import { removeStorageFiles } from '@/features/albums/api';

export const PAGE_SIZE = 60;
const PHOTO_SELECT = '*, uploader:profiles!photos_uploader_id_fkey(id, display_name, avatar_path)';

interface Cursor {
  sortAt: string;
  id: string;
}

/**
 * アルバムの写真一覧 (無限スクロール)
 *   新しい写真が追加されてもずれないよう「最後に表示した写真の日時と ID」を起点に次を取得する
 */
export function useAlbumPhotos(albumId: string | undefined, uploaderId: string | null) {
  return useInfiniteQuery({
    queryKey: ['photos', albumId, uploaderId],
    enabled: !!albumId,
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam }) => {
      let q = supabase
        .from('photos')
        .select(PHOTO_SELECT)
        .eq('album_id', albumId!)
        .eq('status', 'ready')
        .order('sort_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);
      if (uploaderId) q = q.eq('uploader_id', uploaderId);
      if (pageParam) {
        q = q.or(`sort_at.lt."${pageParam.sortAt}",and(sort_at.eq."${pageParam.sortAt}",id.lt.${pageParam.id})`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as PhotoWithUploader[];
    },
    getNextPageParam: (last) =>
      last.length < PAGE_SIZE ? null : { sortAt: last[last.length - 1].sort_at, id: last[last.length - 1].id },
  });
}

export function usePhoto(photoId: string | undefined) {
  return useQuery({
    queryKey: ['photo', photoId],
    enabled: !!photoId,
    queryFn: async () => {
      const { data, error } = await supabase.from('photos').select(PHOTO_SELECT).eq('id', photoId!).maybeSingle();
      if (error) throw error;
      return data as unknown as PhotoWithUploader | null;
    },
  });
}

/** ホーム画面用: 参加している全アルバムの最近の写真 */
export function useRecentPhotos() {
  return useQuery({
    queryKey: ['recent-photos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('photos')
        .select(PHOTO_SELECT)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .limit(18);
      if (error) throw error;
      return data as unknown as PhotoWithUploader[];
    },
  });
}

export async function deletePhoto(photo: PhotoWithUploader) {
  const paths = [photo.storage_path, photo.thumb_path, photo.preview_path].filter(Boolean) as string[];
  await removeStorageFiles(paths);
  const { error } = await supabase.from('photos').delete().eq('id', photo.id);
  if (error) throw error;
  void queryClient.invalidateQueries({ queryKey: ['photos', photo.album_id] });
  void queryClient.invalidateQueries({ queryKey: ['album', photo.album_id] });
  void queryClient.invalidateQueries({ queryKey: ['albums'] });
  void queryClient.invalidateQueries({ queryKey: ['recent-photos'] });
  void queryClient.invalidateQueries({ queryKey: ['usage'] });
}
