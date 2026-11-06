# 運用ガイド

## 利用量とコストの確認

Supabase ダッシュボードの **SQL Editor** で実行します。

```sql
-- ユーザー別のストレージ使用量 (多い順)
select * from public.storage_usage_by_user order by total_bytes desc limit 50;

-- 日別のアップロード量 (直近 30 日)
select day, sum(uploaded_files) as files, pg_size_pretty(sum(uploaded_bytes)) as bytes
from public.usage_daily where day > current_date - 30 group by day order by day desc;

-- 全体のストレージ使用量
select pg_size_pretty(sum((metadata->>'size')::bigint)) from storage.objects where bucket_id = 'photos';
```

転送量 (Egress) は **Project Settings → Usage** で確認できます。Free プランの上限に近づいたら Pro への移行を検討してください。

## プランの変更 (手動)

決済連携までの間、特定ユーザーの上限を引き上げる場合:

```sql
update public.profiles set plan_id = 'plus' where id = '<ユーザーの UUID>';
-- プランの上限値を変更する場合
update public.plans set max_storage_bytes = 10737418240 where id = 'free';
```

## 定期メンテナンス

- `cleanup_stale_uploads()`: 24 時間以上完了しないアップロードの記録を削除 (pg_cron で毎時実行を推奨。docs/SETUP.md 手順 7)。
  返り値のパスは Storage 上に残っている可能性があるため、気になる場合は Storage 画面から削除します。
- `cleanup_rate_limit_events()`: 2 日より古いレート制限の記録を削除 (毎日)。

## バックアップ

- Pro プランでは毎日のデータベースバックアップが自動で取得されます (Free プランはなし)。
- **Storage のファイルはデータベースのバックアップに含まれません。** 重要な運用段階では、定期的に別ストレージへ複製する仕組みを検討してください。

## 監視 (推奨・未導入)

| 対象 | 方法 |
|---|---|
| フロントエンドのエラー | Sentry (無料枠あり) を導入し、`src/main.tsx` で初期化 |
| API・DB のエラー | Supabase の **Logs Explorer** (API / Postgres / Auth / Storage / Edge Functions) |
| 稼働監視 | UptimeRobot 等でトップページを 5 分ごとに監視 |
| セキュリティ | Supabase の **Advisors → Security Advisor** を定期確認 (RLS 漏れなどを自動検出) |

## セキュリティ運用

- service_role キーが漏れた疑いがある場合: **Project Settings → API** でキーを再発行 (Roll) し、Edge Function を再デプロイ
- 不正なアップロードの通報があった場合: SQL Editor で該当写真を特定し、Storage のファイルと `photos` の行を削除。必要に応じてユーザーを **Authentication → Users** から停止 (Ban)
