-- =============================================================================
-- PhotoLink: 権限 (RLS)・整合性トリガー
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 判定用ヘルパー関数
--   SECURITY DEFINER: RLS の無限再帰を避けるため、関数内では RLS を通さず判定する
-- -----------------------------------------------------------------------------
create or replace function public.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.is_album_member(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.album_members m
    where m.album_id = p_album_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_album_owner(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.album_members m
    where m.album_id = p_album_id and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- 自分が閲覧してよいプロフィールか
--   自分自身 / 同じアルバムのメンバー / 自分が参加するアルバムの投稿者・コメント者 /
--   自分が所有するアルバムへの参加申請者
create or replace function public.can_view_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    p_user_id = auth.uid()
    or exists (
      select 1 from public.album_members me
      join public.album_members other on other.album_id = me.album_id
      where me.user_id = auth.uid() and other.user_id = p_user_id
    )
    or exists (
      select 1 from public.photos p
      join public.album_members me on me.album_id = p.album_id and me.user_id = auth.uid()
      where p.uploader_id = p_user_id
    )
    or exists (
      select 1 from public.comments c
      join public.album_members me on me.album_id = c.album_id and me.user_id = auth.uid()
      where c.author_id = p_user_id
    )
    or exists (
      select 1 from public.join_requests r
      join public.album_members me on me.album_id = r.album_id and me.user_id = auth.uid() and me.role = 'owner'
      where r.user_id = p_user_id
    )
  );
$$;

-- レート制限: 時間窓内の回数が上限を超えたら例外
create or replace function public.check_rate_limit(p_action text, p_max integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select count(*) into v_count
  from public.rate_limit_events
  where user_id = auth.uid() and action = p_action and created_at > now() - p_window;
  if v_count >= p_max then
    raise exception 'rate_limited' using errcode = 'P0001', hint = p_action;
  end if;
  insert into public.rate_limit_events (user_id, action) values (auth.uid(), p_action);
end;
$$;

-- -----------------------------------------------------------------------------
-- albums: 作成時の上限チェックとオーナー登録
-- -----------------------------------------------------------------------------
create or replace function public.albums_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_count integer;
begin
  if new.owner_id is distinct from auth.uid() and auth.uid() is not null then
    raise exception 'owner_mismatch' using errcode = '42501';
  end if;
  select pl.max_albums into v_max
  from public.profiles pr join public.plans pl on pl.id = pr.plan_id
  where pr.id = new.owner_id;
  select count(*) into v_count from public.albums where owner_id = new.owner_id;
  if v_max is not null and v_count >= v_max then
    raise exception 'album_limit_reached' using errcode = 'P0001', hint = v_max::text;
  end if;
  -- クライアントから集計値を偽装させない
  new.photo_count := 0;
  new.member_count := 0;
  new.cover_photo_id := null;
  new.last_photo_at := null;
  return new;
end;
$$;

create trigger albums_before_insert before insert on public.albums
  for each row execute function public.albums_before_insert();

create or replace function public.albums_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.album_members (album_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger albums_after_insert after insert on public.albums
  for each row execute function public.albums_after_insert();

-- カバー写真は同じアルバムの公開済み写真に限る
create or replace function public.albums_validate_cover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cover_photo_id is not null and new.cover_photo_id is distinct from old.cover_photo_id then
    if not exists (
      select 1 from public.photos p
      where p.id = new.cover_photo_id and p.album_id = new.id and p.status = 'ready' and p.media_type = 'image'
    ) then
      raise exception 'invalid_cover_photo' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger albums_validate_cover before update of cover_photo_id on public.albums
  for each row execute function public.albums_validate_cover();

-- -----------------------------------------------------------------------------
-- 集計値 (member_count / photo_count) の自動更新
-- -----------------------------------------------------------------------------
create or replace function public.album_members_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.albums set member_count = member_count + 1 where id = new.album_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.albums set member_count = greatest(member_count - 1, 0) where id = old.album_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger album_members_count after insert or delete on public.album_members
  for each row execute function public.album_members_count();

create or replace function public.photos_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'uploading' and new.status = 'ready' then
    update public.albums
      set photo_count = photo_count + 1,
          last_photo_at = greatest(coalesce(last_photo_at, new.updated_at), new.updated_at)
      where id = new.album_id;
  elsif tg_op = 'DELETE' and old.status = 'ready' then
    update public.albums set photo_count = greatest(photo_count - 1, 0) where id = old.album_id;
  end if;
  return null;
end;
$$;

create trigger photos_count after update of status or delete on public.photos
  for each row execute function public.photos_count();

-- オーナー行は削除不可 (アルバム削除時の CASCADE は除く)
create or replace function public.album_members_protect_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' and exists (select 1 from public.albums a where a.id = old.album_id) then
    raise exception 'owner_cannot_leave' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger album_members_protect_owner before delete on public.album_members
  for each row execute function public.album_members_protect_owner();

-- comments / reactions の album_id は写真から自動設定 (クライアント値を信用しない)
create or replace function public.set_album_id_from_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_album uuid;
begin
  select p.album_id into v_album from public.photos p where p.id = new.photo_id and p.status = 'ready';
  if v_album is null then
    raise exception 'photo_not_found' using errcode = 'P0002';
  end if;
  new.album_id := v_album;
  return new;
end;
$$;

create trigger comments_set_album before insert on public.comments
  for each row execute function public.set_album_id_from_photo();
create trigger reactions_set_album before insert on public.reactions
  for each row execute function public.set_album_id_from_photo();

-- コメント投稿のレート制限 (1 分 20 件)
create or replace function public.comments_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.check_rate_limit('comment', 20, interval '1 minute');
  return new;
end;
$$;

create trigger comments_rate_limit before insert on public.comments
  for each row execute function public.comments_rate_limit();

-- =============================================================================
-- RLS (Row Level Security)
-- =============================================================================
alter table public.plans             enable row level security;
alter table public.profiles          enable row level security;
alter table public.albums            enable row level security;
alter table public.album_members     enable row level security;
alter table public.invitations       enable row level security;
alter table public.join_requests     enable row level security;
alter table public.photos            enable row level security;
alter table public.comments          enable row level security;
alter table public.reactions         enable row level security;
alter table public.notifications     enable row level security;
alter table public.rate_limit_events enable row level security;
alter table public.usage_daily       enable row level security;

-- 未ログイン (anon) には一切のテーブル権限を与えない
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;

-- plans: ログインユーザーは閲覧のみ
grant select on public.plans to authenticated;
create policy plans_select on public.plans for select to authenticated using (true);

-- profiles
grant select on public.profiles to authenticated;
grant update (display_name, avatar_path) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (public.can_view_profile(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- albums
grant select, delete on public.albums to authenticated;
grant insert (title, description, owner_id) on public.albums to authenticated;
grant update (title, description, cover_photo_id) on public.albums to authenticated;
create policy albums_select on public.albums for select to authenticated
  using (public.is_album_member(id));
create policy albums_insert on public.albums for insert to authenticated
  with check (owner_id = auth.uid());
create policy albums_update on public.albums for update to authenticated
  using (public.is_album_owner(id)) with check (public.is_album_owner(id));
create policy albums_delete on public.albums for delete to authenticated
  using (public.is_album_owner(id));

-- album_members: 追加は関数経由のみ。削除は「自分の退会」か「オーナーによる除外」
grant select, delete on public.album_members to authenticated;
create policy album_members_select on public.album_members for select to authenticated
  using (public.is_album_member(album_id));
create policy album_members_delete on public.album_members for delete to authenticated
  using (role = 'member' and (user_id = auth.uid() or public.is_album_owner(album_id)));

-- invitations: オーナーのみ閲覧・削除 (作成・無効化は関数経由)
grant select, delete on public.invitations to authenticated;
create policy invitations_select on public.invitations for select to authenticated
  using (public.is_album_owner(album_id));
create policy invitations_delete on public.invitations for delete to authenticated
  using (public.is_album_owner(album_id));

-- join_requests: 本人とオーナーが閲覧 (作成・判定は関数経由)
grant select on public.join_requests to authenticated;
create policy join_requests_select on public.join_requests for select to authenticated
  using (user_id = auth.uid() or public.is_album_owner(album_id));

-- photos: メンバーは公開済みを閲覧。アップロード中は本人のみ。
--         作成・完了は関数経由。削除は投稿者本人かオーナー
grant select, delete on public.photos to authenticated;
create policy photos_select on public.photos for select to authenticated
  using (public.is_album_member(album_id) and (status = 'ready' or uploader_id = auth.uid()));
create policy photos_delete on public.photos for delete to authenticated
  using (public.is_album_member(album_id) and (uploader_id = auth.uid() or public.is_album_owner(album_id)));

-- comments
grant select, delete on public.comments to authenticated;
grant insert (photo_id, body, author_id) on public.comments to authenticated;
create policy comments_select on public.comments for select to authenticated
  using (public.is_album_member(album_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = auth.uid() and public.is_album_member(album_id));
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = auth.uid() or public.is_album_owner(album_id));

-- reactions
grant select, delete on public.reactions to authenticated;
grant insert (photo_id, user_id, emoji) on public.reactions to authenticated;
create policy reactions_select on public.reactions for select to authenticated
  using (public.is_album_member(album_id));
create policy reactions_insert on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and public.is_album_member(album_id));
create policy reactions_delete on public.reactions for delete to authenticated
  using (user_id = auth.uid());

-- notifications: 本人のみ。既読化と削除のみ可能
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (recipient_id = auth.uid());

-- usage_daily: 本人のみ閲覧
grant select on public.usage_daily to authenticated;
create policy usage_daily_select on public.usage_daily for select to authenticated
  using (user_id = auth.uid());

-- rate_limit_events: クライアントからは一切アクセス不可 (ポリシーなし)

-- ヘルパー関数の実行権限
grant execute on function public.is_album_member(uuid) to authenticated;
grant execute on function public.is_album_owner(uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.try_uuid(text) to authenticated;
