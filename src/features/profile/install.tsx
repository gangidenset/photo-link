// ホーム画面への追加 (PWA インストール)
//   Android Chrome: beforeinstallprompt イベントでインストールボタンを表示
//   iPhone Safari: 自動のインストール画面がないため、「共有 → ホーム画面に追加」の手順を案内
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { isIOS, isStandalone } from '@/lib/platform';
import { Button, Sheet } from '@/components/ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const useInstall = create<{ deferred: BeforeInstallPromptEvent | null }>(() => ({ deferred: null }));

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    useInstall.setState({ deferred: e as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => useInstall.setState({ deferred: null }));
}

export function useInstallState() {
  const deferred = useInstall((s) => s.deferred);
  const standalone = typeof window !== 'undefined' && isStandalone();
  const ios = typeof window !== 'undefined' && isIOS();
  return {
    installed: standalone,
    canPrompt: !!deferred,
    ios,
    async prompt() {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      useInstall.setState({ deferred: null });
    },
  };
}

export function IosInstallGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="ホーム画面に追加する (iPhone)">
      <ol className="space-y-4 px-5 pb-6 text-[15px]">
        <li className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 font-bold">1</span>
          <span>
            Safari の下部にある <Share className="inline size-5 align-text-bottom text-[#0a84ff]" /> (共有) をタップ
          </span>
        </li>
        <li className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 font-bold">2</span>
          <span>
            <SquarePlus className="inline size-5 align-text-bottom" /> 「ホーム画面に追加」を選択
          </span>
        </li>
        <li className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 font-bold">3</span>
          <span>右上の「追加」をタップ</span>
        </li>
        <li className="rounded-xl bg-surface-2 p-3 text-xs text-ink-2">
          ※ Chrome など Safari 以外のブラウザでは表示されない場合があります。Safari で開いてください。
          <br />※ ホーム画面のアプリはログイン状態が Safari とは別になるため、初回のみ再度ログインしてください。
        </li>
      </ol>
    </Sheet>
  );
}

/** ホーム画面上部に一度だけ表示する案内 */
export function InstallBanner() {
  const { installed, canPrompt, ios, prompt } = useInstallState();
  const [dismissed, setDismissed] = useState(true);
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem('photolink.install-dismissed') === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (installed || dismissed || (!canPrompt && !ios)) return null;

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem('photolink.install-dismissed', '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl bg-accent-soft p-4">
      <Download className="size-6 shrink-0 text-accent" />
      <p className="flex-1 text-sm">ホーム画面に追加すると、アプリのようにすぐ開けます。</p>
      <Button size="sm" onClick={() => (canPrompt ? void prompt() : setGuide(true))}>
        追加
      </Button>
      <button aria-label="閉じる" onClick={close} className="p-1 text-ink-3">
        <X className="size-4" />
      </button>
      <IosInstallGuide open={guide} onClose={() => setGuide(false)} />
    </div>
  );
}
