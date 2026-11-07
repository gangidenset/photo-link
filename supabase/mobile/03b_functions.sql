-- スマホ用の分割版 (3b): supabase/migrations/20261106000003_functions.sql の 189 行目〜。
-- 3a → 3b → 3c の順に 1 つずつ実行してください。内容は元のファイルと同じです。

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

