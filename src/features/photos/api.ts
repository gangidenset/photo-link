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

/**
 * 複数の写真をまとめて削除する (Storage のファイル → DB の行の順)
 * @returns 実際に削除できた件数 (権限のない写真は RLS により削除されない)
 */
export async function deletePhotos(photos: PhotoWithUploader[]): Promise<number> {
  if (photos.length === 0) return 0;
  const paths = photos.flatMap((p) => [p.storage_path, p.thumb_path, p.preview_path].filter(Boolean) as string[]);
  await removeStorageFiles(paths);
  let deleted = 0;
  // URL が長くなりすぎないよう 100 件ずつ
  for (let i = 0; i < photos.length; i += 100) {
    const ids = photos.slice(i, i + 100).map((p) => p.id);
    const { error, count } = await supabase.from('photos').delete({ count: 'exact' }).in('id', ids);
    if (error) throw error;
    deleted += count ?? 0;
  }
  const albumIds = [...new Set(photos.map((p) => p.album_id))];
  for (const albumId of albumIds) {
    void queryClient.invalidateQueries({ queryKey: ['photos', albumId] });
    void queryClient.invalidateQueries({ queryKey: ['album', albumId] });
  }
  void queryClient.invalidateQueries({ queryKey: ['albums'] });
  void queryClient.invalidateQueries({ queryKey: ['recent-photos'] });
  void queryClient.invalidateQueries({ queryKey: ['usage'] });
  return deleted;
}

// ---------------------------------------------------------------- 保存済みの記録 (重複保存の確認用)
export function useDownloadedIds(albumId: string | undefined) {
  return useQuery({
    queryKey: ['downloads', albumId],
    enabled: !!albumId,
    queryFn: async () => {
      const ids = new Set<string>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('photo_downloads')
          .select('photo_id')
          .eq('album_id', albumId!)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        data?.forEach((r) => ids.add(r.photo_id as string));
        if (!data || data.length < PAGE) break;
      }
      return ids;
    },
  });
}

/** 保存した写真を記録 (失敗しても保存自体は成功しているため、エラーは握りつぶして警告のみ) */
export async function markDownloaded(photos: Pick<PhotoWithUploader, 'id' | 'album_id'>[]) {
  for (let i = 0; i < photos.length; i += 500) {
    const { error } = await supabase.rpc('mark_photos_downloaded', { p_photo_ids: photos.slice(i, i + 500).map((p) => p.id) });
    if (error) console.warn('mark downloaded failed', error);
  }
  for (const albumId of new Set(photos.map((p) => p.album_id))) {
    void queryClient.invalidateQueries({ queryKey: ['downloads', albumId] });
  }
}

/** 保存済みの記録を取り消す (端末と照合して、実際には持っていなかった写真) */
export async function unmarkDownloaded(photos: Pick<PhotoWithUploader, 'id' | 'album_id'>[]) {
  for (let i = 0; i < photos.length; i += 100) {
    const { error } = await supabase
      .from('photo_downloads')
      .delete()
      .in('photo_id', photos.slice(i, i + 100).map((p) => p.id));
    if (error) console.warn('unmark downloaded failed', error);
  }
  for (const albumId of new Set(photos.map((p) => p.album_id))) {
    void queryClient.invalidateQueries({ queryKey: ['downloads', albumId] });
  }
}

/**
 * アルバム内の写真をすべて取得 (画面に読み込み済みかどうかに関係なく)
 * @param excludeUploaderId 指定するとその人の投稿を除く (「他のメンバーの写真」用)
 */
export async function fetchAllAlbumPhotos(albumId: string, excludeUploaderId?: string): Promise<PhotoWithUploader[]> {
  const all: PhotoWithUploader[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('photos')
      .select(PHOTO_SELECT)
      .eq('album_id', albumId)
      .eq('status', 'ready')
      .order('sort_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE - 1);
    if (excludeUploaderId) q = q.neq('uploader_id', excludeUploaderId);
    const { data, error } = await q;
    if (error) throw error;
    all.push(...((data ?? []) as unknown as PhotoWithUploader[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
}
