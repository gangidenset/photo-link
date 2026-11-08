import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Camera, ChevronRight, Eye, FileText, HardDrive, ImageIcon, LogOut, Moon, Settings, Shield, Smartphone, Trash2, UploadCloud, User } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import { toMessage } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { useTheme, type ThemePref } from '@/lib/theme';
import { TEXT_SIZE_LABEL, effectiveTextSize, useDisplay, type TextSize } from '@/lib/display';
import { useAuth, useMyProfile } from '@/features/auth/AuthProvider';
import { useMyUsage } from '@/features/albums/api';
import { useUploadStore } from '@/features/upload/uploadStore';
import { STANDARD_MAX_EDGE, useUploadQuality, type UploadQuality } from '@/features/upload/quality';
import { Avatar, Button, ErrorBox, FullPageSpinner, HeaderLink, PageHeader, ProgressBar, TextField } from '@/components/ui';
import { toast } from '@/components/toast';
import { IosInstallGuide, useInstallState } from './install';

/** プロフィール画像を正方形 512px の JPEG にする */
async function toAvatarJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 512, 512);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) throw new Error('image_decode_failed');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ProfilePage() {
  const { userId, session } = useAuth();
  const { data: profile, isLoading } = useMyProfile();
  const { data: usage } = useMyUsage();
  const [name, setName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const saveName = useMutation({
    mutationFn: async (displayName: string) => {
      const { error } = await supabase.from('profiles').update({ display_name: displayName }).eq('id', userId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast('表示名を更新しました');
      setName(null);
      void queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    },
  });

  const saveAvatar = useMutation({
    mutationFn: async (file: File) => {
      const blob = await toAvatarJpeg(file);
      const path = `${userId}/avatar-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error) throw error;
      const old = profile?.avatar_path;
      const { error: e2 } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId!);
      if (e2) throw e2;
      if (old) await supabase.storage.from('avatars').remove([old]);
    },
    onSuccess: () => {
      toast('プロフィール画像を更新しました');
      void queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (e) => toast(toMessage(e), 'error'),
  });

  if (isLoading || !profile) return <FullPageSpinner />;
  const n = name ?? profile.display_name;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (n.trim()) saveName.mutate(n.trim());
  }

  return (
    <>
      <PageHeader
        title="マイページ"
        actions={
          <HeaderLink to="/settings" label="設定" icon={<Settings className="size-6" />} />
        }
      />
      <main className="px-safe mx-auto max-w-lg py-6">
        <div className="flex flex-col items-center">
          <button className="relative" onClick={() => fileInput.current?.click()} aria-label="プロフィール画像を変更" disabled={saveAvatar.isPending}>
            <Avatar path={profile.avatar_path} name={profile.display_name} size={96} />
            <span className="absolute right-0 bottom-0 flex size-8 items-center justify-center rounded-full border-2 border-bg bg-ink text-bg">
              <Camera className="size-4" />
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) saveAvatar.mutate(f);
              e.target.value = '';
            }}
          />
          <p className="mt-3 text-sm text-ink-3">{session?.user.email}</p>
        </div>

        <form onSubmit={onSubmit} className="mt-6 flex items-end gap-2">
          <div className="flex-1">
            <TextField label="表示名" maxLength={40} value={n} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" disabled={name === null || !n.trim()} loading={saveName.isPending}>
            保存
          </Button>
        </form>
        <ErrorBox message={saveName.error ? toMessage(saveName.error) : null} />

        {usage && (
          <section className="mt-8 rounded-2xl bg-surface p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <HardDrive className="size-5 text-ink-3" />
                ストレージ
              </h2>
              <span className="rounded-full bg-accent-soft px-3 py-0.5 text-xs font-semibold text-accent">{usage.plan.name}プラン</span>
            </div>
            <ProgressBar value={usage.storage_bytes / usage.plan.max_storage_bytes} className="mt-4 h-2" />
            <p className="mt-2 text-sm text-ink-2">
              {formatBytes(usage.storage_bytes)} / {formatBytes(usage.plan.max_storage_bytes)} 使用中
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-surface-2 p-3">
                <dt className="text-xs text-ink-3">投稿した写真・動画</dt>
                <dd className="text-lg font-semibold">{usage.photo_count}</dd>
              </div>
              <div className="rounded-xl bg-surface-2 p-3">
                <dt className="text-xs text-ink-3">作成したアルバム</dt>
                <dd className="text-lg font-semibold">
                  {usage.album_count} <span className="text-xs font-normal text-ink-3">/ {usage.plan.max_albums}</span>
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-ink-3">
              動画は 1 ファイル {formatBytes(usage.plan.max_video_bytes)}・{Math.floor(usage.plan.max_video_duration_sec / 60)} 分まで。有料プランは準備中です。
            </p>
          </section>
        )}

        <nav className="mt-6 overflow-hidden rounded-2xl bg-surface shadow-sm">
          <MenuLink to="/uploads" icon={<UploadCloud className="size-5" />}>
            送信状況
          </MenuLink>
          <MenuLink to="/settings" icon={<Settings className="size-5" />}>
            設定
          </MenuLink>
        </nav>

        <Button
          variant="secondary"
          block
          className="mt-6"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut className="size-5" />
          ログアウト
        </Button>
      </main>
    </>
  );
}

function MenuLink({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex min-h-14 items-center gap-3 border-b border-line px-4 last:border-0 hover:bg-surface-2">
      <span className="text-ink-3">{icon}</span>
      <span className="flex-1 text-base">{children}</span>
      <ChevronRight className="size-4 text-ink-3" />
    </Link>
  );
}

// ---------------------------------------------------------------- 設定
export function SettingsPage() {
  const { pref, setPref } = useTheme();
  const concurrency = useUploadStore((s) => s.concurrency);
  const setConcurrency = useUploadStore((s) => s.setConcurrency);
  const quality = useUploadQuality((s) => s.quality);
  const setQuality = useUploadQuality((s) => s.setQuality);
  const install = useInstallState();
  const [guide, setGuide] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { session } = useAuth();
  const navigate = useNavigate();
  const isEmailUser = session?.user.app_metadata.provider === 'email';
  const { textSize, simpleMode, setTextSize, setSimpleMode } = useDisplay();
  const shownSize = effectiveTextSize(textSize, simpleMode);

  async function onDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error) {
      setDeleting(false);
      setDeleteError(toMessage(error));
      return;
    }
    await supabase.auth.signOut();
    toast('アカウントを削除しました');
    navigate('/login', { replace: true });
  }

  async function onPasswordReset() {
    if (!session?.user.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(session.user.email, {
      redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
    });
    toast(error ? toMessage(error) : 'パスワード再設定メールを送信しました', error ? 'error' : 'info');
  }

  return (
    <>
      <PageHeader title="設定" back="/profile" />
      <main className="px-safe mx-auto max-w-lg space-y-6 py-6">
        <Section title="見やすさ" icon={<Eye className="size-5" />}>
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl bg-accent-soft p-4">
            <span>
              <span className="block text-lg font-bold">かんたんモード</span>
              <span className="mt-1 block text-sm text-ink-2">
                よく使う機能だけを大きく表示します。写真を選ぶと、そのまま送られます。おじいちゃん・おばあちゃんのスマホにおすすめです。
              </span>
            </span>
            <input type="checkbox" role="switch" className="peer sr-only" checked={simpleMode} onChange={(e) => setSimpleMode(e.target.checked)} aria-label="かんたんモード" />
            <span className="relative mt-1 h-8 w-14 shrink-0 rounded-full bg-line transition peer-checked:bg-accent after:absolute after:top-1 after:left-1 after:size-6 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-6" />
          </label>

          <p className="mt-5 mb-2 text-base font-semibold">文字の大きさ</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="文字の大きさ">
            {(['standard', 'large', 'xlarge'] as TextSize[]).map((size) => {
              const disabled = simpleMode && size === 'standard';
              return (
                <button
                  key={size}
                  role="radio"
                  aria-checked={shownSize === size}
                  disabled={disabled}
                  onClick={() => setTextSize(size)}
                  className={`min-h-14 rounded-xl font-semibold disabled:opacity-40 ${shownSize === size ? 'bg-ink text-bg' : 'bg-surface-2'} ${
                    size === 'standard' ? 'text-base' : size === 'large' ? 'text-lg' : 'text-xl'
                  }`}
                >
                  {TEXT_SIZE_LABEL[size]}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-sm text-ink-3">
            {simpleMode ? 'かんたんモードでは「大」以上になります。' : '画面全体の文字とボタンが大きくなります。'}
          </p>
        </Section>

        <Section title="表示" icon={<Moon className="size-5" />}>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['system', 'システム'],
                ['light', 'ライト'],
                ['dark', 'ダーク'],
              ] as [ThemePref, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                aria-pressed={pref === v}
                onClick={() => setPref(v)}
                className={`min-h-11 rounded-xl text-sm font-medium ${pref === v ? 'bg-ink text-bg' : 'bg-surface-2'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="保存する画質" icon={<ImageIcon className="size-5" />}>
          <div className="space-y-2" role="radiogroup" aria-label="保存する画質">
            {(
              [
                ['standard', '容量優先 (おすすめ)', `長辺 ${STANDARD_MAX_EDGE}px の JPEG で保存します。1 枚あたり約 0.5〜1MB で、オリジナルの約 4〜5 倍の枚数を保存できます。スマホで見る分には違いはほぼ分かりません。`],
                ['original', '画質優先 (オリジナル)', '撮影したままの画質で保存します。印刷や大きな画面での表示に向いていますが、1 枚あたり約 2〜5MB を使います。'],
              ] as [UploadQuality, string, string][]
            ).map(([value, label, desc]) => (
              <button
                key={value}
                role="radio"
                aria-checked={quality === value}
                onClick={() => setQuality(value)}
                className={`w-full rounded-xl border p-3 text-left transition ${quality === value ? 'border-accent bg-accent-soft' : 'border-line'}`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`flex size-4 items-center justify-center rounded-full border-2 ${quality === value ? 'border-accent' : 'border-ink-3'}`}>
                    {quality === value && <span className="size-2 rounded-full bg-accent" />}
                  </span>
                  {label}
                </span>
                <span className="mt-1 block pl-6 text-xs text-ink-2">{desc}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-3">
            これから送る写真に適用されます (この端末のみ)。すでに保存した写真は変わりません。動画は常にそのまま保存します。
          </p>
        </Section>

        <Section title="送信" icon={<UploadCloud className="size-5" />}>
          <p className="mb-3 text-sm text-ink-2">同時に送信するファイル数。通信が不安定な場合は少なくしてください。</p>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                aria-pressed={concurrency === n}
                onClick={() => setConcurrency(n)}
                className={`min-h-11 rounded-xl text-sm font-medium ${concurrency === n ? 'bg-ink text-bg' : 'bg-surface-2'}`}
              >
                {n}
              </button>
            ))}
          </div>
        </Section>

        <Section title="ホーム画面に追加" icon={<Smartphone className="size-5" />}>
          {install.installed ? (
            <p className="text-sm text-ink-2">ホーム画面のアプリとして起動しています。</p>
          ) : install.canPrompt ? (
            <Button block onClick={() => void install.prompt()}>
              アプリをインストール
            </Button>
          ) : install.ios ? (
            <Button block variant="secondary" onClick={() => setGuide(true)}>
              追加方法を見る
            </Button>
          ) : (
            <p className="text-sm text-ink-2">ブラウザのメニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。</p>
          )}
        </Section>

        <Section title="アカウント" icon={<Shield className="size-5" />}>
          <p className="text-sm text-ink-2">ログイン中: {session?.user.email}</p>
          <Link to="/profile" className="mt-3 block">
            <Button size="sm" variant="secondary">
              <User className="size-4" />
              名前・写真を変える (マイページ)
            </Button>
          </Link>
          {isEmailUser && (
            <Button size="sm" variant="secondary" className="mt-3" onClick={onPasswordReset}>
              パスワードを変更 (メールで再設定)
            </Button>
          )}
        </Section>

        <Section title="規約・ポリシー" icon={<FileText className="size-5" />}>
          <div className="flex flex-col gap-2 text-sm">
            <Link to="/terms" className="text-accent">
              利用規約
            </Link>
            <Link to="/privacy" className="text-accent">
              プライバシーポリシー
            </Link>
          </div>
        </Section>

        <Section title="アカウントの削除" icon={<Trash2 className="size-5 text-danger" />}>
          <div className="space-y-3 text-sm text-ink-2">
            <p>アカウントを削除すると、以下が完全に削除され元に戻せません。</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>あなたが作成したアルバム (他のメンバーが投稿した写真を含む)</li>
              <li>あなたが他のアルバムに投稿した写真・動画</li>
              <li>コメント・リアクション・プロフィール</li>
            </ul>
            <TextField label="確認のため「削除」と入力" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            <ErrorBox message={deleteError} />
            <Button variant="danger" block disabled={confirmText !== '削除'} loading={deleting} onClick={onDeleteAccount}>
              アカウントを完全に削除
            </Button>
          </div>
        </Section>

        <p className="text-center text-xs text-ink-3">PhotoLink v{import.meta.env.VITE_APP_VERSION ?? '0.1.0'}</p>
      </main>
      <IosInstallGuide open={guide} onClose={() => setGuide(false)} />
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-surface p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <span className="text-ink-3">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
