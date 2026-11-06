// アカウント削除 Edge Function
//   1. リクエストの JWT から本人を確認
//   2. 本人が投稿した写真と、本人が所有するアルバムの全写真を Storage から削除
//   3. プロフィール画像を削除
//   4. 所有アルバムを削除 → auth ユーザーを削除 (関連データは外部キーの CASCADE で削除)
//
// service_role キーはこの関数の中 (サーバー側) でのみ使用し、ブラウザには渡さない。
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'not_authenticated' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: 'not_authenticated' }, 401);

  try {
    // 所有アルバム
    const { data: owned, error: ownedError } = await admin.from('albums').select('id').eq('owner_id', user.id);
    if (ownedError) throw ownedError;
    const ownedIds = (owned ?? []).map((a) => a.id as string);

    // 削除対象の写真ファイル
    const paths: string[] = [];
    const PAGE = 1000;
    const filter = ownedIds.length > 0 ? `uploader_id.eq.${user.id},album_id.in.(${ownedIds.join(',')})` : `uploader_id.eq.${user.id}`;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from('photos')
        .select('storage_path, thumb_path, preview_path')
        .or(filter)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const p of data ?? []) {
        paths.push(p.storage_path);
        if (p.thumb_path) paths.push(p.thumb_path);
        if (p.preview_path) paths.push(p.preview_path);
      }
      if (!data || data.length < PAGE) break;
    }
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from('photos').remove(paths.slice(i, i + 100));
      if (error) throw error;
    }

    // プロフィール画像
    const { data: avatars } = await admin.storage.from('avatars').list(user.id, { limit: 1000 });
    if (avatars && avatars.length > 0) {
      await admin.storage.from('avatars').remove(avatars.map((f) => `${user.id}/${f.name}`));
    }

    // 所有アルバム (他のメンバーの写真行も CASCADE で削除)
    if (ownedIds.length > 0) {
      const { error } = await admin.from('albums').delete().in('id', ownedIds);
      if (error) throw error;
    }

    // ユーザー本体 (profiles 以下は CASCADE)
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;

    return json({ ok: true, removed_files: paths.length });
  } catch (e) {
    console.error('delete-account failed', e);
    return json({ error: 'delete_failed' }, 500);
  }
});
