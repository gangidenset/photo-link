// 共通 UI 部品
import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, Loader2, User } from 'lucide-react';
import { useSignedUrl } from '@/lib/signedUrls';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:opacity-90',
  secondary: 'bg-surface-2 text-ink hover:bg-line',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  block?: boolean;
  size?: 'md' | 'sm';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading, block, size = 'md', className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 ${
        size === 'md' ? 'min-h-12 px-5 text-[15px]' : 'min-h-10 px-4 text-sm'
      } ${variants[variant]} ${block ? 'w-full' : ''} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex size-11 items-center justify-center rounded-full transition hover:bg-surface-2 active:scale-95 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }>(
  function TextField({ label, hint, className = '', id, ...rest }, ref) {
    const inputId = id ?? `f-${label}`;
    return (
      <label htmlFor={inputId} className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
        <input
          ref={ref}
          id={inputId}
          className={`block min-h-12 w-full rounded-xl border border-line bg-surface px-4 text-base text-ink outline-none transition placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20 ${className}`}
          {...rest}
        />
        {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
      </label>
    );
  },
);

export function TextArea({
  label,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      <textarea
        className="block min-h-24 w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink outline-none transition placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20"
        {...rest}
      />
    </label>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`size-6 animate-spin text-ink-3 ${className}`} aria-label="読み込み中" />;
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <Spinner className="size-8" />
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
      {message}
    </p>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-surface-2 text-ink-3">{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="mt-2 text-sm text-ink-2">{children}</div>}
    </div>
  );
}

/** 画面上部のヘッダー (Safe Area 対応・スクロール時も固定) */
export function PageHeader({
  title,
  back,
  actions,
  transparent,
}: {
  title?: ReactNode;
  back?: string | true;
  actions?: ReactNode;
  transparent?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <header
      className={`pt-safe sticky top-0 z-30 ${transparent ? '' : 'border-b border-line/60 bg-bg/85 backdrop-blur-md'}`}
    >
      <div className="px-safe flex h-14 items-center gap-1">
        {back && (
          <IconButton
            label="戻る"
            className="-ml-2"
            onClick={() => (typeof back === 'string' ? navigate(back) : window.history.length > 1 ? navigate(-1) : navigate('/'))}
          >
            <ChevronLeft className="size-6" />
          </IconButton>
        )}
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{title}</h1>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
    </header>
  );
}

export function Avatar({ path, name, size = 36 }: { path?: string | null; name?: string | null; size?: number }) {
  const url = useSignedUrl('avatars', path ?? null);
  const initial = name?.trim().charAt(0) ?? '';
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft font-semibold text-accent"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : initial ? (
        initial
      ) : (
        <User style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </span>
  );
}

/** 画面下からせり上がるシート (コメント・メニューなど) */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="animate-fade-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="animate-sheet-up pb-safe relative flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-3xl bg-surface text-ink shadow-2xl sm:rounded-3xl">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line sm:hidden" />
        {title && <h2 className="px-5 pt-3 pb-2 text-base font-bold">{title}</h2>}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}

export function SheetItem({
  icon,
  children,
  danger,
  onClick,
  to,
}: {
  icon: ReactNode;
  children: ReactNode;
  danger?: boolean;
  onClick?: () => void;
  to?: string;
}) {
  const cls = `flex min-h-13 w-full items-center gap-4 px-5 py-3 text-left text-[15px] transition hover:bg-surface-2 ${
    danger ? 'text-danger' : ''
  }`;
  if (to)
    return (
      <Link to={to} className={cls} onClick={onClick}>
        {icon}
        {children}
      </Link>
    );
  return (
    <button className={cls} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ${className}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  );
}
