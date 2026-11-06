import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import type { AlbumMember, AlbumWithCover, Invitation, JoinRequest, MyUsage } from '@/types/db';

const ALBUM_SELECT = '*, cover:photos!albums_cover_photo_id_fkey(id, thumb_path, preview_path)';

export function useAlbums() {
  return useQuery({
    queryKey: ['albums'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('albums')
        .select(ALBUM_SELECT)
        .order('last_photo_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as AlbumWithCover[];
    },
  });
}

export function useAlbum(albumId: string | undefined) {
  return useQuery({
    queryKey: ['album', albumId],
    enabled: !!albumId,
    queryFn: async () => {
      const { data, error } = await supabase.from('albums').select(ALBUM_SELECT).eq('id', albumId!).maybeSingle();
      if (error) throw error;
      return data as unknown as AlbumWithCover | null;
    },
  });
}

export function useMembers(albumId: string | undefined) {
  return useQuery({
    queryKey: ['members', albumId],
    enabled: !!albumId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('album_members')
        .select('*, profile:profiles(id, display_name, avatar_path)')
        .eq('album_id', albumId!)
        .order('joined_at');
      if (error) throw error;
      return data as unknown as AlbumMember[];
    },
  });
}

export function useInvitations(albumId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['invitations', albumId],
    enabled: !!albumId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select('*')
        .eq('album_id', albumId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Invitation[];
    },
  });
}

export function useJoinRequests(albumId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['join-requests', albumId],
    enabled: !!albumId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('join_requests')
        .select('*, profile:profiles!join_requests_user_id_fkey(id, display_name, avatar_path)')
        .eq('album_id', albumId!)
        .eq('status', 'pending')
        .order('created_at');
      if (error) throw error;
      return data as unknown as JoinRequest[];
    },
  });
}

export function useMyUsage() {
  return useQuery({
    queryKey: ['usage'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_my_usage');
      if (error) throw error;
      return data as MyUsage;
    },
  });
}

export function useSaveAlbum() {
  return useMutation({
    mutationFn: async (input: { id?: string; title: string; description: string; ownerId: string }) => {
      if (input.id) {
        const { error } = await supabase
          .from('albums')
          .update({ title: input.title, description: input.description })
          .eq('id', input.id);
        if (error) throw error;
        return input.id;
      }
      const { data, error } = await supabase
        .from('albums')
        .insert({ title: input.title, description: input.description, owner_id: input.ownerId })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ['albums'] });
      void queryClient.invalidateQueries({ queryKey: ['album', id] });
      void queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}

export async function setAlbumCover(albumId: string, photoId: string) {
  const { error } = await supabase.from('albums').update({ cover_photo_id: photoId }).eq('id', albumId);
  if (error) throw error;
  void queryClient.invalidateQueries({ queryKey: ['albums'] });
  void queryClient.invalidateQueries({ queryKey: ['album', albumId] });
}

/** Storage のファイルを 100 件ずつ削除 */
export async function removeStorageFiles(paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from('photos').remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
}

/** アルバム削除: 先に Storage のファイルを消してから DB の行を消す */
export async function deleteAlbum(albumId: string) {
  const paths: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('photos')
      .select('storage_path, thumb_path, preview_path')
      .eq('album_id', albumId)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const p of data ?? []) {
      paths.push(p.storage_path);
      if (p.thumb_path) paths.push(p.thumb_path);
      if (p.preview_path) paths.push(p.preview_path);
    }
    if (!data || data.length < PAGE) break;
  }
  await removeStorageFiles(paths);
  const { error } = await supabase.from('albums').delete().eq('id', albumId);
  if (error) throw error;
  queryClient.removeQueries({ queryKey: ['album', albumId] });
  queryClient.removeQueries({ queryKey: ['photos', albumId] });
  void queryClient.invalidateQueries({ queryKey: ['albums'] });
  void queryClient.invalidateQueries({ queryKey: ['usage'] });
}
