-- =============================================================================
-- PhotoLink: 通知の自動作成 (トリガー)
-- =============================================================================
-- クライアントは通知を作成できない (INSERT 権限なし)。DB のイベントから自動生成する。

-- 新しい写真: 同じ投稿者・同じアルバムの未読通知が 1 時間以内にあれば件数をまとめる
create or replace function public.notify_photo_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  r record;
  v_existing uuid;
begin
  if not (tg_op = 'UPDATE' and old.status = 'uploading' and new.status = 'ready') then
    return null;
  end if;
  select title into v_title from public.albums where id = new.album_id;

  for r in
    select m.user_id from public.album_members m
    where m.album_id = new.album_id and m.user_id <> new.uploader_id
  loop
    select n.id into v_existing from public.notifications n
    where n.recipient_id = r.user_id and n.actor_id = new.uploader_id and n.album_id = new.album_id
      and n.type = 'photo_added' and n.read_at is null and n.created_at > now() - interval '1 hour'
    order by n.created_at desc
    limit 1;

    if v_existing is not null then
      update public.notifications
        set data = jsonb_set(data, '{count}', to_jsonb(coalesce((data ->> 'count')::integer, 1) + 1)),
            photo_id = new.id
        where id = v_existing;
    else
      insert into public.notifications (recipient_id, actor_id, album_id, photo_id, type, data)
      values (r.user_id, new.uploader_id, new.album_id, new.id, 'photo_added',
              jsonb_build_object('count', 1, 'album_title', v_title));
    end if;
  end loop;
  return null;
end;
$$;

create trigger photos_notify after update of status on public.photos
  for each row execute function public.notify_photo_added();

-- 新しいメンバー
create or replace function public.notify_member_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
begin
  if new.role <> 'member' then
    return null;
  end if;
  select title into v_title from public.albums where id = new.album_id;
  insert into public.notifications (recipient_id, actor_id, album_id, type, data)
  select m.user_id, new.user_id, new.album_id, 'member_joined', jsonb_build_object('album_title', v_title)
  from public.album_members m
  where m.album_id = new.album_id and m.user_id <> new.user_id;
  return null;
end;
$$;

create trigger album_members_notify after insert on public.album_members
  for each row execute function public.notify_member_joined();

-- コメント: 写真の投稿者と、これまでにコメントした人へ通知
create or replace function public.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
begin
  select title into v_title from public.albums where id = new.album_id;
  insert into public.notifications (recipient_id, actor_id, album_id, photo_id, type, data)
  select distinct u.user_id, new.author_id, new.album_id, new.photo_id, 'comment',
         jsonb_build_object('excerpt', left(new.body, 80), 'album_title', v_title)
  from (
    select p.uploader_id as user_id from public.photos p where p.id = new.photo_id
    union
    select c.author_id from public.comments c where c.photo_id = new.photo_id
  ) u
  join public.album_members m on m.album_id = new.album_id and m.user_id = u.user_id
  where u.user_id <> new.author_id;
  return null;
end;
$$;

create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_comment();

-- リアクション: 写真の投稿者へ通知
create or replace function public.notify_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uploader uuid;
  v_title text;
begin
  select p.uploader_id into v_uploader from public.photos p where p.id = new.photo_id;
  if v_uploader is null or v_uploader = new.user_id then
    return null;
  end if;
  select title into v_title from public.albums where id = new.album_id;
  insert into public.notifications (recipient_id, actor_id, album_id, photo_id, type, data)
  values (v_uploader, new.user_id, new.album_id, new.photo_id, 'reaction',
          jsonb_build_object('emoji', new.emoji, 'album_title', v_title));
  return null;
end;
$$;

create trigger reactions_notify after insert on public.reactions
  for each row execute function public.notify_reaction();

-- 参加リクエスト: オーナーへ通知
create or replace function public.notify_join_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_title text;
begin
  select owner_id, title into v_owner, v_title from public.albums where id = new.album_id;
  insert into public.notifications (recipient_id, actor_id, album_id, type, data)
  values (v_owner, new.user_id, new.album_id, 'join_request',
          jsonb_build_object('request_id', new.id, 'album_title', v_title));
  return null;
end;
$$;

create trigger join_requests_notify after insert on public.join_requests
  for each row execute function public.notify_join_request();

-- -----------------------------------------------------------------------------
-- Realtime: 通知を即時にクライアントへ配信 (RLS により本人の通知のみ届く)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

revoke execute on function public.notify_photo_added(), public.notify_member_joined(), public.notify_comment(),
  public.notify_reaction(), public.notify_join_request() from anon, authenticated, public;
