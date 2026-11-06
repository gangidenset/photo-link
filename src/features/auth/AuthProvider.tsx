import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';
import { clearSignedUrlCache } from '@/lib/signedUrls';
import type { Profile } from '@/types/db';
import { FullPageSpinner } from '@/components/ui';

interface AuthState {
  session: Session | null;
  userId: string | null;
  loading: boolean;
  /** パスワード再設定メールから来た状態 */
  recovery: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, userId: null, loading: true, recovery: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, userId: null, loading: true, recovery: false });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState((s) => ({ ...s, session: data.session, userId: data.session?.user.id ?? null, loading: false }));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setState((s) => ({
        session,
        userId: session?.user.id ?? null,
        loading: false,
        recovery: event === 'PASSWORD_RECOVERY' ? true : event === 'SIGNED_OUT' ? false : s.recovery,
      }));
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
        clearSignedUrlCache();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** ログイン必須の画面を保護。未ログインならログイン画面へ (戻り先を保持) */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}

export function useMyProfile() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId!).single();
      if (error) throw error;
      return data as Profile;
    },
  });
}

/** ログイン後の戻り先 (外部 URL へのリダイレクトを防ぐ) */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}
