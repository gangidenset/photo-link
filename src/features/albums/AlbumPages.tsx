import { useCallback, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ImagePlus, Images, MoreHorizontal, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAlbumPhotos } from '@/features/photos/api';
import { PhotoGrid } from '@/features/photos/PhotoGrid';
import { toMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorBox,
  FullPageSpinner,
  IconButton,
  PageHeader,
  Sheet,
  SheetItem,
  TextArea,
  TextField,
} from '@/components/ui';
import { toast } from '@/components/toast';
import { AlbumCover } from './AlbumCover';
import { deleteAlbum, useAlbum, useAlbums, useMembers, useSaveAlbum } from './api';

// ---------------------------------------------------------------- アルバム一覧
export function AlbumsPage() {
  const { data: albums, isLoading, error } = useAlbums();
  return (
    <>
      <PageHeader
        title="アルバム"
        actions={
          <Link to="/albums/new" aria-label="アルバムを作成" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-2">
            <Plus className="size-6" />
          </Link>
        }
      />
      <main className="px-safe mx-auto max-w-5xl py-4">
        {isLoading ? (
          <FullPageSpinner />
        ) : error ? (
          <ErrorBox message={toMessage(error)} />
        ) : albums && albums.length > 0 ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
            {albums.map((a) => (
              <Link key={a.id} to={`/albums/${a.id}`} className="group block">
                <AlbumCover path={a.cover?.preview_path ?? a.cover?.thumb_path} className="aspect-square rounded-2xl transition group-active:scale-[0.98]" large />
                <h2 className="mt-2 truncate text-[15px] font-semibold">{a.title}</h2>
                <p className="text-xs text-ink-3">
                  {a.photo_count} 枚 ・ {a.member_count} 人
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState icon={<Images className="size-7" />} title="アルバムがありません">
            <p>アルバムを作って、家族や友人を招待しましょう。</p>
            <div className="mt-6 flex flex-col gap-3">
              <Link to="/albums/new">
                <Button>
                  <Plus className="size-5" />
                  アルバムを作成
                </Button>
              </Link>
              <Link to="/join" className="text-sm font-semibold text-accent">
                招待コードで参加する
              </Link>
            </div>
          </EmptyState>
        )}
      </main>
    </>
  );
}

// ---------------------------------------------------------------- 作成・編集
export function AlbumFormPage() {
  const { albumId } = useParams();
  const isEdit = !!albumId;
  const { userId } = useAuth();
  const { data: album, isLoading } = useAlbum(albumId);
  const save = useSaveAlbum();
  const navigate = useNavigate();
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);

  if (isEdit && isLoading) return <FullPageSpinner />;
  if (isEdit && (!album || album.owner_id !== userId)) return <Navigate to={`/albums/${albumId}`} replace />;

  const t = title ?? album?.title ?? '';
  const d = description ?? album?.description ?? '';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const id = await save.mutateAsync({ id: albumId, title: t.trim(), description: d.trim(), ownerId: userId! });
      toast(isEdit ? 'アルバムを更新しました' : 'アルバムを作成しました');
      navigate(isEdit ? `/albums/${id}` : `/albums/${id}/upload`, { replace: true });
    } catch {
      /* エラーは下に表示 */
    }
  }

  return (
    <>
      <PageHeader title={isEdit ? 'アルバムを編集' : '新しいアルバム'} back />
      <main className="px-safe mx-auto max-w-lg py-6">
        <form onSubmit={onSubmit} className="space-y-5">
          <TextField label="アルバム名" required maxLength={80} placeholder="例: 2026 夏の家族旅行" value={t} onChange={(e) => setTitle(e.target.value)} autoFocus={!isEdit} />
          <TextArea label="説明 (任意)" maxLength={1000} rows={4} placeholder="どんなアルバムか書いておくと、招待された人に伝わりやすくなります" value={d} onChange={(e) => setDescription(e.target.value)} />
          {isEdit && <p className="text-xs text-ink-3">カバー画像は、写真を開いて「カバーに設定」から変更できます。</p>}
          <ErrorBox message={save.error ? toMessage(save.error) : null} />
          <Button type="submit" block loading={save.isPending} disabled={!t.trim()}>
            {isEdit ? '保存する' : '作成して写真を追加'}
          </Button>
        </form>
      </main>
    </>
  );
}

