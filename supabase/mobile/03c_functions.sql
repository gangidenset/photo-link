-- スマホ用の分割版 (3c): supabase/migrations/20261106000003_functions.sql の 410 行目〜。
-- 3a → 3b → 3c の順に 1 つずつ実行してください。内容は元のファイルと同じです。

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
