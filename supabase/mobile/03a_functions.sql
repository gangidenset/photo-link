-- スマホ用の分割版 (3a): supabase/migrations/20261106000003_functions.sql の 1 行目〜。
-- 3a → 3b → 3c の順に 1 つずつ実行してください。内容は元のファイルと同じです。

-- =============================================================================
-- PhotoLink: 業務ロジック関数 (RPC)
-- =============================================================================
-- すべて SECURITY DEFINER + 関数内で auth.uid() による認可を行う。
-- クライアントからは supabase.rpc('関数名', {...}) で呼び出す。

-- -----------------------------------------------------------------------------
-- 招待コード生成 (紛らわしい 0/O/1/I を除いた 32 文字 × 8 桁)
-- -----------------------------------------------------------------------------
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
  i integer;
begin
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;

create or replace function public.generate_invite_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
$$;

-- -----------------------------------------------------------------------------
-- 招待の作成 (オーナーのみ)
-- -----------------------------------------------------------------------------
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
  if not public.is_album_owner(p_album_id) then
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

create or replace function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_album uuid;
begin
  select album_id into v_album from public.invitations where id = p_invitation_id;
  if v_album is null or not public.is_album_owner(v_album) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now() where id = p_invitation_id and revoked_at is null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 招待の検索 (内部用): トークンまたはコードから有効な招待を探す
--   見つからない場合は失敗回数を記録して id が null の行を返す。1 時間 10 回失敗で拒否 (総当たり対策)
-- -----------------------------------------------------------------------------
create or replace function public.find_valid_invitation(p_token text, p_code text)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_fail integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select count(*) into v_fail from public.rate_limit_events
  where user_id = auth.uid() and action = 'invite_lookup_failed' and created_at > now() - interval '1 hour';
  if v_fail >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'invite_lookup_failed';
  end if;

  if p_token is not null and length(p_token) >= 32 then
    select * into v_inv from public.invitations where token = p_token;
  elsif p_code is not null then
    select * into v_inv from public.invitations
    where code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'));
  end if;

  if v_inv.id is null then
    -- 例外を投げるとこの記録も巻き戻るため、null を返して呼び出し側で not_found を返す
    insert into public.rate_limit_events (user_id, action) values (auth.uid(), 'invite_lookup_failed');
  end if;
  return v_inv;
end;
$$;

-- -----------------------------------------------------------------------------
-- 招待のプレビュー: 参加前に見せてよい情報 (アルバム名・人数・オーナー名) のみ返す
-- -----------------------------------------------------------------------------
create or replace function public.get_invitation_preview(p_token text default null, p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_album public.albums;
  v_owner_name text;
  v_state text;
begin
  v_inv := public.find_valid_invitation(p_token, p_code);
  if v_inv.id is null then
    return jsonb_build_object('state', 'not_found');
  end if;
  select * into v_album from public.albums where id = v_inv.album_id;
  select display_name into v_owner_name from public.profiles where id = v_album.owner_id;

  if exists (select 1 from public.album_members where album_id = v_album.id and user_id = auth.uid()) then
    v_state := 'already_member';
  elsif exists (select 1 from public.join_requests where album_id = v_album.id and user_id = auth.uid() and status = 'pending') then
    v_state := 'pending';
  elsif v_inv.revoked_at is not null then
    v_state := 'revoked';
  elsif v_inv.expires_at <= now() then
    v_state := 'expired';
  elsif v_inv.max_uses is not null and v_inv.use_count >= v_inv.max_uses then
    v_state := 'used_up';
  else
    v_state := 'valid';
  end if;

  return jsonb_build_object(
    'album_id', v_album.id,
    'album_title', v_album.title,
    'member_count', v_album.member_count,
    'photo_count', v_album.photo_count,
    'owner_name', v_owner_name,
    'requires_approval', v_inv.requires_approval,
    'expires_at', v_inv.expires_at,
    'state', v_state
  );
end;
$$;

