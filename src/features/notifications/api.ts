import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import type { AppNotification } from '@/types/db';
import { useAuth } from '@/features/auth/AuthProvider';

export function useNotifications() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['notifications', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*, actor:profiles!notifications_actor_id_fkey(id, display_name, avatar_path)')
        .eq('recipient_id', userId!)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as AppNotification[];
    },
  });
}

export function useUnreadCount() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['notifications-unread', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', userId!)
        .is('read_at', null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export async function markAllRead(userId: string) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)
    .is('read_at', null);
  if (error) throw error;
  void queryClient.invalidateQueries({ queryKey: ['notifications-unread', userId] });
}

/** Realtime: 新しい通知が来たら件数と一覧を更新 (RLS により自分宛てのみ届く) */
export function useNotificationRealtime() {
  const { userId } = useAuth();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['notifications-unread', userId] });
          void queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
          // 新しい写真の通知ならアルバム一覧も更新
          void queryClient.invalidateQueries({ queryKey: ['albums'] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}
