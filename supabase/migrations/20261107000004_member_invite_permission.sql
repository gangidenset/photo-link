-- =============================================================================
-- メンバーへの「招待してよい」権限の付与
-- =============================================================================
-- オーナーは、メンバーごとに招待リンク・招待コードを作る権限を付与できる。
--   ・権限のあるメンバー: 招待の作成、自分が作った招待の閲覧・無効化
--   ・メンバーの除外や参加リクエストの承認・拒否は、引き続きオーナーのみ
--   ・権限を外したとき / 退会・除外されたときは、その人が作った招待を自動で無効化

alter table public.album_members
  add column if not exists can_invite boolean not null default false;

-- 招待できるか (オーナー、または権限のあるメンバー)
create or replace function public.can_invite(p_album_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.album_members m
    where m.album_id = p_album_id and m.user_id = auth.uid()
      and (m.role = 'owner' or m.can_invite)
  );
$$;

-- 招待の作成: オーナー限定 → 権限のあるメンバーも可
create or replace function public.create_invitation(
  p_album_id uuid,
  p_requires_approval boolean default false,
  p_expires_in_hours integer default 168,
  p_max_uses integer default null
)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_try integer := 0;
begin
  -- オーナー、または招待の権限を付与されたメンバー
  if not public.can_invite(p_album_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_expires_in_hours is null or p_expires_in_hours < 1 or p_expires_in_hours > 24 * 30 then
    raise exception 'invalid_expiry' using errcode = '22023';
  end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 1000) then
    raise exception 'invalid_max_uses' using errcode = '22023';
  end if;
  perform public.check_rate_limit('create_invitation', 30, interval '1 hour');

  loop
    begin
      insert into public.invitations (album_id, created_by, token, code, requires_approval, expires_at, max_uses)
      values (
        p_album_id, auth.uid(), public.generate_invite_token(), public.generate_invite_code(),
        coalesce(p_requires_approval, false), now() + make_interval(hours => p_expires_in_hours), p_max_uses
      )
      returning * into v_inv;
      return v_inv;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 5 then raise; end if;
    end;
  end loop;
end;
$$;

-- 招待の無効化: オーナーは全部、メンバーは自分が作った招待だけ
create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations where id = p_invitation_id;
  if v_inv.id is null
     or not (public.is_album_owner(v_inv.album_id)
             or (v_inv.created_by = auth.uid() and public.is_album_member(v_inv.album_id))) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now() where id = p_invitation_id and revoked_at is null;
end;
$$;

-- 招待の閲覧・削除: オーナーは全部、メンバーは自分が作ったものだけ
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations for select to authenticated
  using (public.is_album_owner(album_id) or (created_by = auth.uid() and public.is_album_member(album_id)));
drop policy if exists invitations_delete on public.invitations;
create policy invitations_delete on public.invitations for delete to authenticated
  using (public.is_album_owner(album_id) or (created_by = auth.uid() and public.is_album_member(album_id)));

-- 通知の種類に「招待の権限を付与された」を追加
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'photo_added', 'member_joined', 'comment', 'reaction',
  'join_request', 'join_approved', 'join_rejected', 'invite_permission_granted'));

-- 権限の付与・取り消し (オーナーのみ)
create or replace function public.set_member_can_invite(p_album_id uuid, p_user_id uuid, p_can_invite boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.album_members;
  v_title text;
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

  update public.album_members set can_invite = coalesce(p_can_invite, false)
  where album_id = p_album_id and user_id = p_user_id;

  if p_can_invite then
    select title into v_title from public.albums where id = p_album_id;
    insert into public.notifications (recipient_id, actor_id, album_id, type, data)
    values (p_user_id, auth.uid(), p_album_id, 'invite_permission_granted', jsonb_build_object('album_title', v_title));
  else
    -- 権限を外したら、その人が作った有効な招待を無効化
    update public.invitations set revoked_at = now()
    where album_id = p_album_id and created_by = p_user_id and revoked_at is null;
  end if;
end;
$$;

-- 退会・除外されたら、その人が作った有効な招待を無効化
create or replace function public.revoke_invitations_of_departed_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invitations set revoked_at = now()
  where album_id = old.album_id and created_by = old.user_id and revoked_at is null;
  return null;
end;
$$;

drop trigger if exists album_members_revoke_invitations on public.album_members;
create trigger album_members_revoke_invitations after delete on public.album_members
  for each row execute function public.revoke_invitations_of_departed_member();

-- 実行権限
revoke execute on function public.can_invite(uuid), public.set_member_can_invite(uuid, uuid, boolean),
  public.revoke_invitations_of_departed_member(), public.create_invitation(uuid, boolean, integer, integer),
  public.revoke_invitation(uuid) from anon, authenticated, public;
grant execute on function public.can_invite(uuid) to authenticated;
grant execute on function public.set_member_can_invite(uuid, uuid, boolean) to authenticated;
grant execute on function public.create_invitation(uuid, boolean, integer, integer) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
