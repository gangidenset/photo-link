import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';
import { Bell, FolderPlus, Home, Images, Plus, Settings, UploadCloud, User, X } from 'lucide-react';
import { useUnreadCount, useNotificationRealtime } from '@/features/notifications/api';
import { summarize, useUploadStore } from '@/features/upload/uploadStore';
import { useAlbums } from '@/features/albums/api';
import { Sheet, SheetItem } from './ui';
import { AlbumCover } from '@/features/albums/AlbumCover';
import { useSimpleMode } from '@/lib/display';

// 文字は折り返さない (5 項目でも 1 行に収まる大きさ)。かんたんモードは 4 項目なので少し大きく
const navCls = ({ isActive }: { isActive: boolean }) =>
  `flex min-w-0 flex-1 flex-col items-center justify-center gap-1 whitespace-nowrap text-[0.8rem] font-semibold tracking-tight transition [[data-simple='1']_&]:text-sm ${
    isActive ? 'text-accent' : 'text-ink-2'
  }`;

/** 下部ナビゲーション付きの共通レイアウト (スマートフォン優先) */
export function AppLayout() {
  useNotificationRealtime();
  const { data: unread = 0 } = useUnreadCount();
  const simple = useSimpleMode();
  const [pickerOpen, setPickerOpen] = useState(false);
  const albumMatch = useMatch('/albums/:albumId/*');
  const albumId = albumMatch?.params.albumId && albumMatch.params.albumId !== 'new' ? albumMatch.params.albumId : null;
  const navigate = useNavigate();

  const bell = (
    <span className="relative">
      <Bell className="size-7" />
      {unread > 0 && (
        <span className="absolute -top-1.5 -right-2.5 min-w-6 rounded-full bg-accent px-1 text-center text-xs leading-6 font-bold text-accent-ink">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </span>
  );

  return (
    <div className="pb-nav min-h-dvh">
      <Outlet />
      <UploadIndicator />

      <nav
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md"
        aria-label="メインメニュー"
      >
        <div className="px-safe mx-auto flex h-[var(--nav-h)] max-w-lg items-stretch">
          <NavLink to="/" end className={navCls}>
            <Home className="size-7" />
            ホーム
          </NavLink>
          {!simple && (
            <NavLink to="/albums" className={navCls}>
              <Images className="size-7" />
              アルバム
            </NavLink>
          )}
          {/* 写真を送る: 文字付きで、いちばん目立つボタン */}
          <button
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 whitespace-nowrap text-[0.8rem] font-bold tracking-tight text-accent [[data-simple='1']_&]:text-sm"
            onClick={() => (albumId ? navigate(`/albums/${albumId}/upload`) : setPickerOpen(true))}
          >
            <span className="flex h-8 w-12 items-center justify-center rounded-xl bg-accent text-accent-ink shadow-sm transition active:scale-95">
              <Plus className="size-6" strokeWidth={2.75} />
            </span>
            写真を送る
          </button>
          <NavLink to="/notifications" className={navCls}>
            {bell}
            お知らせ
          </NavLink>
          {simple ? (
            <NavLink to="/settings" className={navCls}>
              <Settings className="size-7" />
              設定
            </NavLink>
          ) : (
            <NavLink to="/profile" className={navCls}>
              <User className="size-7" />
              マイページ
            </NavLink>
          )}
        </div>
      </nav>

      <AlbumPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}

/** 「写真を送る」: どのアルバムに送るかを選ぶ */
function AlbumPickerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: albums } = useAlbums();
  const simple = useSimpleMode();
  return (
    <Sheet open={open} onClose={onClose} title="どのアルバムに送りますか？">
      <div className="pb-3">
        {albums?.map((a) => (
          <Link key={a.id} to={`/albums/${a.id}/upload`} onClick={onClose} className="flex min-h-18 items-center gap-4 px-5 py-2.5 hover:bg-surface-2">
            <AlbumCover path={a.cover?.thumb_path} className="size-14 shrink-0 rounded-xl" />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold">{a.title}</p>
              <p className="text-sm text-ink-3">{a.photo_count} 枚</p>
            </div>
          </Link>
        ))}
        {!simple && (
          <SheetItem icon={<FolderPlus className="size-6" />} to="/albums/new" onClick={onClose}>
            新しいアルバムを作る
          </SheetItem>
        )}
      </div>
    </Sheet>
  );
}

/** 完了表示が自動で消えるまでの時間 */
const AUTO_DISMISS_MS = 4000;
const FADE_MS = 300;

/** アップロード中は画面下に小さな進捗を常に表示。すべて成功したら数秒後に自動で消える */
function UploadIndicator() {
  const items = useUploadStore((s) => s.items);
  const clearFinished = useUploadStore((s) => s.clearFinished);
  const location = useLocation();
  const [fading, setFading] = useState(false);
  const sum = summarize(items);
  const finished = items.length > 0 && sum.remaining === 0;
  // 失敗がある場合は再試行できるよう残す
  const autoDismiss = finished && sum.failed === 0;

  useEffect(() => {
    setFading(false);
    if (!autoDismiss) return;
    const fade = setTimeout(() => setFading(true), AUTO_DISMISS_MS - FADE_MS);
    const clear = setTimeout(() => clearFinished(), AUTO_DISMISS_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(clear);
    };
  }, [autoDismiss, items.length, clearFinished]);

  if (items.length === 0 || location.pathname === '/uploads') return null;
  return (
    <div
      className={`bottom-nav-offset px-safe pointer-events-none fixed inset-x-0 z-30 flex justify-center transition-opacity duration-300 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
      role="status"
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-lg">
        <UploadCloud className={`size-5 shrink-0 ${finished && !sum.failed ? 'text-success' : 'text-accent'}`} />
        <Link to="/uploads" className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">
            {finished
              ? `送信完了 ${sum.done} 件${sum.failed ? ` / 失敗 ${sum.failed} 件` : ''}`
              : `送信中 ${sum.percent}% ・ 残り ${sum.remaining} 件`}
          </p>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${sum.percent}%` }} />
          </div>
        </Link>
        {autoDismiss && (
          <button aria-label="閉じる" className="-mr-1 p-1 text-ink-3" onClick={clearFinished}>
            <X className="size-5" />
          </button>
        )}
      </div>
    </div>
  );
}
