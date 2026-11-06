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
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500);
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[calc(var(--sat)+0.75rem)]" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-fade-in pointer-events-auto flex max-w-md items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm text-bg shadow-lg"
        >
          {t.kind === 'error' ? <AlertCircle className="size-4 shrink-0 text-danger" /> : <CheckCircle2 className="size-4 shrink-0 text-success" />}
          {t.message}
        </div>
      ))}
    </div>
  );
}
