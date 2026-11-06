// 環境変数が未設定のときに表示するセットアップ案内
export function SetupRequired() {
  return (
    <main className="px-safe pt-safe mx-auto max-w-lg py-12">
      <h1 className="text-2xl font-bold">PhotoLink のセットアップ</h1>
      <p className="mt-4 text-ink-2">Supabase の接続情報が設定されていません。</p>
      <ol className="mt-6 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
        <li>
          <code className="rounded bg-surface-2 px-1">.env.example</code> を <code className="rounded bg-surface-2 px-1">.env.local</code> にコピー
        </li>
        <li>
          <code className="rounded bg-surface-2 px-1">VITE_SUPABASE_URL</code> と <code className="rounded bg-surface-2 px-1">VITE_SUPABASE_ANON_KEY</code> に Supabase の値を設定
        </li>
        <li>開発サーバーを再起動 (Vercel の場合は Environment Variables に設定して再デプロイ)</li>
      </ol>
      <p className="mt-6 text-sm text-ink-3">詳しくは docs/SETUP.md をご覧ください。</p>
    </main>
  );
}
