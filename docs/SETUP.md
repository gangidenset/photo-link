# セットアップ手順 (人間の操作が必要な作業)

PhotoLink を実際に動かすには、以下の作業を**ご自身のアカウントで**行う必要があります。
所要時間の目安: 30〜60 分。上から順番に進めてください。

> 用語: **anon key (公開キー)** = ブラウザに配っても安全なキー (RLS で守られるため)。
> **service_role key (秘密キー)** = 何でもできる管理者キー。**絶対に** GitHub やフロントエンドに書かない。

---

## 1. Supabase プロジェクトを作成する

1. https://supabase.com にアクセスし、GitHub アカウントでサインアップ
2. 「New project」をクリック
   - Name: `photo-link`
   - Database Password: 強力なパスワードを生成し、**パスワード管理アプリに保存** (後で使います)
   - Region: **Northeast Asia (Tokyo)** を推奨 (日本のユーザーが速い)
   - Plan: まずは Free で OK (本番公開時は Pro を推奨。→ [docs/DESIGN.md の 10 章](DESIGN.md#10-月額運用コストの概算))
3. 作成完了まで 2 分ほど待つ

## 2. API キーを取得する

1. 左メニュー **Project Settings → API** (または「API Keys」)
2. 次の 2 つを控える
   - **Project URL** (例: `https://abcdefghijkl.supabase.co`)
   - **anon public** キー (または「Publishable key」)
3. **service_role / secret キーは控えなくてよい** (Edge Function では Supabase が自動で設定します)

## 3. データベースを構築する (マイグレーション)

方法 A (おすすめ: 確実・簡単): **SQL Editor に貼り付けて実行**

1. 左メニュー **SQL Editor** → 「New query」
2. このリポジトリの `supabase/migrations/` 内のファイルを**ファイル名の順番に** 1 つずつ開き、
   中身をすべてコピー → 貼り付け → 「Run」
   1. `20261106000001_schema.sql`
   2. `20261106000002_security.sql`
   3. `20261106000003_functions.sql`
   4. `20261106000004_notifications.sql`
   5. `20261106000005_storage.sql`
   6. `20261107000001_fix_album_select_policy.sql`
   7. `20261107000002_photo_downloads.sql`
3. それぞれ「Success. No rows returned」と出れば成功
4. スマホでは長いファイルがコピーしきれないことがあります。その場合は 3 番の代わりに
   `supabase/mobile/03a_functions.sql` → `03b` → `03c` を順に実行してください (内容は同じです)

方法 B (開発者向け): Supabase CLI

```bash
npx supabase login
npx supabase link --project-ref <Project URL の abcdefghijkl 部分>
npx supabase db push
```

確認: 左メニュー **Table Editor** に `albums`, `photos` などのテーブルがあり、
**Storage** に `photos` と `avatars` バケット (どちらも「Private」) があれば OK。

## 4. 認証 (Authentication) を設定する

### 4-1. URL の設定

**Authentication → URL Configuration**

| 項目 | 開発中 | 本番公開後 |
|---|---|---|
| Site URL | `http://localhost:5173` | `https://<あなたのドメイン>` (Vercel の URL) |
| Redirect URLs | `http://localhost:5173/**` | `https://<あなたのドメイン>/**` を**追加** |

### 4-2. メールテンプレート (推奨)

iPhone では「メールアプリ内のブラウザ」でリンクが開かれることが多く、標準テンプレートだと確認に失敗することがあります。
**Authentication → Emails (Email Templates)** で以下に変更してください。

**Confirm signup** の本文:

```html
<h2>PhotoLink へようこそ</h2>
<p>下のボタンからメールアドレスを確認してください。</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">メールアドレスを確認する</a></p>
```

**Reset Password** の本文:

```html
<h2>パスワードの再設定</h2>
<p>下のボタンから新しいパスワードを設定してください。</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">パスワードを再設定する</a></p>
```

件名も日本語に変えておくと親切です (例:「【PhotoLink】メールアドレスの確認」)。

### 4-3. パスワードの強さ

**Authentication → Providers → Email** (または Sign In / Up 設定) で
「Minimum password length」を **8** に設定。

### 4-4. メール送信 (本番前に必須)

Supabase の標準メール送信は **1 時間に数通まで**の制限があり、テスト用です。
本番公開前に **Authentication → Emails → SMTP Settings** で
Resend / SendGrid / Amazon SES などの SMTP を設定してください。

## 5. Google ログインを設定する (任意)

1. https://console.cloud.google.com でプロジェクトを作成
2. **API とサービス → OAuth 同意画面**: 「外部」を選び、アプリ名 `PhotoLink`、サポートメールを入力
3. **API とサービス → 認証情報 → 認証情報を作成 → OAuth クライアント ID**
   - 種類: ウェブアプリケーション
   - 承認済みのリダイレクト URI: `https://<Project URL のドメイン>/auth/v1/callback`
     (例: `https://abcdefghijkl.supabase.co/auth/v1/callback`)
4. 表示された **クライアント ID** と **クライアントシークレット** を、
   Supabase の **Authentication → Providers → Google** に貼り付けて有効化

## 6. アカウント削除機能 (Edge Function) をデプロイする

アカウント削除は秘密キーが必要なため、サーバー側の関数で行います。

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase functions deploy delete-account
```

(Supabase ダッシュボードの **Edge Functions → Deploy a new function** から
`supabase/functions/delete-account/index.ts` の中身を貼り付けてデプロイすることもできます。関数名は `delete-account`。)

## 7. 定期的な掃除 (推奨)

途中で止まったアップロードの記録を削除するため、**Database → Extensions** で `pg_cron` を有効化し、SQL Editor で実行:

```sql
select cron.schedule('photolink-cleanup-uploads', '17 * * * *', $$select public.cleanup_stale_uploads()$$);
select cron.schedule('photolink-cleanup-ratelimit', '23 3 * * *', $$select public.cleanup_rate_limit_events()$$);
```

## 8. 手元のパソコンで動かす

Node.js 22 以上が必要です (https://nodejs.org)。

```bash
git clone https://github.com/gangidenset/photo-link.git
cd photo-link
npm install
cp .env.example .env.local
# .env.local を開き、VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を手順 2 の値に書き換える
npm run dev
```

ブラウザで http://localhost:5173 を開きます。
**スマートフォンで試す場合**: パソコンと同じ Wi-Fi に接続し、ターミナルに表示される
`Network: http://192.168.x.x:5173` を開きます (この場合は手順 4-1 の Redirect URLs にも追加)。
※ カメラ・共有シート・PWA インストールなど一部の機能は **HTTPS が必要**なため、
実機テストは手順 9 の Vercel プレビュー URL で行うのが確実です。

## 9. Vercel に公開する

1. https://vercel.com に GitHub アカウントでサインアップ
2. 「Add New → Project」→ `photo-link` リポジトリを Import
3. Framework Preset: **Vite** (自動検出)
4. **Environment Variables** に追加:
   - `VITE_SUPABASE_URL` = 手順 2 の Project URL
   - `VITE_SUPABASE_ANON_KEY` = 手順 2 の anon キー
   - (任意) `VITE_OPERATOR_NAME` = 運営者名、`VITE_CONTACT_EMAIL` = 問い合わせ先 (規約ページに表示)
5. 「Deploy」
6. 発行された URL (例: `https://photo-link-xxx.vercel.app`) を、手順 4-1 の **Site URL / Redirect URLs** に設定
7. 以降は GitHub に push するだけで自動デプロイされます (ブランチごとにプレビュー URL も発行)

## 10. 動作確認

[docs/TESTING.md](TESTING.md) の「実機テスト チェックリスト」に沿って、Android と iPhone で確認してください。

---

## よくあるトラブル

| 症状 | 原因と対処 |
|---|---|
| 「Supabase の接続情報が設定されていません」と表示 | `.env.local` (Vercel では Environment Variables) が未設定。設定後に再起動・再デプロイ |
| 確認メールのリンクを開くとエラー | 手順 4-1 の Redirect URLs、4-2 のテンプレートを確認 |
| 50MB を超える動画がアップロードできない | Supabase Free プランはファイル 1 つ 50MB まで。Pro プランで **Storage → Settings → Upload file size limit** を引き上げる |
| Google ログイン後にエラー | Google 側のリダイレクト URI と Supabase の Redirect URLs を確認 |
| アカウント削除でエラー | 手順 6 の Edge Function が未デプロイ |
