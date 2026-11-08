import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Ban, Check, Copy, Crown, LogOut, MessageCircle, Share2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { appUrl, supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import { toMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { canShareText } from '@/lib/platform';
import type { Invitation, InvitationPreview } from '@/types/db';
import { useAuth } from '@/features/auth/AuthProvider';
import { setMemberCanInvite, useAlbum, useCanInvite, useInvitations, useJoinRequests, useMembers } from '@/features/albums/api';
import { Avatar, Button, EmptyState, ErrorBox, FullPageSpinner, HeaderLink, IconButton, PageHeader, TextField } from '@/components/ui';
import { toast } from '@/components/toast';

const inviteUrl = (inv: Invitation) => `${appUrl()}/join/${inv.token}`;

// ---------------------------------------------------------------- メンバー一覧・管理
export function MembersPage() {
  const { albumId } = useParams();
  const { userId } = useAuth();
  const { data: album } = useAlbum(albumId);
  const { data: members, isLoading } = useMembers(albumId);
  const isOwner = album?.owner_id === userId;
  const canInvite = useCanInvite(albumId, userId);
  const { data: requests } = useJoinRequests(albumId, isOwner);
  const navigate = useNavigate();

  const togglePermission = useMutation({
    mutationFn: ({ uid, value }: { uid: string; value: boolean }) => setMemberCanInvite(albumId!, uid, value),
    onSuccess: (_d, v) => toast(v.value ? '招待の権限を付与しました' : '招待の権限を取り消しました (その人が作った招待も無効になりました)'),
    onError: (e) => toast(toMessage(e), 'error'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['members', albumId] });
    void queryClient.invalidateQueries({ queryKey: ['join-requests', albumId] });
    void queryClient.invalidateQueries({ queryKey: ['album', albumId] });
    void queryClient.invalidateQueries({ queryKey: ['albums'] });
  };

  const removeMember = useMutation({
    mutationFn: async (uid: string) => {
      const { error, count } = await supabase
        .from('album_members')
        .delete({ count: 'exact' })
        .match({ album_id: albumId, user_id: uid });
      if (error) throw error;
      if (count === 0) throw new Error('forbidden');
    },
    onSuccess: (_d, uid) => {
      if (uid === userId) {
        toast('アルバムを退会しました');
        queryClient.removeQueries({ queryKey: ['album', albumId] });
        void queryClient.invalidateQueries({ queryKey: ['albums'] });
        navigate('/albums', { replace: true });
      } else {
        toast('メンバーを除外しました');
        refresh();
      }
    },
    onError: (e) => toast(toMessage(e), 'error'),
  });

  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc('decide_join_request', { p_request_id: id, p_approve: approve });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast(v.approve ? '参加を承認しました' : '参加を拒否しました');
      refresh();
    },
    onError: (e) => toast(toMessage(e), 'error'),
  });

  if (isLoading) return <FullPageSpinner />;

  return (
    <>
      <PageHeader
        title="メンバー"
        back={`/albums/${albumId}`}
        actions={
          canInvite && (
            <HeaderLink to={`/albums/${albumId}/invite`} label="招待" icon={<UserPlus className="size-6" />} />
          )
        }
      />
      <main className="mx-auto max-w-2xl py-4">
        {isOwner && requests && requests.length > 0 && (
          <section className="mb-6">
            <h2 className="px-safe mb-2 text-sm font-semibold text-ink-2">参加リクエスト ({requests.length})</h2>
            <ul className="divide-y divide-line bg-surface">
              {requests.map((r) => (
                <li key={r.id} className="px-safe flex items-center gap-3 py-3">
                  <Avatar path={r.profile?.avatar_path} name={r.profile?.display_name} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.profile?.display_name}</p>
                    <p className="text-xs text-ink-3">{formatDateTime(r.created_at)}</p>
                  </div>
                  <IconButton label="拒否" className="bg-surface-2" onClick={() => decide.mutate({ id: r.id, approve: false })}>
                    <X className="size-5" />
                  </IconButton>
                  <IconButton label="承認" className="bg-accent text-accent-ink hover:bg-accent" onClick={() => decide.mutate({ id: r.id, approve: true })}>
                    <Check className="size-5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        )}

        <h2 className="px-safe mb-2 text-sm font-semibold text-ink-2">メンバー ({members?.length ?? 0})</h2>
        <ul className="divide-y divide-line bg-surface">
          {members?.map((m) => (
            <li key={m.user_id} className="px-safe flex items-center gap-3 py-3">
              <Avatar path={m.profile?.avatar_path} name={m.profile?.display_name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate font-medium">
                  {m.profile?.display_name}
                  {m.user_id === userId && <span className="text-xs text-ink-3">(あなた)</span>}
                </p>
                <p className="flex items-center gap-1 text-xs text-ink-3">
                  {m.role === 'owner' ? (
                    <>
                      <Crown className="size-3" /> オーナー
                    </>
                  ) : m.can_invite && !album?.members_can_invite ? (
                    <>
                      <UserPlus className="size-3" /> メンバー ・ 招待できる
                    </>
                  ) : (
                    'メンバー'
                  )}
                </p>
              </div>
              {isOwner && m.role !== 'owner' && !album?.members_can_invite && (
                <label className="flex shrink-0 cursor-pointer flex-col items-center gap-0.5 text-xs text-ink-3">
                  <input
                    type="checkbox"
                    role="switch"
                    className="peer sr-only"
                    checked={m.can_invite}
                    disabled={togglePermission.isPending}
                    aria-label={`${m.profile?.display_name} さんに招待の権限を付与`}
                    onChange={(e) => {
                      const value = e.target.checked;
                      if (!value && !window.confirm(`${m.profile?.display_name} さんの招待の権限を取り消しますか？\nこの人が作った招待も使えなくなります。`)) return;
                      togglePermission.mutate({ uid: m.user_id, value });
                    }}
                  />
                  <span className="relative h-6 w-10 rounded-full bg-line transition peer-checked:bg-accent after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4" />
                  招待
                </label>
              )}
              {isOwner && m.role !== 'owner' && (
                <IconButton
                  label={`${m.profile?.display_name} を除外`}
                  className="text-ink-3"
                  onClick={() =>
                    window.confirm(`${m.profile?.display_name} さんをアルバムから除外しますか？\n(投稿済みの写真は残ります)`) &&
                    removeMember.mutate(m.user_id)
                  }
                >
                  <UserMinus className="size-5" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>

        {isOwner && members && members.length > 1 && (
          <p className="px-safe mt-3 text-xs text-ink-3">
            {album?.members_can_invite
              ? 'メンバー全員が招待できます。特定の人だけに限定したい場合は、「アルバムを編集」で「メンバー全員が招待できる」をオフにしてください。'
              : '「招待」をオンにしたメンバーは、家族や友だちを招待できます。'}
            メンバーの除外や参加リクエストの承認はオーナーだけができます。
          </p>
        )}

        <div className="px-safe mt-8 space-y-3">
          {canInvite && (
            <Link to={`/albums/${albumId}/invite`}>
              <Button block>
                <UserPlus className="size-5" />
                家族や友だちを招待
              </Button>
            </Link>
          )}
          {!isOwner && (
            <Button
              block
              variant="secondary"
              className="text-danger"
              onClick={() => window.confirm('このアルバムを退会しますか？\n(投稿した写真はアルバムに残ります)') && removeMember.mutate(userId!)}
            >
              <LogOut className="size-5" />
              アルバムを退会
            </Button>
          )}
        </div>
      </main>
    </>
  );
}

// ---------------------------------------------------------------- 招待の発行
export function InvitePage() {
  const { albumId } = useParams();
  const { userId } = useAuth();
  const { data: album, isLoading } = useAlbum(albumId);
  const isOwner = album?.owner_id === userId;
  const { data: members, isLoading: membersLoading } = useMembers(albumId);
  const canInvite = useCanInvite(albumId, userId);
  const { data: invitations } = useInvitations(albumId, canInvite);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [expiresIn, setExpiresIn] = useState(168);

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('create_invitation', {
        p_album_id: albumId,
        p_requires_approval: requiresApproval,
        p_expires_in_hours: expiresIn,
      });
      if (error) throw error;
      return data as Invitation;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations', albumId] }),
    onError: (e) => toast(toMessage(e), 'error'),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('revoke_invitation', { p_invitation_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast('招待を無効にしました');
      void queryClient.invalidateQueries({ queryKey: ['invitations', albumId] });
    },
    onError: (e) => toast(toMessage(e), 'error'),
  });

  if (isLoading || membersLoading) return <FullPageSpinner />;
  if (!album || !canInvite)
    return (
      <>
        <PageHeader back={`/albums/${albumId}`} title="招待" />
        <EmptyState icon={<Ban className="size-7" />} title="招待する権限がありません">
          オーナーに「招待」の権限をもらうと、家族や友だちを招待できるようになります。
        </EmptyState>
      </>
    );
  const creatorName = (id: string) => (id === userId ? 'あなた' : (members?.find((m) => m.user_id === id)?.profile?.display_name ?? 'メンバー'));

  const active = invitations?.filter((i) => !i.revoked_at && new Date(i.expires_at) > new Date() && (i.max_uses == null || i.use_count < i.max_uses)) ?? [];

  return (
    <>
      <PageHeader title="家族や友だちを招待" back={`/albums/${albumId}/members`} />
      <main className="px-safe mx-auto max-w-lg py-6">
        <section className="rounded-2xl bg-surface p-5 shadow-sm">
          <h2 className="text-lg font-semibold">招待用のリンクを作る</h2>
          <p className="mt-1 text-sm text-ink-2">リンクを受け取った人は、ログインしてから参加できます。リンクを知っているだけでは写真は見られません。</p>
          <label className="mt-4 block text-sm">
            <span className="mb-1.5 block font-medium text-ink-2">有効期限</span>
            <select
              value={expiresIn}
              onChange={(e) => setExpiresIn(Number(e.target.value))}
              className="min-h-12 w-full rounded-xl border border-line bg-surface px-4 text-base"
            >
              <option value={24}>24 時間</option>
              <option value={72}>3 日間</option>
              <option value={168}>7 日間</option>
              <option value={720}>30 日間</option>
            </select>
          </label>
          <label className="mt-4 flex items-center justify-between gap-4">
            <span className="text-sm">
              <span className="font-medium">参加に承認を必要にする</span>
              <span className="block text-xs text-ink-3">オンにすると、オーナーが承認するまで参加できません</span>
            </span>
            <input type="checkbox" className="size-6 accent-[var(--accent)]" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
          </label>
          <Button className="mt-5" block loading={create.isPending} onClick={() => create.mutate()}>
            招待用のリンクを作る
          </Button>
        </section>

        {active.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold text-ink-2">{isOwner ? '有効な招待' : 'あなたが作った有効な招待'}</h2>
            <ul className="space-y-4">
              {active.map((inv) => (
                <InvitationCard key={inv.id} inv={inv} albumTitle={album.title} creator={creatorName(inv.created_by)} onRevoke={() => window.confirm('この招待を使えなくしますか？') && revoke.mutate(inv.id)} />
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

function InvitationCard({ inv, albumTitle, creator, onRevoke }: { inv: Invitation; albumTitle: string; creator: string; onRevoke: () => void }) {
  const url = inviteUrl(inv);
  const message = `PhotoLink のアルバム「${albumTitle}」に招待します。\n${url}\n招待コード: ${inv.code}`;

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label}をコピーしました`);
    } catch {
      window.prompt('コピーしてください', text);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: 'PhotoLink への招待', text: message });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') void copy(message, '招待メッセージ');
    }
  }

  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-ink-3">招待コード</p>
          <p className="font-mono text-2xl font-bold tracking-[0.2em]">{inv.code}</p>
        </div>
        <IconButton label="コードをコピー" onClick={() => copy(inv.code, '招待コード')}>
          <Copy className="size-5" />
        </IconButton>
      </div>
      <p className="mt-2 truncate rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-ink-2">{url}</p>
      <p className="mt-2 text-xs text-ink-3">
        {formatDateTime(inv.expires_at)} まで ・ {inv.use_count} 人が使用{inv.requires_approval && ' ・ 承認制'} ・ 作成: {creator}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {canShareText() ? (
          <Button size="sm" onClick={share}>
            <Share2 className="size-4" />
            共有
          </Button>
        ) : (
          <Button size="sm" onClick={() => copy(url, '招待リンク')}>
            <Copy className="size-4" />
            リンクをコピー
          </Button>
        )}
        <a href={`https://line.me/R/share?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
          <Button size="sm" variant="secondary" block className="!bg-[#06c755] !text-white">
            <MessageCircle className="size-4" />
            LINE で送る
          </Button>
        </a>
      </div>
      <button className="mt-3 w-full text-center text-xs text-danger" onClick={onRevoke}>
        この招待を無効にする
      </button>
    </li>
  );
}

// ---------------------------------------------------------------- 招待から参加
const STATE_MESSAGE: Record<InvitationPreview['state'], string> = {
  valid: '',
  already_member: 'すでにこのアルバムのメンバーです。',
  pending: '参加リクエストを送信済みです。オーナーの承認をお待ちください。',
  revoked: 'この招待は無効化されています。オーナーに新しい招待を依頼してください。',
  expired: 'この招待の有効期限が切れています。オーナーに新しい招待を依頼してください。',
  used_up: 'この招待は利用回数の上限に達しています。',
  not_found: '招待が見つかりません。URL またはコードをご確認ください。',
};

export function JoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const lookup = token ? { p_token: token } : submittedCode ? { p_code: submittedCode } : null;

  useEffect(() => {
    if (!lookup) return;
    setLoading(true);
    setError(null);
    supabase.rpc('get_invitation_preview', lookup).then(({ data, error }) => {
      setLoading(false);
      if (error) setError(toMessage(error));
      else setPreview(data as InvitationPreview);
    });
  }, [token, submittedCode]);

  const accept = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('accept_invitation', lookup!);
      if (error) throw error;
      return data as { status: string; album_id: string };
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['albums'] });
      if (res.status === 'joined' || res.status === 'already_member') {
        toast('アルバムに参加しました');
        navigate(`/albums/${res.album_id}`, { replace: true });
      } else if (res.status === 'pending') {
        setPreview((p) => (p ? { ...p, state: 'pending' } : p));
      } else {
        setPreview((p) => (p ? { ...p, state: 'not_found' } : p));
      }
    },
    onError: (e) => setError(toMessage(e)),
  });

  function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalized.length !== 8) return setError('招待コードは 8 文字です。');
    setPreview(null);
    setSubmittedCode(normalized);
  }

  return (
    <>
      <PageHeader title="アルバムに参加" back="/albums" />
      <main className="px-safe mx-auto max-w-md py-8">
        {!token && (
          <form onSubmit={onSubmitCode} className="mb-8 space-y-4">
            <TextField
              label="招待コード"
              placeholder="例: ABCD2345"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={12}
              className="text-center font-mono text-xl tracking-[0.3em] uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button type="submit" block variant="secondary" loading={loading && !!submittedCode}>
              確認する
            </Button>
          </form>
        )}

        {loading && !preview && <FullPageSpinner />}
        <ErrorBox message={error} />

        {preview && (
          <section className="animate-fade-in rounded-3xl bg-surface p-6 text-center shadow-sm">
            {preview.state === 'not_found' ? (
              <p className="text-sm text-ink-2">{STATE_MESSAGE.not_found}</p>
            ) : (
              <>
                <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <Users className="size-8" />
                </div>
                <p className="text-sm text-ink-2">{preview.owner_name} さんからの招待</p>
                <h2 className="mt-1 text-xl font-bold">{preview.album_title}</h2>
                <p className="mt-1 text-sm text-ink-3">
                  メンバー {preview.member_count} 人 ・ 写真 {preview.photo_count} 枚
                </p>
                {preview.state === 'valid' ? (
                  <>
                    {preview.requires_approval && <p className="mt-4 text-xs text-ink-3">このアルバムはオーナーの承認後に参加できます。</p>}
                    <Button className="mt-6" block loading={accept.isPending} onClick={() => accept.mutate()}>
                      {preview.requires_approval ? '参加をリクエスト' : 'アルバムに参加する'}
                    </Button>
                  </>
                ) : preview.state === 'already_member' ? (
                  <Link to={`/albums/${preview.album_id}`}>
                    <Button className="mt-6" block>
                      アルバムを開く
                    </Button>
                  </Link>
                ) : (
                  <p className="mt-5 rounded-xl bg-surface-2 p-3 text-sm text-ink-2">{STATE_MESSAGE[preview.state]}</p>
                )}
              </>
            )}
          </section>
        )}
      </main>
    </>
  );
}