// ---------------------------------------------------------------- アルバム詳細
export function AlbumDetailPage() {
  const { albumId } = useParams();
  const { userId } = useAuth();
  const [params, setParams] = useSearchParams();
  const by = params.get('by');
  const { data: album, isLoading, error } = useAlbum(albumId);
  const { data: members } = useMembers(albumId);
  const photos = useAlbumPhotos(albumId, by);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const isOwner = album?.owner_id === userId;

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = photos;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading) return <FullPageSpinner />;
  if (error) return <ErrorBox message={toMessage(error)} />;
  if (!album)
    return (
      <>
        <PageHeader back="/albums" />
        <EmptyState icon={<Images className="size-7" />} title="アルバムが見つかりません">
          削除されたか、参加していないアルバムです。
        </EmptyState>
      </>
    );

  const list = photos.data?.pages.flat() ?? [];

  async function onDelete() {
    if (!album) return;
    if (!window.confirm(`「${album.title}」を削除しますか？\n全メンバーの写真 ${album.photo_count} 枚も完全に削除され、元に戻せません。`)) return;
    setDeleting(true);
    try {
      await deleteAlbum(album.id);
      toast('アルバムを削除しました');
      navigate('/albums', { replace: true });
    } catch (e) {
      toast(toMessage(e), 'error');
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        back="/albums"
        title={album.title}
        actions={
          <>
            <Link to={`/albums/${album.id}/members`} aria-label="メンバー" className="inline-flex size-11 items-center justify-center rounded-full hover:bg-surface-2">
              <Users className="size-5" />
            </Link>
            <IconButton label="メニュー" onClick={() => setMenuOpen(true)}>
              <MoreHorizontal className="size-5" />
            </IconButton>
          </>
        }
      />

      <section className="px-safe mx-auto max-w-5xl pt-4 pb-3">
        {album.description && <p className="mb-3 text-sm whitespace-pre-wrap text-ink-2">{album.description}</p>}
        <div className="flex items-center justify-between gap-3">
          <Link to={`/albums/${album.id}/members`} className="flex min-w-0 items-center gap-2">
            <div className="flex -space-x-2">
              {members?.slice(0, 4).map((m) => (
                <span key={m.user_id} className="rounded-full ring-2 ring-bg">
                  <Avatar path={m.profile?.avatar_path} name={m.profile?.display_name} size={28} />
                </span>
              ))}
            </div>
            <span className="truncate text-xs text-ink-2">
              {album.member_count} 人 ・ {album.photo_count} 枚
              {album.last_photo_at && ` ・ ${formatRelative(album.last_photo_at)}に更新`}
            </span>
          </Link>
          <Link to={`/albums/${album.id}/upload`} className="shrink-0">
            <Button size="sm">
              <ImagePlus className="size-4" />
              追加
            </Button>
          </Link>
        </div>

        {members && members.length > 1 && (
          <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="投稿者で絞り込み">
            <FilterChip active={!by} onClick={() => setParams({}, { replace: true })}>
              すべて
            </FilterChip>
            {members.map((m) => (
              <FilterChip key={m.user_id} active={by === m.user_id} onClick={() => setParams({ by: m.user_id }, { replace: true })}>
                {m.user_id === userId ? '自分' : (m.profile?.display_name ?? '')}
              </FilterChip>
            ))}
          </div>
        )}
      </section>

      <main className="mx-auto max-w-5xl">
        {photos.isLoading ? (
          <FullPageSpinner />
        ) : list.length === 0 ? (
          <EmptyState icon={<ImagePlus className="size-7" />} title={by ? 'この人の投稿はまだありません' : 'まだ写真がありません'}>
            {!by && (
              <>
                <p>最初の写真を追加しましょう。</p>
                <Link to={`/albums/${album.id}/upload`} className="mt-5 inline-block">
                  <Button>
                    <ImagePlus className="size-5" />
                    写真・動画を追加
                  </Button>
                </Link>
              </>
            )}
          </EmptyState>
        ) : (
          <PhotoGrid
            photos={list}
            albumId={album.id}
            hasMore={!!hasNextPage}
            loadingMore={isFetchingNextPage}
            onLoadMore={loadMore}
            query={by ? `?by=${by}` : ''}
          />
        )}
      </main>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={album.title}>
        <div className="pb-3">
          <SheetItem icon={<ImagePlus className="size-5" />} to={`/albums/${album.id}/upload`}>
            写真・動画を追加
          </SheetItem>
          <SheetItem icon={<Users className="size-5" />} to={`/albums/${album.id}/members`}>
            メンバー
          </SheetItem>
          {isOwner && (
            <>
              <SheetItem icon={<UserPlus className="size-5" />} to={`/albums/${album.id}/invite`}>
                メンバーを招待
              </SheetItem>
              <SheetItem icon={<Pencil className="size-5" />} to={`/albums/${album.id}/edit`}>
                アルバムを編集
              </SheetItem>
              <SheetItem icon={<Trash2 className="size-5" />} danger onClick={onDelete}>
                {deleting ? '削除中…' : 'アルバムを削除'}
              </SheetItem>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-9 shrink-0 rounded-full px-4 text-sm font-medium transition ${
        active ? 'bg-ink text-bg' : 'bg-surface-2 text-ink-2'
      }`}
    >
      {children}
    </button>
  );
}
