-- =============================================================================
-- 保存 (ダウンロード) 済みの記録
-- =============================================================================
-- 一括保存のときに「一度保存した写真をもう一度保存しない」ための記録。
-- 本人だけが閲覧・削除でき、記録の追加は mark_photos_downloaded() 経由のみ。

create table public.photo_downloads (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  photo_id      uuid not null references public.photos (id) on delete cascade,
  album_id      uuid not null references public.albums (id) on delete cascade,
  downloaded_at timestamptz not null default now(),
  primary key (user_id, photo_id)
);

create index photo_downloads_user_album_idx on public.photo_downloads (user_id, album_id);
create index photo_downloads_photo_idx on public.photo_downloads (photo_id);
create index photo_downloads_album_idx on public.photo_downloads (album_id);

alter table public.photo_downloads enable row level security;

-- Supabase の既定で付与される権限を外し、必要なものだけ許可
revoke all on public.photo_downloads from anon, authenticated;
grant select, delete on public.photo_downloads to authenticated;

create policy photo_downloads_select on public.photo_downloads for select to authenticated
  using (user_id = auth.uid());
create policy photo_downloads_delete on public.photo_downloads for delete to authenticated
  using (user_id = auth.uid());

-- 保存した写真を記録する (閲覧できる写真だけが対象。2 回目以降は日時を更新)
create or replace function public.mark_photos_downloaded(p_photo_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_photo_ids is null or coalesce(array_length(p_photo_ids, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(p_photo_ids, 1) > 500 then
    raise exception 'too_many_items' using errcode = '22023';
  end if;

  insert into public.photo_downloads (user_id, photo_id, album_id)
  select auth.uid(), p.id, p.album_id
  from public.photos p
  where p.id = any (p_photo_ids)
    and p.status = 'ready'
    and public.is_album_member(p.album_id)
  on conflict (user_id, photo_id) do update set downloaded_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_photos_downloaded(uuid[]) from anon, authenticated, public;
grant execute on function public.mark_photos_downloaded(uuid[]) to authenticated;
