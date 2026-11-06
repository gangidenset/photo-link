import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { EmailOtpType } from '@supabase/supabase-js';
import { appUrl, supabase } from '@/lib/supabase';
import { toMessage } from '@/lib/errors';
import { Button, ErrorBox, FullPageSpinner, TextField } from '@/components/ui';
import { toast } from '@/components/toast';
import { safeNext, useAuth } from './AuthProvider';

const NEXT_KEY = 'photolink.next';

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="pt-safe pb-safe px-safe mx-auto flex min-h-dvh max-w-md flex-col justify-center py-10">
      <div className="mb-8 text-center">
        <img src="/favicon.svg" alt="" className="mx-auto mb-4 size-16 rounded-2xl shadow-sm" />
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {children}
    </main>
  );
}

function GoogleButton({ next }: { next: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      block
      loading={loading}
      onClick={async () => {
        setLoading(true);
        try {
          sessionStorage.setItem(NEXT_KEY, next);
        } catch {
          /* ignore */
        }
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${appUrl()}/auth/callback` },
        });
        if (error) {
          setLoading(false);
          toast(toMessage(error), 'error');
        }
      }}
    >
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.07l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
      </svg>
      Google でログイン
    </Button>
  );
}

function Divider() {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-ink-3">
      <span className="h-px flex-1 bg-line" />
      または
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function LoginPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  if (session) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(toMessage(error));
    else navigate(next, { replace: true });
  }

  return (
    <AuthShell title="PhotoLink" subtitle="大切な人たちと、写真や思い出を共有しよう">
      <GoogleButton next={next} />
      <Divider />
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField label="メールアドレス" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="パスワード" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorBox message={error} />
        <Button type="submit" block loading={loading}>
          ログイン
        </Button>
      </form>
      <div className="mt-6 flex flex-col items-center gap-3 text-sm">
        <Link to="/forgot-password" className="text-ink-2 underline-offset-4 hover:underline">
          パスワードを忘れた方
        </Link>
        <p className="text-ink-2">
          はじめての方は{' '}
          <Link to={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-accent">
            新規登録
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

export function SignupPage() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  if (session && !sent) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('パスワードは 8 文字以上にしてください。');
    if (!agree) return setError('利用規約とプライバシーポリシーへの同意が必要です。');
    setLoading(true);
    try {
      localStorage.setItem(NEXT_KEY, next);
    } catch {
      /* ignore */
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: name.trim() },
        emailRedirectTo: `${appUrl()}/auth/confirm`,
      },
    });
    setLoading(false);
    if (error) return setError(toMessage(error));
    if (data.session) navigate(next, { replace: true });
    else setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="確認メールを送信しました" subtitle={email}>
        <div className="space-y-4 rounded-2xl bg-surface p-5 text-sm leading-relaxed text-ink-2">
          <p>メールに記載されたリンクを開くと登録が完了します。</p>
          <p>メールが届かない場合は、迷惑メールフォルダもご確認ください。</p>
          <p className="text-xs text-ink-3">
            ※ iPhone でホーム画面に追加したアプリから登録した場合、リンクは Safari で開きます。確認後、アプリに戻ってログインしてください。
          </p>
        </div>
        <Link to="/login" className="mt-6 block text-center text-sm font-semibold text-accent">
          ログイン画面へ
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="アカウント作成" subtitle="無料ではじめられます">
      <GoogleButton next={next} />
      <Divider />
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField label="表示名" autoComplete="nickname" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} hint="アルバムのメンバーに表示されます" />
        <TextField label="メールアドレス" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="パスワード" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} hint="8 文字以上" />
        <label className="flex items-start gap-3 text-sm text-ink-2">
          <input type="checkbox" className="mt-1 size-5 accent-[var(--accent)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            <Link to="/terms" className="text-accent underline">
              利用規約
            </Link>
            と
            <Link to="/privacy" className="text-accent underline">
              プライバシーポリシー
            </Link>
            に同意します
          </span>
        </label>
        <ErrorBox message={error} />
        <Button type="submit" block loading={loading}>
          登録する
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-2">
        アカウントをお持ちの方は{' '}
        <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-accent">
          ログイン
        </Link>
      </p>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${appUrl()}/auth/confirm?next=/reset-password`,
    });
    setLoading(false);
    if (error) setError(toMessage(error));
    else setSent(true);
  }

  return (
    <AuthShell title="パスワード再設定" subtitle="登録したメールアドレスに再設定用のリンクを送ります">
      {sent ? (
        <p className="rounded-2xl bg-surface p-5 text-sm text-ink-2">
          メールを送信しました。リンクを開いて新しいパスワードを設定してください。
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <TextField label="メールアドレス" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <ErrorBox message={error} />
          <Button type="submit" block loading={loading}>
            送信する
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-6 block text-center text-sm text-ink-2">
        ログイン画面へ戻る
      </Link>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { session, loading: authLoading } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  if (authLoading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/forgot-password" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('パスワードは 8 文字以上にしてください。');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(toMessage(error));
    toast('パスワードを変更しました');
    navigate('/', { replace: true });
  }

  return (
    <AuthShell title="新しいパスワード">
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField label="新しいパスワード" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} hint="8 文字以上" />
        <ErrorBox message={error} />
        <Button type="submit" block loading={loading}>
          変更する
        </Button>
      </form>
    </AuthShell>
  );
}

/**
 * メール内リンクの受け口 (登録確認・パスワード再設定)
 *   token_hash 方式: メールを開いたブラウザが登録時と違っても確認できる
 *   (例: iPhone の Gmail アプリ内ブラウザで開いた場合)
 */
export function AuthConfirmPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tokenHash = params.get('token_hash');
    const type = (params.get('type') ?? 'email') as EmailOtpType;
    let next = safeNext(params.get('next'));
    if (type === 'recovery') next = '/reset-password';
    else {
      try {
        next = safeNext(localStorage.getItem(NEXT_KEY)) || next;
        localStorage.removeItem(NEXT_KEY);
      } catch {
        /* ignore */
      }
    }

    (async () => {
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (error) return setError(toMessage(error));
      } else {
        // PKCE の code 付きで戻ってきた場合は supabase-js が自動処理する
        const { data } = await supabase.auth.getSession();
        if (!data.session) return setError('リンクが無効か、期限が切れています。もう一度お試しください。');
      }
      navigate(next, { replace: true });
    })();
  }, [params, navigate]);

  if (error)
    return (
      <AuthShell title="確認できませんでした">
        <ErrorBox message={error} />
        <Link to="/login" className="mt-6 block text-center text-sm font-semibold text-accent">
          ログイン画面へ
        </Link>
      </AuthShell>
    );
  return <FullPageSpinner />;
}

/** Google ログインからの戻り先 */
export function AuthCallbackPage() {
  const { session, loading } = useAuth();
  const [params] = useSearchParams();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, []);

  if (session) {
    let next = '/';
    try {
      next = safeNext(sessionStorage.getItem(NEXT_KEY));
      sessionStorage.removeItem(NEXT_KEY);
    } catch {
      /* ignore */
    }
    return <Navigate to={next} replace />;
  }
  const err = params.get('error_description');
  if (err || (timedOut && !loading))
    return (
      <AuthShell title="ログインできませんでした">
        <ErrorBox message={err ?? 'もう一度お試しください。'} />
        <Link to="/login" className="mt-6 block text-center text-sm font-semibold text-accent">
          ログイン画面へ
        </Link>
      </AuthShell>
    );
  return <FullPageSpinner />;
}
