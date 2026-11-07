-- =============================================================================
-- 写真の「見た目の指紋」(phash)
-- =============================================================================
-- 端末にある写真と、アルバムの写真が同じかどうかを判定するための値。
-- 画像を 9x8 の白黒に縮小し、隣り合う明るさの大小を 64 ビットにしたもの (dHash) を 16 進 16 文字で保存する。
-- ファイル形式の変換 (HEIC → JPEG) や再圧縮があってもほぼ同じ値になるため、
-- 「一度保存してから端末で削除した写真」を正しく未保存と判定できる。

alter table public.photos
  add column if not exists phash text check (phash is null or phash ~ '^[0-9a-f]{16}$');

-- complete_photo_upload に phash を受け取る引数を追加 (古いアプリからの呼び出しも引き続き動く)
drop function if exists public.complete_photo_upload(uuid, boolean);

create or replace function public.complete_photo_upload(
  p_photo_id uuid,
  p_has_thumb boolean default true,
  p_phash text default null
)
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
        thumb_path = v_photo.thumb_path, preview_path = v_photo.preview_path,
        -- 形式が正しいときだけ保存 (不正な値は無視)
        phash = case when p_phash ~ '^[0-9a-f]{16}$' then p_phash end
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

revoke execute on function public.complete_photo_upload(uuid, boolean, text) from anon, authenticated, public;
grant execute on function public.complete_photo_upload(uuid, boolean, text) to authenticated;
