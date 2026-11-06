-- =============================================================================
-- PhotoLink: テーブル定義
-- =============================================================================
-- 権限チェック (RLS) は 20261106000002_security.sql、
-- 業務ロジック関数 (RPC) は 20261106000003_functions.sql を参照。

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 共通: updated_at 自動更新
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- plans: 料金プランと利用上限 (将来 Stripe と連携)
-- -----------------------------------------------------------------------------
create table public.plans (
  id                     text primary key,
  name                   text not null,
  max_albums             integer not null check (max_albums > 0),
  max_storage_bytes      bigint  not null check (max_storage_bytes > 0),
  max_image_bytes        bigint  not null check (max_image_bytes > 0),
  max_video_bytes        bigint  not null check (max_video_bytes >= 0),
  max_video_duration_sec integer not null check (max_video_duration_sec >= 0),
  features               jsonb   not null default '{}'::jsonb,
  stripe_price_id        text,
  sort_order             integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger plans_updated_at before update on public.plans
  for each row execute function public.set_updated_at();

insert into public.plans
  (id, name, max_albums, max_storage_bytes, max_image_bytes, max_video_bytes, max_video_duration_sec, features, sort_order)
values
  ('free', 'フリー', 20,   5::bigint   * 1024 * 1024 * 1024, 50::bigint * 1024 * 1024, 200::bigint * 1024 * 1024,  300,
   '{"bulk_download": false, "advanced_search": false, "ads_free": false, "photobook": false}', 0),
  ('plus', 'プラス', 200, 200::bigint * 1024 * 1024 * 1024, 100::bigint * 1024 * 1024, 2::bigint * 1024 * 1024 * 1024, 3600,
   '{"bulk_download": true, "advanced_search": true, "ads_free": true, "photobook": true}', 1);

-- -----------------------------------------------------------------------------
-- profiles: auth.users と 1:1 のユーザー情報
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  avatar_path  text check (avatar_path is null or char_length(avatar_path) <= 300),
  plan_id      text not null default 'free' references public.plans (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_plan_id_idx on public.profiles (plan_id);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- 新規ユーザー登録時に profiles を自動作成
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'ユーザー'
  );
  insert into public.profiles (id, display_name)
  values (new.id, left(v_name, 40));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- albums
-- -----------------------------------------------------------------------------
create table public.albums (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  title          text not null check (char_length(btrim(title)) between 1 and 80),
  description    text not null default '' check (char_length(description) <= 1000),
  cover_photo_id uuid, -- FK は photos 作成後に追加
  photo_count    integer not null default 0 check (photo_count >= 0),
  member_count   integer not null default 0 check (member_count >= 0),
  last_photo_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index albums_owner_id_idx on public.albums (owner_id);

create trigger albums_updated_at before update on public.albums
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- album_members
-- -----------------------------------------------------------------------------
create table public.album_members (
  album_id  uuid not null references public.albums (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (album_id, user_id)
);

create index album_members_user_id_idx on public.album_members (user_id);
-- 1 アルバムにオーナーは 1 人だけ
create unique index album_members_one_owner_idx on public.album_members (album_id) where role = 'owner';

-- -----------------------------------------------------------------------------
-- invitations: 招待 URL / 招待コード
-- -----------------------------------------------------------------------------
create table public.invitations (
  id                uuid primary key default gen_random_uuid(),
  album_id          uuid not null references public.albums (id) on delete cascade,
  created_by        uuid not null references public.profiles (id) on delete cascade,
  token             text not null unique check (char_length(token) >= 32),
  code              text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  requires_approval boolean not null default false,
  expires_at        timestamptz not null,
  max_uses          integer check (max_uses is null or max_uses > 0),
  use_count         integer not null default 0 check (use_count >= 0),
  revoked_at        timestamptz,
  created_at        timestamptz not null default now()
);

create index invitations_album_id_idx on public.invitations (album_id);

-- -----------------------------------------------------------------------------
-- join_requests: 承認制招待の参加リクエスト
-- -----------------------------------------------------------------------------
create table public.join_requests (
  id            uuid primary key default gen_random_uuid(),
  album_id      uuid not null references public.albums (id) on delete cascade,
  invitation_id uuid references public.invitations (id) on delete set null,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);

create unique index join_requests_one_pending_idx on public.join_requests (album_id, user_id) where status = 'pending';
create index join_requests_user_id_idx on public.join_requests (user_id);
create index join_requests_album_status_idx on public.join_requests (album_id, status);

-- -----------------------------------------------------------------------------
-- photos: 写真・動画 (ファイル本体は Storage の photos バケット)
-- -----------------------------------------------------------------------------
create table public.photos (
  id                uuid primary key default gen_random_uuid(),
  album_id          uuid not null references public.albums (id) on delete cascade,
  uploader_id       uuid not null references public.profiles (id) on delete cascade,
  media_type        text not null check (media_type in ('image', 'video')),
  status            text not null default 'uploading' check (status in ('uploading', 'ready')),
  storage_path      text not null unique,
  thumb_path        text,
  preview_path      text,
  mime_type         text not null check (mime_type in (
                      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
                      'video/mp4', 'video/quicktime', 'video/webm')),
  size_bytes        bigint not null check (size_bytes > 0),
  width             integer check (width is null or width > 0),
  height            integer check (height is null or height > 0),
  duration_sec      numeric(10, 2) check (duration_sec is null or duration_sec >= 0),
  original_filename text not null default '' check (char_length(original_filename) <= 255),
  content_hash      text not null check (content_hash ~ '^[a-z0-9:]{16,100}$'),
  taken_at          timestamptz,
  sort_at           timestamptz generated always as (coalesce(taken_at, created_at)) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check ((media_type = 'image' and mime_type like 'image/%') or (media_type = 'video' and mime_type like 'video/%'))
);

create index photos_album_sort_idx on public.photos (album_id, sort_at desc, id desc) where status = 'ready';
create index photos_album_uploader_idx on public.photos (album_id, uploader_id);
create index photos_uploader_idx on public.photos (uploader_id);
create index photos_status_created_idx on public.photos (status, created_at) where status = 'uploading';
-- 同じアルバムへの同一ファイルの重複投稿を防止
create unique index photos_album_hash_idx on public.photos (album_id, content_hash);

create trigger photos_updated_at before update on public.photos
  for each row execute function public.set_updated_at();

alter table public.albums
  add constraint albums_cover_photo_id_fkey
  foreign key (cover_photo_id) references public.photos (id) on delete set null;

-- -----------------------------------------------------------------------------
-- comments
-- -----------------------------------------------------------------------------
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos (id) on delete cascade,
  album_id   uuid not null references public.albums (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index comments_photo_created_idx on public.comments (photo_id, created_at);
create index comments_author_idx on public.comments (author_id);
create index comments_album_idx on public.comments (album_id);

create trigger comments_updated_at before update on public.comments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- reactions: いいね (❤️) と絵文字リアクション
-- -----------------------------------------------------------------------------
create table public.reactions (
  photo_id   uuid not null references public.photos (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (emoji in ('❤️', '😂', '😮', '😢', '👏', '🎉', '👍', '🔥')),
  album_id   uuid not null references public.albums (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id, emoji)
);

create index reactions_user_idx on public.reactions (user_id);
create index reactions_album_idx on public.reactions (album_id);

-- -----------------------------------------------------------------------------
-- notifications: アプリ内通知 (トリガーで自動作成)
-- -----------------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  album_id     uuid references public.albums (id) on delete cascade,
  photo_id     uuid references public.photos (id) on delete cascade,
  type         text not null check (type in (
                 'photo_added', 'member_joined', 'comment', 'reaction',
                 'join_request', 'join_approved', 'join_rejected')),
  data         jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index notifications_recipient_created_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;
create index notifications_actor_idx on public.notifications (actor_id);
create index notifications_album_idx on public.notifications (album_id);
create index notifications_photo_idx on public.notifications (photo_id);

create trigger notifications_updated_at before update on public.notifications
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- rate_limit_events: レート制限用のイベントログ
-- -----------------------------------------------------------------------------
create table public.rate_limit_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  action     text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_events_lookup_idx on public.rate_limit_events (user_id, action, created_at desc);

-- -----------------------------------------------------------------------------
-- usage_daily: コスト把握用の日次利用量
-- -----------------------------------------------------------------------------
create table public.usage_daily (
  user_id        uuid not null references public.profiles (id) on delete cascade,
  day            date not null,
  uploaded_bytes bigint  not null default 0,
  uploaded_files integer not null default 0,
  primary key (user_id, day)
);
