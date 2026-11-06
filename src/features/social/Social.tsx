import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Heart, Send, SmilePlus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import { toMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import { REACTION_EMOJIS, type Comment, type Reaction } from '@/types/db';
import { Avatar, IconButton, Sheet, Spinner } from '@/components/ui';
import { toast } from '@/components/toast';
import { useAuth } from '@/features/auth/AuthProvider';

// ---------------------------------------------------------------- データ
export function useComments(photoId: string | undefined) {
  return useQuery({
    queryKey: ['comments', photoId],
    enabled: !!photoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comments')
        .select('*, author:profiles!comments_author_id_fkey(id, display_name, avatar_path)')
        .eq('photo_id', photoId!)
        .order('created_at');
      if (error) throw error;
      return data as unknown as Comment[];
    },
  });
}

export function useReactions(photoId: string | undefined) {
  return useQuery({
    queryKey: ['reactions', photoId],
    enabled: !!photoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reactions')
        .select('*, user:profiles!reactions_user_id_fkey(id, display_name, avatar_path)')
        .eq('photo_id', photoId!)
        .order('created_at');
      if (error) throw error;
      return data as unknown as Reaction[];
    },
  });
}

function useToggleReaction(photoId: string) {
  const { userId } = useAuth();
  return useMutation({
    mutationFn: async ({ emoji, active }: { emoji: string; active: boolean }) => {
      if (active) {
        const { error } = await supabase.from('reactions').delete().match({ photo_id: photoId, user_id: userId, emoji });
        if (error) throw error;
      } else {
        const { error } = await supabase.from('reactions').insert({ photo_id: photoId, user_id: userId, emoji });
        if (error && error.code !== '23505') throw error;
      }
    },
    // 押した瞬間に画面へ反映 (通信結果を待たない)
    onMutate: async ({ emoji, active }) => {
      await queryClient.cancelQueries({ queryKey: ['reactions', photoId] });
      const prev = queryClient.getQueryData<Reaction[]>(['reactions', photoId]);
      queryClient.setQueryData<Reaction[]>(['reactions', photoId], (old = []) =>
        active
          ? old.filter((r) => !(r.user_id === userId && r.emoji === emoji))
          : [...old, { photo_id: photoId, user_id: userId!, emoji, created_at: new Date().toISOString(), user: null }],
      );
      return { prev };
    },
    onError: (err, _v, ctx) => {
      queryClient.setQueryData(['reactions', photoId], ctx?.prev);
      toast(toMessage(err), 'error');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['reactions', photoId] }),
  });
}

