# PhotoLink

**大切な人たちと、写真や思い出を簡単に共有できるプライベートアルバム**

家族・友人・旅行仲間など、招待した人だけが閲覧・投稿できる写真・動画共有アプリです。
Android (Chrome) と iPhone (Safari) の両方で、ホーム画面に追加してアプリのように使えます (PWA)。

## 主な機能

- メール / Google でログイン、プロフィール (名前・アイコン)、アカウント削除
- 共有アルバムの作成・編集・削除、カバー画像、メンバー数・写真枚数の表示
- 招待 URL・招待コード (LINE で送れる)、有効期限、無効化、承認制、メンバーの退会・除外
- 写真・動画の一括アップロード (100 枚以上可)、進捗表示、失敗分のみ再試行、重複防止
- アップロード前に端末内で **GPS 位置情報を自動削除**、オリジナル画質を保存
- 月別グリッド、無限スクロール、投稿者で絞り込み、スワイプ・ピンチ拡大のビューア、動画再生、ダウンロード
- コメント、いいね・絵文字リアクション、アプリ内通知 (リアルタイム)
- ダークモード、iPhone のノッチ / ホームバー対応

## 技術構成

| | |
|---|---|
| フロントエンド | React 19 / TypeScript / Vite 7 / Tailwind CSS 4 / PWA |
| バックエンド | Supabase (PostgreSQL・Auth・Storage・Realtime・Edge Functions) |
| 権限管理 | Row Level Security (全テーブル)、非公開 Storage + 署名付き URL |
| ホスティング | Vercel |

設計の詳細は **[docs/DESIGN.md](docs/DESIGN.md)** を参照してください。

## はじめかた

**[docs/SETUP.md](docs/SETUP.md)** に、Supabase・Google ログイン・Vercel の設定手順をまとめています。

```bash
npm install
cp .env.example .env.local   # Supabase の URL と anon キーを設定
npm run dev
```

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー (同じ Wi-Fi のスマートフォンからもアクセス可) |
| `npm run build` | 型チェック + 本番ビルド |
| `npm test` | ユニットテスト |
| `npm run test:db` | DB マイグレーション + RLS テスト (PostgreSQL が必要) |
| `npm run test:e2e` | ブラウザ E2E (モック。手順は docs/TESTING.md) |
| `npm run icons` | `assets/icon-source.png` から PWA アイコンを生成 (Python + Pillow) |

## ドキュメント

- [docs/DESIGN.md](docs/DESIGN.md) — 設計書 (構成図・DB 設計・画面遷移・セキュリティ・コスト)
- [docs/SETUP.md](docs/SETUP.md) — セットアップ手順 (人間の操作が必要な作業)
- [docs/TESTING.md](docs/TESTING.md) — テスト記録と実機テストのチェックリスト
- [docs/PROGRESS.md](docs/PROGRESS.md) — 実装済み / 未実装の一覧
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — 運用 (利用量・コスト・バックアップ・監視)

## ディレクトリ構成

```
src/
  features/      機能ごとのコード (auth, albums, members, photos, upload, social, notifications, profile)
  components/    共通 UI (下部ナビ、ボタン、シートなど)
  lib/           Supabase クライアント、署名付き URL、共通処理
supabase/
  migrations/    DB マイグレーション (テーブル・RLS・関数・Storage)
  functions/     Edge Functions (アカウント削除)
  tests/         RLS テスト
e2e/             ブラウザ E2E テスト
docs/            ドキュメント
```

## セキュリティ

- `.env` / `.env.local` は Git 管理対象外です。**service_role キーをコードや `.env.local` に書かないでください。**
- 脆弱性を見つけた場合は Issue ではなく、リポジトリ管理者へ直接ご連絡ください。
