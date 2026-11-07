import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CheckSquare, Download, ImageIcon, ImagePlus, Images, MoreHorizontal, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { deletePhotos, fetchAllAlbumPhotos, useAlbumPhotos, useDownloadedIds } from '@/features/photos/api';
import { PhotoGrid } from '@/features/photos/PhotoGrid';
import { BulkSaveSheet } from '@/features/photos/BulkSaveSheet';
import { hasFeature } from '@/lib/features';
import { toMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import type { PhotoWithUploader } from '@/types/db';
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
import { CoverPickerSheet } from './CoverPickerSheet';
import { deleteAlbum, useAlbum, useAlbums, useCanChangeCover, useCanInvite, useMembers, useMyUsage, useSaveAlbum } from './api';

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
  const [coverOpen, setCoverOpen] = useState(false);
  const [membersCanInvite, setMembersCanInvite] = useState<boolean | null>(null);
  const [membersCanChangeCover, setMembersCanChangeCover] = useState<boolean | null>(null);

  if (isEdit && isLoading) return <FullPageSpinner />;
  if (isEdit && (!album || album.owner_id !== userId)) return <Navigate to={`/albums/${albumId}`} replace />;

  const t = title ?? album?.title ?? '';
  const d = description ?? album?.description ?? '';
  const invitePerm = membersCanInvite ?? album?.members_can_invite ?? true;
  const coverPerm = membersCanChangeCover ?? album?.members_can_change_cover ?? true;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const id = await save.mutateAsync({
        id: albumId,
        title: t.trim(),
        description: d.trim(),
        ownerId: userId!,
        ...(isEdit ? { membersCanInvite: invitePerm, membersCanChangeCover: coverPerm } : {}),
      });
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
          {isEdit && album && (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink-2">カバー画像</span>
              <div className="flex items-center gap-4">
                <AlbumCover path={album.cover?.thumb_path} className="size-20 shrink-0 rounded-xl" />
                <Button type="button" variant="secondary" size="sm" onClick={() => setCoverOpen(true)}>
                  <ImageIcon className="size-4" />
                  変更する
                </Button>
              </div>
            </div>
          )}
          {isEdit && (
            <fieldset className="rounded-2xl border border-line p-4">
              <legend className="px-1 text-sm font-medium text-ink-2">メンバーの権限</legend>
              <PermissionSwitch
                label="メンバー全員が招待できる"
                description="オフにすると、メンバー画面で「招待」をオンにした人だけが招待できます。"
                checked={invitePerm}
                onChange={setMembersCanInvite}
              />
              <PermissionSwitch
                label="メンバー全員がカバー画像を変更できる"
                description="オフにすると、カバー画像を変更できるのはオーナーだけになります。"
                checked={coverPerm}
                onChange={setMembersCanChangeCover}
              />
            </fieldset>
          )}
          <ErrorBox message={save.error ? toMessage(save.error) : null} />
          <Button type="submit" block loading={save.isPending} disabled={!t.trim()}>
            {isEdit ? '保存する' : '作成して写真を追加'}
          </Button>
        </form>
      </main>
      {isEdit && album && (
        <CoverPickerSheet open={coverOpen} onClose={() => setCoverOpen(false)} albumId={album.id} currentCoverId={album.cover_photo_id} />
      )}
    </>
  );
}

function PermissionSwitch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-ink-3">{description}</span>
      </span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full bg-line transition peer-checked:bg-accent after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4" />
    </label>
  );
}