// ---------------------------------------------------------------- リアクションバー
export function ReactionBar({ photoId, onOpenComments, commentCount }: { photoId: string; onOpenComments: () => void; commentCount: number }) {
  const { userId } = useAuth();
  const { data: reactions = [] } = useReactions(photoId);
  const toggle = useToggleReaction(photoId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [whoOpen, setWhoOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    for (const r of reactions) map.set(r.emoji, [...(map.get(r.emoji) ?? []), r]);
    return [...map.entries()];
  }, [reactions]);
  const liked = reactions.some((r) => r.user_id === userId && r.emoji === '❤️');

  return (
    <div className="flex items-center gap-1.5">
      <button
        aria-label={liked ? 'いいねを取り消す' : 'いいね'}
        aria-pressed={liked}
        onClick={() => toggle.mutate({ emoji: '❤️', active: liked })}
        className="flex size-11 items-center justify-center rounded-full transition active:scale-90"
      >
        <Heart className={`size-6 ${liked ? 'fill-[#ff4d6d] text-[#ff4d6d]' : ''}`} />
      </button>
      <IconButton label="絵文字でリアクション" onClick={() => setPickerOpen(true)}>
        <SmilePlus className="size-6" />
      </IconButton>
      <button onClick={onOpenComments} className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium" aria-label="コメントを開く">
        コメント{commentCount > 0 && ` ${commentCount}`}
      </button>
      {grouped.length > 0 && (
        <button onClick={() => setWhoOpen(true)} className="ml-auto flex min-h-9 items-center gap-1 rounded-full bg-white/15 px-3 text-sm" aria-label="リアクションした人を見る">
          {grouped.slice(0, 4).map(([e]) => (
            <span key={e}>{e}</span>
          ))}
          <span className="ml-1 tabular-nums">{reactions.length}</span>
        </button>
      )}

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="リアクション">
        <div className="grid grid-cols-4 gap-2 px-5 pb-6">
          {REACTION_EMOJIS.map((e) => {
            const active = reactions.some((r) => r.user_id === userId && r.emoji === e);
            return (
              <button
                key={e}
                aria-pressed={active}
                onClick={() => {
                  toggle.mutate({ emoji: e, active });
                  setPickerOpen(false);
                }}
                className={`flex aspect-square items-center justify-center rounded-2xl text-3xl transition active:scale-90 ${active ? 'bg-accent-soft ring-2 ring-accent' : 'bg-surface-2'}`}
              >
                {e}
              </button>
            );
          })}
        </div>
      </Sheet>

      <Sheet open={whoOpen} onClose={() => setWhoOpen(false)} title="リアクションしたメンバー">
        <ul className="pb-4">
          {reactions.map((r) => (
            <li key={`${r.user_id}${r.emoji}`} className="flex items-center gap-3 px-5 py-2">
              <Avatar path={r.user?.avatar_path} name={r.user?.display_name} size={36} />
              <span className="flex-1 truncate">{r.user?.display_name ?? (r.user_id === userId ? 'あなた' : '')}</span>
              <span className="text-2xl">{r.emoji}</span>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- コメント
export function CommentsSheet({
  open,
  onClose,
  photoId,
  isAlbumOwner,
}: {
  open: boolean;
  onClose: () => void;
  photoId: string;
  isAlbumOwner: boolean;
}) {
  const { userId } = useAuth();
  const { data: comments, isLoading } = useComments(photoId);
  const [body, setBody] = useState('');

  const add = useMutation({
    mutationFn: async (text: string) => {
      const { error } = await supabase.from('comments').insert({ photo_id: photoId, body: text, author_id: userId });
      if (error) throw error;
    },
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: ['comments', photoId] });
    },
    onError: (e) => toast(toMessage(e), 'error'),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('comments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', photoId] }),
    onError: (e) => toast(toMessage(e), 'error'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (text) add.mutate(text);
  }

  return (
    <Sheet open={open} onClose={onClose} title="コメント">
      <div className="flex min-h-[40dvh] flex-col">
        <div className="flex-1 px-5">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : comments && comments.length > 0 ? (
            <ul className="space-y-4 py-2">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <Avatar path={c.author?.avatar_path} name={c.author?.display_name} size={34} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-ink-3">
                      <span className="font-semibold text-ink">{c.author?.display_name ?? '退会したメンバー'}</span>
                      {' ・ '}
                      {formatRelative(c.created_at)}
                    </p>
                    {/* React が自動でエスケープするため、HTML として解釈されない (XSS 対策) */}
                    <p className="mt-0.5 text-[15px] break-words whitespace-pre-wrap">{c.body}</p>
                  </div>
                  {(c.author_id === userId || isAlbumOwner) && (
                    <IconButton
                      label="コメントを削除"
                      className="size-9 text-ink-3"
                      onClick={() => window.confirm('このコメントを削除しますか？') && remove.mutate(c.id)}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-10 text-center text-sm text-ink-3">最初のコメントを書いてみましょう</p>
          )}
        </div>
        <form onSubmit={onSubmit} className="sticky bottom-0 flex items-end gap-2 border-t border-line bg-surface px-4 py-3">
          <textarea
            aria-label="コメントを入力"
            rows={1}
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="コメントを追加…"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl bg-surface-2 px-4 py-2.5 text-base outline-none"
          />
          <IconButton label="送信" type="submit" disabled={!body.trim() || add.isPending} className="bg-accent text-accent-ink hover:bg-accent disabled:opacity-40">
            <Send className="size-5" />
          </IconButton>
        </form>
      </div>
    </Sheet>
  );
}
