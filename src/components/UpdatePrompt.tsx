// 新しいバージョンが公開されたときに更新を促す (Service Worker)
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useUploadStore, isActive } from '@/features/upload/uploadStore';
import { Button } from './ui';

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // 1 時間ごとに更新を確認
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });
  const uploading = useUploadStore((s) => s.items.some((i) => isActive(i.status) || i.status === 'queued'));

  if (!needRefresh || uploading) return null;
  return (
    <div className="bottom-nav-offset px-safe fixed inset-x-0 z-[55] flex justify-center">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl bg-ink p-3 pl-4 text-sm text-bg shadow-lg">
        <span className="flex-1">新しいバージョンがあります</span>
        <button className="px-2 text-bg/70" onClick={() => setNeedRefresh(false)}>
          後で
        </button>
        <Button size="sm" onClick={() => void updateServiceWorker(true)}>
          更新
        </Button>
      </div>
    </div>
  );
}
