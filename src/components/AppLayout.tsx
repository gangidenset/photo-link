import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { Bell, FolderPlus, Home, Images, Plus, UploadCloud, User, X } from 'lucide-react';
import { useUnreadCount, useNotificationRealtime } from '@/features/notifications/api';
import { summarize, useUploadStore } from '@/features/upload/uploadStore';
import { useAlbums } from '@/features/albums/api';
import { Sheet, SheetItem } from './ui';
import { AlbumCover } from '@/features/albums/AlbumCover';

const navCls = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition ${isActive ? 'text-accent' : 'text-ink-3'}`;

/** 下部ナビゲーション付きの共通レイアウト (スマートフォン優先) */
export function AppLayout() {
  useNotificationRealtime();
  const { data: unread = 0 } = useUnreadCount();
  const [pickerOpen, setPickerOpen] = useState(false);
  const albumMatch = useMatch('/albums/:albumId/*');
  const albumId = albumMatch?.params.albumId && albumMatch.params.albumId !== 'new' ? albumMatch.params.albumId : null;
  const navigate = useNavigate();

  return (
    <div className="pb-nav min-h-dvh">
      <Outlet />
      <UploadIndicator />

      <nav
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface/90 backdrop-blur-md"
        aria-label="メインメニュー"
      >
        <div className="px-safe mx-auto flex h-[var(--nav-h)] max-w-lg items-stretch">
          <NavLink to="/" end className={navCls}>
            <Home className="size-6" />
            ホーム
          </NavLink>
          <NavLink to="/albums" className={navCls}>
            <Images className="size-6" />
            アルバム
          </NavLink>
          <div className="flex flex-1 items-center justify-center">
            <button
              aria-label="写真を投稿"
              className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-md transition active:scale-95"
              onClick={() => (albumId ? navigate(`/albums/${albumId}/upload`) : setPickerOpen(true))}
            >
              <Plus className="size-7" strokeWidth={2.5} />
            </button>
          </div>
          <NavLink to="/notifications" className={navCls}>
            <span className="relative">
              <Bell className="size-6" />
              {unread > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[18px] rounded-full bg-accent px-1 text-center text-[10px] leading-[18px] font-bold text-accent-ink">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
            通知
          </NavLink>
          <NavLink to="/profile" className={navCls}>
            <User className="size-6" />
            マイページ
          </NavLink>
        </div>
      </nav>

      <AlbumPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}

/** 「＋」ボタン: どのアルバムに投稿するかを選ぶ */
function AlbumPickerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: albums } = useAlbums();
  return (
    <Sheet open={open} onClose={onClose} title="どのアルバムに投稿しますか？">
      <div className="pb-3">
        {albums?.map((a) => (
          <Link key={a.id} to={`/albums/${a.id}/upload`} onClick={onClose} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-2">
            <AlbumCover path={a.cover?.thumb_path} className="size-12 shrink-0 rounded-lg" />
            <div className="min-w-0">
              <p className="truncate font-medium">{a.title}</p>
              <p className="text-xs text-ink-3">{a.photo_count} 枚</p>
            </div>
          </Link>
        ))}
        <SheetItem icon={<FolderPlus className="size-5" />} to="/albums/new" onClick={onClose}>
          新しいアルバムを作成
        </SheetItem>
      </div>
    </Sheet>
  );
}

/** アップロード中は画面下に小さな進捗を常に表示 */
function UploadIndicator() {
  const items = useUploadStore((s) => s.items);
  const clearFinished = useUploadStore((s) => s.clearFinished);
  const location = useLocation();
  if (items.length === 0 || location.pathname === '/uploads') return null;
  const sum = summarize(items);
  const finished = sum.remaining === 0;
  return (
    <div className="bottom-nav-offset px-safe pointer-events-none fixed inset-x-0 z-30 flex justify-center">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-lg">
        <UploadCloud className={`size-5 shrink-0 ${finished ? 'text-success' : 'text-accent'}`} />
        <Link to="/uploads" className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {finished
              ? `アップロード完了 ${sum.done} 件${sum.failed ? ` / 失敗 ${sum.failed} 件` : ''}`
              : `アップロード中 ${sum.percent}% ・ 残り ${sum.remaining} 件`}
          </p>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${sum.percent}%` }} />
          </div>
        </Link>
        {finished && sum.failed === 0 && (
          <button aria-label="閉じる" className="-mr-1 p-1 text-ink-3" onClick={clearFinished}>
            <X className="size-5" />
          </button>
        )}
      </div>
    </div>
  );
}
