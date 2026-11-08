import { create } from 'zustand';
import { CheckCircle2, AlertCircle } from 'lucide-react';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
let seq = 0;

export function toast(message: string, kind: Toast['kind'] = 'info') {
  const id = ++seq;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, kind }] }));
  // ご年配の方でも読み終えられるよう長めに表示
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    // 画面の下 (指の近く・目線の先) に大きく表示
    <div className="bottom-nav-offset pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-fade-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-ink px-5 py-4 text-base font-medium text-bg shadow-xl"
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          {t.kind === 'error' ? <AlertCircle className="size-6 shrink-0 text-danger" /> : <CheckCircle2 className="size-6 shrink-0 text-success" />}
          {t.message}
        </div>
      ))}
    </div>
  );
}
