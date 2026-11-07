-- =============================================================================
-- RLS・業務ロジックの自動テスト
--   A = オーナー, B = 招待で参加するメンバー, C = 部外者, D = 承認制で参加申請する人
-- =============================================================================
\set ON_ERROR_STOP 1
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com', '{"display_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@example.com', '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'd@example.com', '{}');

create or replace function pg_temp.login(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',
    case p when 'A' then '00000000-0000-0000-0000-00000000000a'
           when 'B' then '00000000-0000-0000-0000-00000000000b'
           when 'C' then '00000000-0000-0000-0000-00000000000c'
           when 'D' then '00000000-0000-0000-0000-00000000000d' end, false);
end $$;

create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ASSERTION FAILED: %', msg; end if;
  raise notice 'ok - %', msg;
end $$;

grant execute on all functions in schema pg_temp to authenticated;
create table public.t (k text primary key, v text);
grant all on public.t to authenticated;

-- プロフィール自動作成
select pg_temp.assert((select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Alice', 'profile created with display_name');
select pg_temp.assert((select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'b', 'profile falls back to email prefix');

set role authenticated;

-- ---------------------------------------------------------------- アルバム作成
select pg_temp.login('A');
-- アプリと同じく作成した行を返してもらう (insert ... returning は SELECT ポリシーも満たす必要がある)
with created as (
  insert into public.albums (title, owner_id) values ('家族旅行', '00000000-0000-0000-0000-00000000000a') returning id
)
insert into public.t select 'album', id::text from created;
select pg_temp.assert((select member_count from public.albums) = 1, 'owner auto-added as member');
select pg_temp.assert((select role from public.album_members) = 'owner', 'owner role set');

-- 他人名義のアルバムは作れない
do $$ begin
  insert into public.albums (title, owner_id) values ('x', '00000000-0000-0000-0000-00000000000b');
  raise exception 'should fail';
exception when insufficient_privilege or others then
  if sqlerrm = 'should fail' then raise; end if;
end $$;
select pg_temp.assert(true, 'cannot create album for someone else');

-- ---------------------------------------------------------------- 部外者は見えない
select pg_temp.login('C');
select pg_temp.assert((select count(*) from public.albums) = 0, 'outsider cannot see album');
select pg_temp.assert((select count(*) from public.album_members) = 0, 'outsider cannot see members');
select pg_temp.assert((select count(*) from public.profiles) = 1, 'outsider sees only own profile');

-- 部外者は招待を作れない
do $$ begin
  perform public.create_invitation((select v::uuid from public.t where k = 'album'));
  raise exception 'should fail';
exception when others then
  if sqlerrm = 'should fail' then raise; end if;
end $$;
select pg_temp.assert(true, 'outsider cannot create invitation');

-- ---------------------------------------------------------------- 招待
select pg_temp.login('A');
insert into public.t select 'inv', (public.create_invitation((select v::uuid from public.t where k = 'album'))).token;
select pg_temp.assert((select count(*) from public.invitations) = 1, 'owner can create invitation');
select pg_temp.assert((select code ~ '^[A-HJ-NP-Z2-9]{8}$' from public.invitations), 'invite code format');
select pg_temp.assert((select length(token) >= 43 from public.invitations), 'invite token is 256-bit');

select pg_temp.login('B');
select pg_temp.assert((select count(*) from public.invitations) = 0, 'non-owner cannot list invitations');
select pg_temp.assert(
  (public.get_invitation_preview((select v from public.t where k = 'inv')) ->> 'state') = 'valid',
  'preview shows valid invitation');
select pg_temp.assert((select count(*) from public.albums) = 0, 'knowing the URL does not grant access');
select pg_temp.assert(
  (public.accept_invitation((select v from public.t where k = 'inv')) ->> 'status') = 'joined',
  'B joins via token');
select pg_temp.assert((select count(*) from public.albums) = 1, 'B now sees album');
select pg_temp.assert((select member_count from public.albums) = 2, 'member_count updated');
select pg_temp.assert(
  (public.accept_invitation((select v from public.t where k = 'inv')) ->> 'status') = 'already_member',
  'second accept is idempotent');

-- 総当たり対策: 存在しないコードを 10 回試すとロック
select pg_temp.login('C');
do $$
declare i int;
begin
  for i in 1..10 loop
    if (public.get_invitation_preview(null, 'ZZZZZZZZ') ->> 'state') <> 'not_found' then
      raise exception 'expected not_found';
    end if;
  end loop;
  begin
    perform public.get_invitation_preview(null, 'ZZZZZZZZ');
    raise exception 'should be rate limited';
  exception when others then
    if sqlerrm <> 'rate_limited' then raise; end if;
  end;
end $$;
select pg_temp.assert(true, 'invite code brute force is rate limited');

-- ---------------------------------------------------------------- 承認制招待
select pg_temp.login('A');
insert into public.t select 'inv2', (public.create_invitation((select v::uuid from public.t where k = 'album'), true, 24, 5)).code;
select pg_temp.login('D');
select pg_temp.assert(
  (public.accept_invitation(null, lower((select v from public.t where k = 'inv2'))) ->> 'status') = 'pending',
  'approval-required invite creates pending request (code is case-insensitive)');
select pg_temp.assert((select count(*) from public.albums) = 0, 'pending user cannot see album');
select pg_temp.login('A');
select pg_temp.assert((select count(*) from public.notifications where type = 'join_request') = 1, 'owner notified of join request');
select pg_temp.assert((select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000000d') = 1, 'owner can see requester profile');
select public.decide_join_request((select id from public.join_requests where status = 'pending'), true);
select pg_temp.login('D');
select pg_temp.assert((select count(*) from public.albums) = 1, 'approved user sees album');
select pg_temp.assert((select count(*) from public.notifications where type = 'join_approved') = 1, 'requester notified of approval');

-- 無効化した招待は使えない
select pg_temp.login('A');
select public.revoke_invitation((select id from public.invitations where code = (select v from public.t where k = 'inv2')));
reset role;
delete from public.rate_limit_events;
set role authenticated;
select pg_temp.login('C');
select pg_temp.assert(
  (public.get_invitation_preview(null, (select v from public.t where k = 'inv2')) ->> 'state') = 'revoked',
  'revoked invitation reported');

-- ---------------------------------------------------------------- 写真アップロード
select pg_temp.login('B');
insert into public.t select 'up', public.begin_photo_upload(
  (select v::uuid from public.t where k = 'album'), 'image', 'image/jpeg', 1000,
  'sha256:0123456789abcdef0123456789abcdef', 'IMG_0001.JPG', '2026-08-01T10:00:00Z', 4032, 3024)::text;
select pg_temp.assert((select count(*) from public.photos) = 1, 'uploader sees own uploading photo');

select pg_temp.login('A');
select pg_temp.assert((select count(*) from public.photos) = 0, 'others do not see uploading photo');

-- 部外者は Storage に書けない / 予約されていないパスにも書けない
select pg_temp.login('C');
do $$ begin
  insert into storage.objects (bucket_id, name, metadata)
  values ('photos', (select v::jsonb ->> 'storage_path' from public.t where k = 'up'), '{"size":1000}');
  raise exception 'should fail';
exception when others then
  if sqlerrm = 'should fail' then raise; end if;
end $$;
select pg_temp.assert(true, 'outsider cannot upload to reserved path');

select pg_temp.login('B');
do $$ begin
  insert into storage.objects (bucket_id, name, metadata)
  values ('photos', (select v from public.t where k = 'album') || '/' || gen_random_uuid() || '/original.jpg', '{"size":1}');
  raise exception 'should fail';
exception when others then
  if sqlerrm = 'should fail' then raise; end if;
end $$;
select pg_temp.assert(true, 'member cannot upload to unreserved path');

-- 未アップロードのまま完了はできない
do $$ begin
  perform public.complete_photo_upload((select (v::jsonb ->> 'id')::uuid from public.t where k = 'up'));
  raise exception 'should fail';
exception when others then
  if sqlerrm <> 'file_not_uploaded' then raise; end if;
end $$;
select pg_temp.assert(true, 'cannot complete without uploaded file');

insert into storage.objects (bucket_id, name, metadata) values
  ('photos', (select v::jsonb ->> 'storage_path' from public.t where k = 'up'), '{"size":1234,"mimetype":"image/jpeg"}'),
  ('photos', (select v::jsonb ->> 'thumb_path' from public.t where k = 'up'), '{"size":10,"mimetype":"image/jpeg"}');
select pg_temp.assert((public.complete_photo_upload((select (v::jsonb ->> 'id')::uuid from public.t where k = 'up'))).status = 'ready', 'complete upload');
select pg_temp.assert((select size_bytes from public.photos) = 1234, 'size recorded from storage');
select pg_temp.assert((select preview_path is null from public.photos), 'missing preview cleared');

-- 重複投稿は拒否
do $$ begin
  perform public.begin_photo_upload((select v::uuid from public.t where k = 'album'), 'image', 'image/jpeg', 1000,
    'sha256:0123456789abcdef0123456789abcdef');
  raise exception 'should fail';
exception when others then
  if sqlerrm <> 'duplicate' then raise; end if;
end $$;
select pg_temp.assert(true, 'duplicate upload rejected');

-- 形式・サイズ制限
do $$ begin
  perform public.begin_photo_upload((select v::uuid from public.t where k = 'album'), 'image', 'application/x-sh', 10, 'sha256:aaaaaaaaaaaaaaaaaaaa');
  raise exception 'should fail';
exception when others then
  if sqlerrm <> 'unsupported_type' then raise; end if;
end $$;
do $$ begin
  perform public.begin_photo_upload((select v::uuid from public.t where k = 'album'), 'video', 'video/mp4', 10737418240, 'sha256:bbbbbbbbbbbbbbbbbbbb');
  raise exception 'should fail';
exception when others then
  if sqlerrm <> 'file_too_large' then raise; end if;
end $$;
select pg_temp.assert(true, 'type and size limits enforced');

-- ---------------------------------------------------------------- 閲覧
select pg_temp.login('A');
select pg_temp.assert((select count(*) from public.photos) = 1, 'owner sees ready photo');
select pg_temp.assert((select photo_count from public.albums) = 1, 'photo_count updated');
select pg_temp.assert((select cover_photo_id is not null from public.albums), 'cover auto-set');
select pg_temp.assert((select count(*) from storage.objects) = 2, 'member can read storage objects');
select pg_temp.assert((select (data ->> 'count')::int from public.notifications where type = 'photo_added') = 1, 'photo notification');

select pg_temp.login('C');
select pg_temp.assert((select count(*) from public.photos) = 0, 'outsider cannot see photos');
select pg_temp.assert((select count(*) from storage.objects) = 0, 'outsider cannot read storage objects');

-- ---------------------------------------------------------------- コメント・リアクション
select pg_temp.login('A');
insert into public.comments (photo_id, body, author_id)
  select id, 'すてき！', '00000000-0000-0000-0000-00000000000a' from public.photos;
insert into public.reactions (photo_id, user_id, emoji)
  select id, '00000000-0000-0000-0000-00000000000a', '❤️' from public.photos;
select pg_temp.login('B');
select pg_temp.assert((select count(*) from public.comments) = 1, 'member sees comment');
select pg_temp.assert((select count(*) from public.reactions) = 1, 'member sees reaction');
select pg_temp.assert((select count(*) from public.notifications where type in ('comment', 'reaction')) = 2, 'uploader notified of comment and reaction');

select pg_temp.login('C');
do $$ begin
  insert into public.comments (photo_id, body, author_id)
    values ((select id from public.photos limit 1), 'spam', '00000000-0000-0000-0000-00000000000c');
  raise exception 'should fail';
exception when others then
  if sqlerrm = 'should fail' then raise; end if;
end $$;
select pg_temp.assert(true, 'outsider cannot comment');

-- ---------------------------------------------------------------- 保存済みの記録
select pg_temp.login('B');
select pg_temp.assert(public.mark_photos_downloaded(array(select id from public.photos)) = 1, 'member can mark photo as downloaded');
select pg_temp.assert(public.mark_photos_downloaded(array(select id from public.photos)) = 1, 'marking again updates instead of duplicating');
select pg_temp.assert((select count(*) from public.photo_downloads) = 1, 'member sees own download record');
select pg_temp.login('A');
select pg_temp.assert((select count(*) from public.photo_downloads) = 0, 'others cannot see download records');
select pg_temp.login('C');
select pg_temp.assert(
  public.mark_photos_downloaded(array(select (v::jsonb ->> 'id')::uuid from public.t where k = 'up')) = 0,
  'outsider cannot mark photos of other albums');
do $$ begin
  insert into public.photo_downloads (user_id, photo_id, album_id)
  select '00000000-0000-0000-0000-00000000000c', (v::jsonb ->> 'id')::uuid, (select v::uuid from public.t where k = 'album') from public.t where k = 'up';
  raise exception 'should fail';
exception when insufficient_privilege then null;
end $$;
select pg_temp.assert(true, 'download records cannot be inserted directly');

-- B は A のコメントを削除できない (RLS により 0 件)
select pg_temp.login('B');
delete from public.comments;
select pg_temp.assert((select count(*) from public.comments) = 1, 'member cannot delete others comments');

-- ---------------------------------------------------------------- 権限
-- メンバーはアルバムを編集・削除できない
update public.albums set title = 'hacked';
delete from public.albums;
select pg_temp.assert((select title from public.albums) = '家族旅行', 'member cannot edit or delete album');
-- メンバーは他人を除外できない
delete from public.album_members where user_id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.assert((select count(*) from public.album_members) = 3, 'member cannot remove others');
-- 集計値は直接更新できない
do $$ begin
  update public.albums set photo_count = 999;
  raise exception 'should fail';
exception when insufficient_privilege then null;
end $$;
select pg_temp.assert(true, 'counters are not client-writable');

-- オーナーは除外できる、オーナー自身は退会できない
select pg_temp.login('A');
delete from public.album_members where user_id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.assert((select member_count from public.albums) = 2, 'owner removed D');
delete from public.album_members where user_id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.assert((select member_count from public.albums) = 2, 'owner cannot leave (RLS)');
reset role;
do $$ begin
  delete from public.album_members where user_id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'should fail';
exception when others then
  if sqlerrm <> 'owner_cannot_leave' then raise; end if;
end $$;
select pg_temp.assert(true, 'owner row protected even for admin');
set role authenticated;

select pg_temp.login('D');
select pg_temp.assert((select count(*) from public.photos) = 0, 'removed member loses access');

-- B は退会できる
select pg_temp.login('B');
delete from public.album_members where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.assert((select count(*) from public.albums) = 0, 'B left album');

-- A からは退会した B の名前が引き続き見える (投稿者表示のため)
select pg_temp.login('A');
select pg_temp.assert((select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 1, 'former uploader profile still visible');

-- ---------------------------------------------------------------- アルバム削除
delete from public.albums;
select pg_temp.assert((select count(*) from public.albums) = 0, 'owner deleted album');

reset role;
select pg_temp.assert((select count(*) from public.photos) = 0, 'photos cascaded');
select pg_temp.assert((select count(*) from public.album_members) = 0, 'members cascaded');

-- ---------------------------------------------------------------- アカウント削除
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.assert((select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 0, 'profile cascaded on account deletion');

set role authenticated;
select pg_temp.login('A');
insert into public.albums (title, owner_id) values ('残るアルバム', '00000000-0000-0000-0000-00000000000a');
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.assert((select count(*) from public.albums) = 0, 'owned albums deleted with account');

drop table public.t;