const EMPTY_SET: Set<string> = new Set();

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
  const [coverOpen, setCoverOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 複数選択モード
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // 一括保存のシート (選択した写真 / 他のメンバーの写真)
  const [saveTarget, setSaveTarget] = useState<{ title: string; photos: PhotoWithUploader[]; autoStart: boolean } | null>(null);
  const [loadingOthers, setLoadingOthers] = useState(false);
  const { data: savedIds = EMPTY_SET } = useDownloadedIds(albumId);
  const { data: usage } = useMyUsage();
  const canBulkSave = hasFeature(usage?.plan, 'bulk_download');
  const navigate = useNavigate();
  const isOwner = album?.owner_id === userId;
  const canInvite = useCanInvite(albumId, userId);
  const canChangeCover = useCanChangeCover(albumId, userId);

  const list = useMemo(() => photos.data?.pages.flat() ?? [], [photos.data]);
  // オーナーは全員の写真、メンバーは自分の写真だけ削除できる (DB 側でも同じ制限)
  const canDelete = useCallback((p: PhotoWithUploader) => isOwner || p.uploader_id === userId, [isOwner, userId]);
  const deletable = useMemo(() => list.filter(canDelete), [list, canDelete]);
  const selectedPhotos = useMemo(() => list.filter((p) => selected.has(p.id)), [list, selected]);
  const selectedDeletable = useMemo(() => selectedPhotos.filter(canDelete), [selectedPhotos, canDelete]);
  // 保存はどの写真でもできるため、選択は全員の写真が対象
  const canSelect = useCallback(() => true, []);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);
  const toggle = useCallback((p: PhotoWithUploader) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
  }, []);
  const startSelection = useCallback(
    (p?: PhotoWithUploader) => {
      setSelecting(true);
      setSelected(p ? new Set([p.id]) : new Set());
    },
    [],
  );

  // 絞り込みを変えたら選択を解除 / 戻るボタン (Esc) で選択モードを終了
  useEffect(() => exitSelection(), [by, exitSelection]);
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && exitSelection();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting, exitSelection]);

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

  function onBulkSave() {
    if (selectedPhotos.length === 0) return;
    setSaveTarget({ title: `選択した ${selectedPhotos.length} 件を保存`, photos: selectedPhotos, autoStart: true });
  }

  async function onSaveAll(othersOnly: boolean) {
    if (!album || !userId) return;
    setMenuOpen(false);
    setLoadingOthers(true);
    try {
      const target = await fetchAllAlbumPhotos(album.id, othersOnly ? userId : undefined);
      setSaveTarget({ title: othersOnly ? '他のメンバーの写真を保存' : 'アルバムの写真をすべて保存', photos: target, autoStart: false });
    } catch (e) {
      toast(toMessage(e), 'error');
    } finally {
      setLoadingOthers(false);
    }
  }

  async function onBulkDelete() {
    const targets = selectedDeletable;
    if (targets.length === 0) return;
    const skipped = selectedPhotos.length - targets.length;
    if (
      !window.confirm(
        `${targets.length} 件を削除しますか？\n元に戻せません。${skipped > 0 ? `\n(他の人が投稿した ${skipped} 件は削除されません)` : ''}`,
      )
    )
      return;
    setBulkDeleting(true);
    try {
      const count = await deletePhotos(targets);
      toast(count === targets.length ? `${count} 件を削除しました` : `${count} 件を削除しました (${targets.length - count} 件は削除できませんでした)`);
      exitSelection();
    } catch (e) {
      toast(toMessage(e), 'error');
    } finally {
      setBulkDeleting(false);
    }
  }

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
      {selecting ? (
        <PageHeader
          title={selected.size > 0 ? `${selected.size} 件を選択中` : '写真を選択'}
          actions={
            <>
              <button
                className="min-h-11 rounded-full px-3 text-sm font-semibold text-accent"
                onClick={() => setSelected(selected.size === list.length && list.length > 0 ? new Set() : new Set(list.map((p) => p.id)))}
              >
                {selected.size === list.length && list.length > 0 ? '選択を解除' : 'すべて選択'}
              </button>
              <IconButton label="選択をやめる" onClick={exitSelection}>
                <X className="size-5" />
              </IconButton>
            </>
          }
        />
      ) : (
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
      )}

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

      <main className={`mx-auto max-w-5xl ${selecting ? 'pb-24' : ''}`}>
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
            selection={selecting ? { selected, canSelect, onToggle: toggle, savedIds } : null}
            onLongPress={startSelection}
          />
        )}
      </main>

      {selecting && (
        <div className="bottom-nav-offset px-safe fixed inset-x-0 z-30 flex justify-center">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-3 shadow-lg">
            <div className="flex gap-2">
                {canBulkSave && (
                  <Button className="flex-1" size="sm" disabled={selected.size === 0} onClick={onBulkSave}>
                    <Download className="size-4" />
                    {selected.size > 0 ? `${selected.size} 件を保存` : '保存'}
                  </Button>
                )}
                {deletable.length > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className={`!text-danger ${canBulkSave ? "" : "flex-1"}`}
                    disabled={selectedDeletable.length === 0}
                    loading={bulkDeleting}
                    onClick={onBulkDelete}
                  >
                    <Trash2 className="size-4" />
                    {selectedDeletable.length > 0 ? `${selectedDeletable.length} 件を削除` : '削除'}
                  </Button>
                )}
            </div>
          </div>
        </div>
      )}

      {canChangeCover && (
        <CoverPickerSheet open={coverOpen} onClose={() => setCoverOpen(false)} albumId={album.id} currentCoverId={album.cover_photo_id} />
      )}

      <BulkSaveSheet
        open={!!saveTarget}
        onClose={() => setSaveTarget(null)}
        title={saveTarget?.title ?? ''}
        albumTitle={album.title}
        photos={saveTarget?.photos ?? []}
        savedIds={savedIds}
        autoStart={saveTarget?.autoStart}
        onFinished={exitSelection}
      />

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={album.title}>
        <div className="pb-3">
          <SheetItem icon={<ImagePlus className="size-5" />} to={`/albums/${album.id}/upload`}>
            写真・動画を追加
          </SheetItem>
          <SheetItem icon={<Users className="size-5" />} to={`/albums/${album.id}/members`}>
            メンバー
          </SheetItem>
          {list.length > 0 && (
            <SheetItem
              icon={<CheckSquare className="size-5" />}
              onClick={() => {
                setMenuOpen(false);
                startSelection();
              }}
            >
              写真を選択 (保存・削除)
            </SheetItem>
          )}
          {canBulkSave && album.photo_count > 0 && (
            <>
              <SheetItem icon={<Download className="size-5" />} onClick={() => void onSaveAll(true)}>
                {loadingOthers ? '読み込み中…' : '他のメンバーの写真を保存'}
              </SheetItem>
              <SheetItem icon={<Download className="size-5" />} onClick={() => void onSaveAll(false)}>
                {loadingOthers ? '読み込み中…' : 'アルバムの写真をすべて保存 (自分の写真も含む)'}
              </SheetItem>
            </>
          )}
          {canInvite && !isOwner && (
            <SheetItem icon={<UserPlus className="size-5" />} to={`/albums/${album.id}/invite`}>
              メンバーを招待
            </SheetItem>
          )}
          {canChangeCover && album.photo_count > 0 && (
            <SheetItem
              icon={<ImageIcon className="size-5" />}
              onClick={() => {
                setMenuOpen(false);
                setCoverOpen(true);
              }}
            >
              カバー画像を変更
            </SheetItem>
          )}
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
