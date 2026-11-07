-- =============================================================================
-- アルバム単位の「メンバー全員に許可」設定
-- =============================================================================
--   members_can_invite       : メンバー全員が招待リンクを作れる (既定オン)
--                              オフのときは、メンバーごとの can_invite が有効
--   members_can_change_cover : メンバー全員がカバー画像を変更できる (既定オン)
-- 既存のアルバムも既定値 (オン) になる。設定を変えられるのはオーナーだけ。

alter table public.albums
  add column if not exists members_can_invite boolean not null default true,
  add column if not exists members_can_change_cover boolean not null default true;

-- 設定の変更はオーナーのみ (albums の UPDATE ポリシーはオーナー限定)
grant update (members_can_invite, members_can_change_cover) on public.albums to authenticated;

-- 招待できるか: オーナー / アルバム全体で許可 / メンバー個別に許可
create or replace function public.can_invite(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.album_members m
    join public.albums a on a.id = m.album_id
    where m.album_id = p_album_id and m.user_id = auth.uid()
      and (m.role = 'owner' or a.members_can_invite or m.can_invite)
  );
$$;

-- カバー画像を変更できるか: オーナー / アルバム全体で許可
create or replace function public.can_change_cover(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.album_members m
    join public.albums a on a.id = m.album_id
    where m.album_id = p_album_id and m.user_id = auth.uid()
      and (m.role = 'owner' or a.members_can_change_cover)
  );
$$;

-- カバー画像の変更 (メンバーにも許可するため、UPDATE ポリシーではなく関数で行う)
--   写真が同じアルバムの公開済みの写真かどうかは albums_validate_cover トリガーで確認
create or replace function public.set_album_cover(p_album_id uuid, p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_change_cover(p_album_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.albums set cover_photo_id = p_photo_id where id = p_album_id;
end;
$$;

-- メンバー個別の権限を外したとき、アルバム全体で許可されていなければ、その人の招待を無効化
create or replace function public.set_member_can_invite(p_album_id uuid, p_user_id uuid, p_can_invite boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.album_members;
  v_album public.albums;
begin
  if not public.is_album_owner(p_album_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_member from public.album_members where album_id = p_album_id and user_id = p_user_id for update;
  if v_member.user_id is null or v_member.role <> 'member' then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;
  if v_member.can_invite = coalesce(p_can_invite, false) then
    return;
  end if;
  select * into v_album from public.albums where id = p_album_id;

  update public.album_members set can_invite = coalesce(p_can_invite, false)
  where album_id = p_album_id and user_id = p_user_id;

  if p_can_invite then
    insert into public.notifications (recipient_id, actor_id, album_id, type, data)
    values (p_user_id, auth.uid(), p_album_id, 'invite_permission_granted', jsonb_build_object('album_title', v_album.title));
  elsif not v_album.members_can_invite then
    update public.invitations set revoked_at = now()
    where album_id = p_album_id and created_by = p_user_id and revoked_at is null;
  end if;
end;
$$;

-- アルバム全体の招待許可をオフにしたら、個別の権限がないメンバーが作った招待を無効化
create or replace function public.albums_on_invite_setting_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.members_can_invite and not new.members_can_invite then
    update public.invitations i set revoked_at = now()
    from public.album_members m
    where i.album_id = new.id and i.revoked_at is null
      and m.album_id = i.album_id and m.user_id = i.created_by
      and m.role = 'member' and not m.can_invite;
  end if;
  return null;
end;
$$;

drop trigger if exists albums_invite_setting_change on public.albums;
create trigger albums_invite_setting_change after update of members_can_invite on public.albums
  for each row execute function public.albums_on_invite_setting_change();

-- 実行権限
revoke execute on function public.can_invite(uuid), public.can_change_cover(uuid), public.set_album_cover(uuid, uuid),
  public.set_member_can_invite(uuid, uuid, boolean), public.albums_on_invite_setting_change() from anon, authenticated, public;
grant execute on function public.can_invite(uuid) to authenticated;
grant execute on function public.can_change_cover(uuid) to authenticated;
grant execute on function public.set_album_cover(uuid, uuid) to authenticated;
grant execute on function public.set_member_can_invite(uuid, uuid, boolean) to authenticated;
