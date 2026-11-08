import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { formatRelative } from '@/lib/format';
import type { AppNotification } from '@/types/db';
import { useAuth } from '@/features/auth/AuthProvider';
import { Avatar, EmptyState, FullPageSpinner, PageHeader } from '@/components/ui';
import { markAllRead, useNotifications } from './api';

function describe(n: AppNotification): { text: string; to: string } {
  const who = n.actor?.display_name ?? 'メンバー';
  const album = n.data.album_title ? `「${n.data.album_title}」` : 'アルバム';
  const albumTo = n.album_id ? `/albums/${n.album_id}` : '/albums';
  const photoTo = n.album_id && n.photo_id ? `/albums/${n.album_id}/photos/${n.photo_id}` : albumTo;
  switch (n.type) {
    case 'photo_added':
      return { text: `${who} さんが${album}に写真を ${n.data.count ?? 1} 件追加しました`, to: albumTo };
    case 'member_joined':
      return { text: `${who} さんが${album}に参加しました`, to: n.album_id ? `/albums/${n.album_id}/members` : albumTo };
    case 'comment':
      return { text: `${who} さんがコメントしました: ${n.data.excerpt ?? ''}`, to: photoTo };
    case 'reaction':
      return { text: `${who} さんがあなたの写真に ${n.data.emoji ?? '❤️'} でリアクションしました`, to: photoTo };
    case 'join_request':
      return { text: `${who} さんが${album}への参加をリクエストしています`, to: n.album_id ? `/albums/${n.album_id}/members` : albumTo };
    case 'join_approved':
      return { text: `${album}への参加が承認されました`, to: albumTo };
    case 'join_rejected':
      return { text: `${album}への参加リクエストは承認されませんでした`, to: '/albums' };
    case 'invite_permission_granted':
      return { text: `${who} さんから、${album}に家族や友だちを招待できるようになりました`, to: n.album_id ? `/albums/${n.album_id}/invite` : albumTo };
  }
}

export function NotificationsPage() {
  const { userId } = useAuth();
  const { data, isLoading } = useNotifications();

  // 開いたら既読にする (表示は今回開いた時点の未読状態を保つ)
  useEffect(() => {
    if (userId && data?.some((n) => !n.read_at)) {
      const t = setTimeout(() => void markAllRead(userId), 800);
      return () => clearTimeout(t);
    }
  }, [userId, data]);

  return (
    <>
      <PageHeader title="お知らせ" />
      <main className="mx-auto max-w-2xl">
        {isLoading ? (
          <FullPageSpinner />
        ) : !data || data.length === 0 ? (
          <EmptyState icon={<Bell className="size-7" />} title="お知らせはまだありません">
            写真の追加やコメントがあるとここに表示されます。
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {data.map((n) => {
              const { text, to } = describe(n);
              return (
                <li key={n.id}>
                  <Link to={to} className={`px-safe flex items-start gap-3 py-3.5 transition hover:bg-surface-2 ${n.read_at ? '' : 'bg-accent-soft/50'}`}>
                    <Avatar path={n.actor?.avatar_path} name={n.actor?.display_name} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-base leading-snug">{text}</p>
                      <p className="mt-1 text-xs text-ink-3">{formatRelative(n.created_at)}</p>
                    </div>
                    {!n.read_at && <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-label="未読" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
