-- =============================================================================
-- PhotoLink: Storage (非公開バケット + アクセスポリシー)
-- =============================================================================
-- photos バケットのパス:  {album_id}/{photo_id}/original.{ext} | thumb.jpg | preview.jpg
-- avatars バケットのパス: {user_id}/{ファイル名}.jpg
-- どちらも public = false。閲覧は署名付き URL (期限付き) のみ。

-- ファイルサイズ上限はプロジェクト全体の設定 (Free プランは 50MB) と
-- begin_photo_upload() のプラン別上限で管理するため、バケットでは null (= 全体設定に従う)。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('photos', 'photos', false, null, array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm']),
  ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- photos バケット
-- -----------------------------------------------------------------------------
-- 閲覧: アルバムのメンバーのみ
create policy "photos: members can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and public.is_album_member(public.try_uuid((storage.foldername(name))[1]))
  );

-- アップロード: begin_photo_upload() で作られた「自分の uploading 行」のパスにだけ書き込める
create policy "photos: uploader can insert reserved paths"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos'
    and exists (
      select 1 from public.photos p
      where p.id = public.try_uuid((storage.foldername(name))[2])
        and p.album_id = public.try_uuid((storage.foldername(name))[1])
        and p.uploader_id = auth.uid()
        and p.status = 'uploading'
        and name in (p.storage_path, p.thumb_path, p.preview_path)
    )
  );

-- 再試行時の上書き (TUS の再開など) も同じ条件
create policy "photos: uploader can update reserved paths"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'photos'
    and exists (
      select 1 from public.photos p
      where p.id = public.try_uuid((storage.foldername(name))[2])
        and p.uploader_id = auth.uid()
        and p.status = 'uploading'
        and name in (p.storage_path, p.thumb_path, p.preview_path)
    )
  );

-- 削除: 投稿者本人、またはアルバムのオーナー
create policy "photos: uploader or owner can delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'photos'
    and (
      public.is_album_owner(public.try_uuid((storage.foldername(name))[1]))
      or exists (
        select 1 from public.photos p
        where p.id = public.try_uuid((storage.foldername(name))[2])
          and p.uploader_id = auth.uid()
      )
    )
  );

-- -----------------------------------------------------------------------------
-- avatars バケット
-- -----------------------------------------------------------------------------
create policy "avatars: visible to people who can view the profile"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and public.can_view_profile(public.try_uuid((storage.foldername(name))[1]))
  );

create policy "avatars: owner can insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: owner can update"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: owner can delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
