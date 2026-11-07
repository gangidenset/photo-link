-- =============================================================================
-- 修正: アルバム作成時に "new row violates row-level security policy" になる問題
-- =============================================================================
-- アプリは作成したアルバムの ID を返してもらう (insert ... returning)。
-- returning で返す行は SELECT ポリシーも満たす必要があるが、オーナーをメンバーに
-- 登録するトリガーの結果は同じ文の中では is_album_member() から見えないため拒否されていた。
-- オーナーは常に自分のアルバムを閲覧できるよう条件を追加する。

drop policy if exists albums_select on public.albums;
create policy albums_select on public.albums for select to authenticated
  using (owner_id = auth.uid() or public.is_album_member(id));
