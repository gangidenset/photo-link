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

-- -----------------------------------------------------------------------------
-- 招待を受けて参加 (承認制なら参加リクエストを作成)
--   戻り値 status: joined / pending / already_member / not_found
-- -----------------------------------------------------------------------------
create or replace function public.accept_invitation(p_token text default null, p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  v_inv := public.find_valid_invitation(p_token, p_code);
  if v_inv.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- 同時参加で use_count がずれないよう行ロック
  select * into v_inv from public.invitations where id = v_inv.id for update;

  if exists (select 1 from public.album_members where album_id = v_inv.album_id and user_id = auth.uid()) then
    return jsonb_build_object('status', 'already_member', 'album_id', v_inv.album_id);
  end if;
  if exists (select 1 from public.join_requests where album_id = v_inv.album_id and user_id = auth.uid() and status = 'pending') then
    return jsonb_build_object('status', 'pending', 'album_id', v_inv.album_id);
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'invitation_revoked' using errcode = 'P0001';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invitation_expired' using errcode = 'P0001';
  end if;
  if v_inv.max_uses is not null and v_inv.use_count >= v_inv.max_uses then
    raise exception 'invitation_used_up' using errcode = 'P0001';
  end if;

  perform public.check_rate_limit('accept_invitation', 20, interval '1 hour');
  update public.invitations set use_count = use_count + 1 where id = v_inv.id;

  if v_inv.requires_approval then
    insert into public.join_requests (album_id, invitation_id, user_id)
    values (v_inv.album_id, v_inv.id, auth.uid());
    return jsonb_build_object('status', 'pending', 'album_id', v_inv.album_id);
  end if;

  insert into public.album_members (album_id, user_id, role) values (v_inv.album_id, auth.uid(), 'member');
  return jsonb_build_object('status', 'joined', 'album_id', v_inv.album_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 参加リクエストの承認・拒否 (オーナーのみ)
-- -----------------------------------------------------------------------------
create or replace function public.decide_join_request(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.join_requests;
begin
  select * into v_req from public.join_requests where id = p_request_id for update;
  if v_req.id is null or not public.is_album_owner(v_req.album_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'already_decided' using errcode = 'P0001';
  end if;

  update public.join_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        decided_by = auth.uid(), decided_at = now()
    where id = p_request_id;

  if p_approve then
    insert into public.album_members (album_id, user_id, role)
    values (v_req.album_id, v_req.user_id, 'member')
    on conflict do nothing;
  end if;

  insert into public.notifications (recipient_id, actor_id, album_id, type)
  values (v_req.user_id, auth.uid(), v_req.album_id,
          case when p_approve then 'join_approved' else 'join_rejected' end);
end;
$$;

-- -----------------------------------------------------------------------------
-- 自分の利用状況 (プラン・使用容量)
-- -----------------------------------------------------------------------------
create or replace function public.get_my_usage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'plan', to_jsonb(pl.*),
    'storage_bytes', coalesce((select sum(p.size_bytes) from public.photos p where p.uploader_id = auth.uid()), 0),
    'photo_count', (select count(*) from public.photos p where p.uploader_id = auth.uid() and p.status = 'ready'),
    'album_count', (select count(*) from public.albums a where a.owner_id = auth.uid())
  )
  from public.profiles pr
  join public.plans pl on pl.id = pr.plan_id
  where pr.id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- 写真アップロード開始
--   容量・形式・サイズ・重複・レート制限をサーバー側で確認し、photo 行 (uploading) を作る。
--   Storage へのアップロードはこの行のパスに対してのみ許可される (Storage ポリシー参照)。
--   以前に同じファイルのアップロードが途中で止まっていれば、その行を再利用する (再試行)。
-- -----------------------------------------------------------------------------
create or replace function public.begin_photo_upload(
  p_album_id uuid,
  p_media_type text,
  p_mime_type text,
  p_size_bytes bigint,
  p_content_hash text,
  p_original_filename text default '',
  p_taken_at timestamptz default null,
  p_width integer default null,
  p_height integer default null,
  p_duration_sec numeric default null,
  p_has_thumb boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.plans;
  v_used bigint;
  v_existing public.photos;
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_base text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_album_member(p_album_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 重複チェック
  select * into v_existing from public.photos where album_id = p_album_id and content_hash = p_content_hash;
  if v_existing.id is not null then
    if v_existing.status = 'uploading' and v_existing.uploader_id = v_uid then
      return jsonb_build_object(
        'id', v_existing.id, 'storage_path', v_existing.storage_path,
        'thumb_path', v_existing.thumb_path, 'preview_path', v_existing.preview_path, 'resumed', true);
    end if;
    raise exception 'duplicate' using errcode = 'P0001', hint = v_existing.id::text;
  end if;

  perform public.check_rate_limit('begin_upload', 600, interval '10 minutes');

  select pl.* into v_plan from public.profiles pr join public.plans pl on pl.id = pr.plan_id where pr.id = v_uid;

  v_ext := case p_mime_type
    when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'image/gif' then 'gif' when 'image/heic' then 'heic' when 'image/heif' then 'heif'
    when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm'
    else null end;
  if v_ext is null or (p_media_type = 'image' and p_mime_type not like 'image/%')
     or (p_media_type = 'video' and p_mime_type not like 'video/%') then
    raise exception 'unsupported_type' using errcode = '22023';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'invalid_size' using errcode = '22023';
  end if;
  if p_media_type = 'image' and p_size_bytes > v_plan.max_image_bytes then
    raise exception 'file_too_large' using errcode = 'P0001', hint = v_plan.max_image_bytes::text;
  end if;
  if p_media_type = 'video' then
    if p_size_bytes > v_plan.max_video_bytes then
      raise exception 'file_too_large' using errcode = 'P0001', hint = v_plan.max_video_bytes::text;
    end if;
    if p_duration_sec is not null and p_duration_sec > v_plan.max_video_duration_sec then
      raise exception 'video_too_long' using errcode = 'P0001', hint = v_plan.max_video_duration_sec::text;
    end if;
  end if;

  select coalesce(sum(size_bytes), 0) into v_used from public.photos where uploader_id = v_uid;
  if v_used + p_size_bytes > v_plan.max_storage_bytes then
    raise exception 'storage_quota_exceeded' using errcode = 'P0001', hint = v_plan.max_storage_bytes::text;
  end if;

  v_base := p_album_id::text || '/' || v_id::text || '/';
  insert into public.photos (
    id, album_id, uploader_id, media_type, status, storage_path, thumb_path, preview_path,
    mime_type, size_bytes, width, height, duration_sec, original_filename, content_hash, taken_at
  ) values (
    v_id, p_album_id, v_uid, p_media_type, 'uploading',
    v_base || 'original.' || v_ext,
    case when p_has_thumb then v_base || 'thumb.jpg' end,
    case when p_has_thumb and p_media_type = 'image' then v_base || 'preview.jpg' end,
    p_mime_type, p_size_bytes, p_width, p_height, p_duration_sec,
    left(coalesce(p_original_filename, ''), 255), p_content_hash,
    -- 未来日時や極端に古い撮影日時は信用しない
    case when p_taken_at between '1900-01-01'::timestamptz and now() + interval '1 day' then p_taken_at end
  );

  return jsonb_build_object(
    'id', v_id, 'storage_path', v_base || 'original.' || v_ext,
    'thumb_path', case when p_has_thumb then v_base || 'thumb.jpg' end,
    'preview_path', case when p_has_thumb and p_media_type = 'image' then v_base || 'preview.jpg' end,
    'resumed', false);
exception
  when unique_violation then
    -- 同時に同じファイルを投稿した場合
    raise exception 'duplicate' using errcode = 'P0001';
end;
$$;

-- -----------------------------------------------------------------------------
-- 写真アップロード完了
--   Storage に本当にファイルがあるかを確認し、実ファイルサイズで記録してから公開する。
-- -----------------------------------------------------------------------------
create or replace function public.complete_photo_upload(p_photo_id uuid, p_has_thumb boolean default true)
returns public.photos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_photo public.photos;
  v_size bigint;
  v_mime text;
begin
  select * into v_photo from public.photos where id = p_photo_id for update;
  if v_photo.id is null or v_photo.uploader_id is distinct from auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_photo.status = 'ready' then
    return v_photo;
  end if;

  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
    into v_size, v_mime
  from storage.objects o
  where o.bucket_id = 'photos' and o.name = v_photo.storage_path;

  if v_size is null then
    raise exception 'file_not_uploaded' using errcode = 'P0002';
  end if;
  if v_mime is not null and v_mime <> v_photo.mime_type then
    raise exception 'mime_mismatch' using errcode = '22023';
  end if;

  -- サムネイル生成に失敗した場合はパスを消す (一覧ではアイコン表示)
  if not coalesce(p_has_thumb, true) or not exists (
    select 1 from storage.objects o where o.bucket_id = 'photos' and o.name = v_photo.thumb_path
  ) then
    v_photo.thumb_path := null;
  end if;
  if v_photo.preview_path is not null and not exists (
    select 1 from storage.objects o where o.bucket_id = 'photos' and o.name = v_photo.preview_path
  ) then
    v_photo.preview_path := null;
  end if;

  update public.photos
    set status = 'ready', size_bytes = v_size,
        thumb_path = v_photo.thumb_path, preview_path = v_photo.preview_path
    where id = p_photo_id
    returning * into v_photo;

  insert into public.usage_daily (user_id, day, uploaded_bytes, uploaded_files)
  values (auth.uid(), current_date, v_size, 1)
  on conflict (user_id, day) do update
    set uploaded_bytes = public.usage_daily.uploaded_bytes + excluded.uploaded_bytes,
        uploaded_files = public.usage_daily.uploaded_files + 1;

  -- カバー未設定なら最初の写真をカバーにする
  if v_photo.media_type = 'image' and v_photo.thumb_path is not null then
    update public.albums set cover_photo_id = v_photo.id where id = v_photo.album_id and cover_photo_id is null;
  end if;

  return v_photo;
end;
$$;

-- -----------------------------------------------------------------------------
-- 途中で止まったアップロード行の掃除 (24 時間以上 uploading のもの)
--   pg_cron で定期実行可能: select cron.schedule('cleanup-uploads', '0 * * * *', 'select public.cleanup_stale_uploads()');
--   Storage 上に残ったファイルは返り値のパスを使って削除する (docs/OPERATIONS.md)。
-- -----------------------------------------------------------------------------
create or replace function public.cleanup_stale_uploads()
returns setof text
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.photos
    where status = 'uploading' and created_at < now() - interval '24 hours'
    returning storage_path, thumb_path, preview_path
  )
  select p from deleted, unnest(array[storage_path, thumb_path, preview_path]) as p where p is not null;
$$;

-- 古いレート制限ログの掃除
create or replace function public.cleanup_rate_limit_events()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.rate_limit_events where created_at < now() - interval '2 days';
$$;

-- -----------------------------------------------------------------------------
-- 運用者向け: ユーザー別のストレージ使用量 (コスト把握)
--   service_role / ダッシュボードの SQL エディタからのみ参照する
-- -----------------------------------------------------------------------------
create or replace view public.storage_usage_by_user
with (security_invoker = true)
as
  select pr.id as user_id, pr.display_name, pr.plan_id,
         count(p.id) filter (where p.status = 'ready') as file_count,
         coalesce(sum(p.size_bytes) filter (where p.media_type = 'image'), 0) as image_bytes,
         coalesce(sum(p.size_bytes) filter (where p.media_type = 'video'), 0) as video_bytes,
         coalesce(sum(p.size_bytes), 0) as total_bytes
  from public.profiles pr
  left join public.photos p on p.uploader_id = pr.id
  group by pr.id;

revoke all on public.storage_usage_by_user from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 実行権限: ログインユーザーが呼べる RPC だけを明示的に許可
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from anon, authenticated, public;

grant execute on function public.create_invitation(uuid, boolean, integer, integer) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.get_invitation_preview(text, text) to authenticated;
grant execute on function public.accept_invitation(text, text) to authenticated;
grant execute on function public.decide_join_request(uuid, boolean) to authenticated;
grant execute on function public.get_my_usage() to authenticated;
grant execute on function public.begin_photo_upload(uuid, text, text, bigint, text, text, timestamptz, integer, integer, numeric, boolean) to authenticated;
grant execute on function public.complete_photo_upload(uuid, boolean) to authenticated;
grant execute on function public.is_album_member(uuid) to authenticated;
grant execute on function public.is_album_owner(uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.try_uuid(text) to authenticated;
