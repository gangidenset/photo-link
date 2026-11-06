import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** 環境変数が設定されているか (未設定ならセットアップ案内を表示する) */
export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('xxxxxxxx'));

export const SUPABASE_URL = url ?? 'http://localhost:54321';
export const SUPABASE_ANON_KEY = anonKey ?? 'missing-anon-key';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // PKCE: Google ログインなどのリダイレクトを安全に処理する方式
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** アプリの公開 URL (招待リンク・認証メールのリダイレクト先) */
export function appUrl(): string {
  const configured = import.meta.env.VITE_APP_URL as string | undefined;
  if (configured && typeof window !== 'undefined' && window.location.origin === configured) return configured;
  return typeof window !== 'undefined' ? window.location.origin : (configured ?? '');
}

/** 現在のアクセストークン (Storage への直接アップロードで使用) */
export async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) throw new Error('not_authenticated');
  // 期限が 60 秒以内なら更新
  if (session.expires_at && session.expires_at * 1000 - Date.now() < 60_000) {
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (error || !refreshed.session) throw error ?? new Error('not_authenticated');
    return refreshed.session.access_token;
  }
  return session.access_token;
}
