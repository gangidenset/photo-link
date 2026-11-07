// ブラウザでの動作確認 (Supabase をモックして実行)
//   iPhone / Android の画面サイズ・タッチ操作をエミュレートし、主要画面の表示と
//   「120 枚の一括アップロード → 失敗分の再試行 → GPS 除去」までを自動で検証する。
//   ※ 実機・実際の Supabase での検証の代わりにはならない (docs/TESTING.md 参照)。
//
//   使い方:
//     VITE_SUPABASE_URL=http://mock.supabase.test VITE_SUPABASE_ANON_KEY=test npm run build
//     npx vite preview --port 4173 &
//     node e2e/mock-smoke.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import exifr from 'exifr';
import { unzipSync } from 'fflate';

const { chromium, devices } = await import('playwright').catch(() => createRequire(import.meta.url)('playwright'));

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const SB = 'http://mock.supabase.test';
const OUT = process.env.SHOT_DIR ?? 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const ALBUM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

// ---------------------------------------------------------------- フィクスチャ
const profile = (id, name) => ({ id, display_name: name, avatar_path: null });
const me = { ...profile(USER_ID, 'テスト太郎'), plan_id: 'free', created_at: iso(now), updated_at: iso(now) };
const album = {
  id: ALBUM_ID,
  owner_id: USER_ID,
  title: '2026 夏の家族旅行',
  description: '沖縄旅行の写真をみんなで集めましょう',
  cover_photo_id: 'p-0',
  photo_count: 80,
  member_count: 2,
  last_photo_at: iso(now - 3600e3),
  created_at: iso(now - 86400e3 * 10),
  updated_at: iso(now),
  cover: { id: 'p-0', thumb_path: `${ALBUM_ID}/p-0/thumb.jpg`, preview_path: `${ALBUM_ID}/p-0/preview.jpg` },
};
const photos = Array.from({ length: 80 }, (_, i) => ({
  id: `p-${i}`,
  album_id: ALBUM_ID,
  uploader_id: i % 3 ? USER_ID : OTHER_ID,
  media_type: i % 11 === 5 ? 'video' : 'image',
  status: 'ready',
  storage_path: `${ALBUM_ID}/p-${i}/original.jpg`,
  thumb_path: `${ALBUM_ID}/p-${i}/thumb.jpg`,
  preview_path: i % 11 === 5 ? null : `${ALBUM_ID}/p-${i}/preview.jpg`,
  mime_type: i % 11 === 5 ? 'video/mp4' : 'image/jpeg',
  size_bytes: 2_400_000,
  width: 4032,
  height: 3024,
  duration_sec: i % 11 === 5 ? 37 : null,
  original_filename: `IMG_${1000 + i}.JPG`,
  content_hash: `sha256:${String(i).padStart(64, '0')}`,
  taken_at: iso(now - i * 86400e3 * 3),
  sort_at: iso(now - i * 86400e3 * 3),
  created_at: iso(now - i * 3600e3),
  updated_at: iso(now),
  uploader: i % 3 ? profile(USER_ID, 'テスト太郎') : profile(OTHER_ID, '花子'),
}));
const members = [
  { album_id: ALBUM_ID, user_id: USER_ID, role: 'owner', joined_at: iso(now - 864e6), profile: profile(USER_ID, 'テスト太郎') },
  { album_id: ALBUM_ID, user_id: OTHER_ID, role: 'member', joined_at: iso(now - 86e6), profile: profile(OTHER_ID, '花子') },
];
const notifications = [
  { id: 'n1', recipient_id: USER_ID, actor_id: OTHER_ID, album_id: ALBUM_ID, photo_id: 'p-1', type: 'photo_added', data: { count: 12, album_title: album.title }, read_at: null, created_at: iso(now - 600e3), actor: profile(OTHER_ID, '花子') },
  { id: 'n2', recipient_id: USER_ID, actor_id: OTHER_ID, album_id: ALBUM_ID, photo_id: 'p-2', type: 'comment', data: { excerpt: 'この写真すてき！', album_title: album.title }, read_at: iso(now), created_at: iso(now - 7200e3), actor: profile(OTHER_ID, '花子') },
];

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
const accessToken = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER_ID, role: 'authenticated', exp: Math.floor(now / 1000) + 3600, aud: 'authenticated' })}.sig`;
const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'taro@example.com', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: iso(now) };
const session = { access_token: accessToken, refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, user };

// ---------------------------------------------------------------- モック API
function createMock({ failFirstUploadsFor = null } = {}) {
  const state = { begin: 0, complete: 0, uploads: new Map(), tus: new Map(), failures: 0, gpsFile: null };
  let thumbPng;

  async function handler(route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const json = (body, status = 200, headers = {}) =>
      route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: JSON.stringify(body) });
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');

    if (method === 'OPTIONS')
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' } });

    // 認証
    if (path === '/auth/v1/user') return json(user);
    if (path === '/auth/v1/token') return json(session);
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });

    // REST
    if (path === '/rest/v1/profiles') return json(single ? me : [me]);
    if (path === '/rest/v1/albums') return json(single ? album : [album]);
    if (path === '/rest/v1/album_members') return json(members);
    if (path === '/rest/v1/notifications') {
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': '0-0/1', 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' } });
      if (method === 'PATCH') return json([]);
      return json(notifications);
    }
    if (path === '/rest/v1/photo_downloads' && method === 'DELETE') {
      const ids = (url.searchParams.get('photo_id') ?? '').replace(/^in\.\(|\)$/g, '').split(',').filter(Boolean);
      ids.forEach((id) => state.marked?.delete(id));
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    if (path === '/rest/v1/photo_downloads') return json([...(state.marked ?? new Set())].map((id) => ({ photo_id: id })));
    if (path === '/rest/v1/rpc/mark_photos_downloaded') {
      const ids = req.postDataJSON().p_photo_ids;
      state.marked ??= new Set();
      ids.forEach((id) => state.marked.add(id));
      return json(ids.length);
    }
    if (path === '/rest/v1/comments' || path === '/rest/v1/reactions' || path === '/rest/v1/join_requests' || path === '/rest/v1/invitations') return json([]);
    if (path === '/rest/v1/photos' && method === 'DELETE') {
      const ids = (url.searchParams.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',').filter(Boolean);
      state.deletedIds = [...(state.deletedIds ?? []), ...ids];
      return route.fulfill({ status: 204, headers: { 'content-range': `*/${ids.length}`, 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' } });
    }
    if (path === '/storage/v1/object/photos' && method === 'DELETE') {
      state.removedPaths = [...(state.removedPaths ?? []), ...(req.postDataJSON()?.prefixes ?? [])];
      return json([]);
    }
    if (path === '/rest/v1/photos') {
      const id = url.searchParams.get('id')?.replace('eq.', '');
      if (id) return json(single ? (photos.find((p) => p.id === id) ?? null) : photos.filter((p) => p.id === id));
      const up = url.searchParams.get('uploader_id');
      const filtered = !up ? photos : up.startsWith('neq.') ? photos.filter((p) => `neq.${p.uploader_id}` !== up) : photos.filter((p) => `eq.${p.uploader_id}` === up);
      // 無限スクロール: 1 ページ目は 60 件、続き (or=...) は残り。offset/limit 指定時はその範囲
      if (url.searchParams.has('offset')) {
        const offset = Number(url.searchParams.get('offset'));
        const limit = Number(url.searchParams.get('limit') ?? 1000);
        return json(filtered.slice(offset, offset + limit));
      }
      const isNext = url.searchParams.has('or');
      return json(isNext ? filtered.slice(60) : filtered.slice(0, 60));
    }
    if (path === '/rest/v1/rpc/get_my_usage')
      return json({ plan: { id: 'free', name: 'フリー', max_albums: 20, max_storage_bytes: 5368709120, max_image_bytes: 52428800, max_video_bytes: 209715200, max_video_duration_sec: 300, features: {} }, storage_bytes: 1288490188, photo_count: 312, album_count: 3 });
    if (path === '/rest/v1/rpc/begin_photo_upload') {
      const body = req.postDataJSON();
      // 本番の RPC と同様、同じファイル (指紋) の再試行は同じ行を返す
      state.byHash ??= new Map();
      let id = state.byHash.get(body.p_content_hash);
      if (!id) {
        state.begin++;
        id = `u-${state.begin}`;
        state.byHash.set(body.p_content_hash, id);
      }
      const base = `${body.p_album_id}/${id}/`;
      const ext = body.p_mime_type === 'video/mp4' ? 'mp4' : 'jpg';
      return json({
        id,
        storage_path: `${base}original.${ext}`,
        thumb_path: body.p_has_thumb ? `${base}thumb.jpg` : null,
        preview_path: body.p_has_thumb && body.p_media_type === 'image' ? `${base}preview.jpg` : null,
        resumed: false,
        _name: body.p_original_filename,
      });
    }
    if (path === '/rest/v1/rpc/complete_photo_upload') {
      state.complete++;
      if (/^[0-9a-f]{16}$/.test(req.postDataJSON().p_phash ?? '')) state.phashes = (state.phashes ?? 0) + 1;
      return json({ ...photos[0], id: req.postDataJSON().p_photo_id });
    }

    // Storage: 署名付き URL
    if (path === '/storage/v1/object/sign/photos' || path === '/storage/v1/object/sign/avatars') {
      const { paths } = req.postDataJSON();
      return json(paths.map((p) => ({ path: p, signedURL: `/object/sign/photos/${p}?token=t`, error: null })));
    }
    if (path.startsWith('/storage/v1/object/sign/') && method === 'POST') return json({ signedURL: `${path.replace('/storage/v1', '')}?token=t` });
    if (path.startsWith('/storage/v1/object/sign/') && method === 'GET') {
      // 本物の Storage と同様、download 指定時は添付ファイルとして返す
      const dl = url.searchParams.get('download');
      const headers = { 'access-control-allow-origin': '*', ...(dl !== null ? { 'content-disposition': `attachment; filename="${encodeURIComponent(dl || 'file')}"` } : {}) };
      const objectPath = decodeURIComponent(path.replace('/storage/v1/object/sign/photos/', ''));
      const override = state.thumbOverrides?.[objectPath];
      if (override) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: override, headers });
      return route.fulfill({ status: 200, contentType: 'image/png', body: thumbPng, headers });
    }

    // Storage: 通常アップロード
    if (path.startsWith('/storage/v1/object/photos/') && method === 'POST') {
      const objectPath = decodeURIComponent(path.replace('/storage/v1/object/photos/', ''));
      if (failFirstUploadsFor && objectPath.endsWith('original.jpg') && state.failures < 3) {
        const begun = objectPath.split('/')[1];
        if (begun === failFirstUploadsFor.id) {
          state.failures++;
          return route.fulfill({ status: 503, body: 'Service Unavailable', headers: { 'access-control-allow-origin': '*' } });
        }
      }
      state.uploads.set(objectPath, req.postDataBuffer());
      return json({ Key: `photos/${objectPath}` });
    }

    // Storage: TUS (再開可能アップロード)
    if (path === '/storage/v1/upload/resumable' && method === 'POST') {
      const id = `tus${state.tus.size + 1}`;
      const len = Number(req.headers()['upload-length']);
      const body = req.postDataBuffer() ?? Buffer.alloc(0);
      state.tus.set(id, { len, received: body.length });
      return route.fulfill({
        status: 201,
        headers: { location: `${SB}/storage/v1/upload/resumable/${id}`, 'upload-offset': String(body.length), 'tus-resumable': '1.0.0', 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' },
      });
    }
    if (path.startsWith('/storage/v1/upload/resumable/')) {
      const id = path.split('/').pop();
      const t = state.tus.get(id);
      if (method === 'PATCH') t.received += (req.postDataBuffer() ?? Buffer.alloc(0)).length;
      return route.fulfill({ status: method === 'PATCH' ? 204 : 200, headers: { 'upload-offset': String(t.received), 'upload-length': String(t.len), 'tus-resumable': '1.0.0', 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' } });
    }

    return json({ message: `unmocked ${method} ${path}` }, 404);
  }
  return { state, handler, setThumb: (b) => (thumbPng = b) };
}

// ---------------------------------------------------------------- テスト用 JPEG 生成 (ブラウザの canvas で作成)
async function makeJpegs(browser, count) {
  const page = await browser.newPage();
  const list = await page.evaluate(async (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas');
      c.width = 800;
      c.height = 600;
      const ctx = c.getContext('2d');
      ctx.fillStyle = `hsl(${(i * 37) % 360} 60% 55%)`;
      ctx.fillRect(0, 0, 800, 600);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 120px sans-serif';
      ctx.fillText(String(i), 300, 340);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of buf) s += String.fromCharCode(b);
      out.push(btoa(s));
    }
    return out;
  }, count);
  await page.close();
  return list.map((b) => Buffer.from(b, 'base64'));
}

/** JPEG に GPS 付き EXIF (APP1) を挿入する */
function withGpsExif(jpeg) {
  const tiff = Buffer.alloc(94);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); // IFD0: 1 entry
  tiff.writeUInt16LE(0x8825, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18); // GPS IFD offset
  tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(2, 26); // GPS IFD: 2 entries
  tiff.writeUInt16LE(1, 28); // LatitudeRef
  tiff.writeUInt16LE(2, 30);
  tiff.writeUInt32LE(2, 32);
  tiff.write('N\0', 36, 'ascii');
  tiff.writeUInt16LE(2, 40); // Latitude RATIONAL x3 at 58
  tiff.writeUInt16LE(5, 42);
  tiff.writeUInt32LE(3, 44);
  tiff.writeUInt32LE(58, 48);
  tiff.writeUInt32LE(0, 52);
  [26, 1, 12, 1, 3456, 100].forEach((v, i) => tiff.writeUInt32LE(v, 58 + i * 4));
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const seg = Buffer.alloc(4);
  seg.writeUInt16BE(0xffe1, 0);
  seg.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), seg, payload, jpeg.subarray(2)]);
}

// ---------------------------------------------------------------- 実行
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
};

// 日本語のファイル名を正しく扱うため UTF-8 ロケールで起動 (サーバー環境はロケール未設定のことがある)
const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const fs = await import('node:fs');
const thumb = fs.readFileSync('public/icons/icon-512.png');
// 端末にある写真の代わり (アルバムの p-3 / p-6 のサムネイルとしても使う)
const deviceJpegs = await makeJpegs(browser, 2);

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

for (const [label, device] of [
  ['iPhone', devices['iPhone 13']],
  ['Android', devices['Pixel 7']],
]) {
  const consoleErrors = [];
  // 未ログイン
  {
    const ctx = await browser.newContext({ ...device });
    const mock = createMock();
    mock.setThumb(thumb);
    await ctx.route(`${SB}/**`, mock.handler);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/albums`);
    await page.waitForURL(/\/login/);
    check(`${label}: 未ログインで保護画面を開くとログインへ`, page.url().includes('next=%2Falbums'));
    await page.screenshot({ path: `${OUT}/${label}-01-login.png` });
    await page.goto(`${BASE}/signup`);
    await page.getByLabel('表示名').waitFor();
    check(`${label}: 新規登録画面のレイアウト崩れなし`, await noHorizontalOverflow(page));
    await page.screenshot({ path: `${OUT}/${label}-02-signup.png` });
    await ctx.close();
  }

  // ログイン済み
  const ctx = await browser.newContext({ ...device });
  const mock = createMock({ failFirstUploadsFor: { id: 'u-7' } });
  mock.setThumb(thumb);
  await ctx.route(`${SB}/**`, mock.handler);
  await ctx.addInitScript((s) => localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)), session);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && !/realtime|websocket|WebSocket|status of 503/i.test(m.text()) && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(`${BASE}/`);
  await page.getByText('テスト太郎 さん').waitFor();
  check(`${label}: ホーム表示`, await noHorizontalOverflow(page));
  await page.screenshot({ path: `${OUT}/${label}-03-home.png` });

  await page.getByRole('link', { name: 'アルバム', exact: true }).click();
  await page.getByRole('heading', { name: album.title }).waitFor();
  await page.screenshot({ path: `${OUT}/${label}-04-albums.png` });

  await page.goto(`${BASE}/albums/${ALBUM_ID}`);
  await page.locator('a[href*="/photos/"]').first().waitFor();
  await page.waitForTimeout(500);
  check(`${label}: アルバム詳細のグリッド表示`, (await page.locator('a[href*="/photos/"]').count()) >= 60);
  check(`${label}: アルバム詳細のレイアウト崩れなし`, await noHorizontalOverflow(page));
  await page.screenshot({ path: `${OUT}/${label}-05-album.png` });
  // 無限スクロール
  await page.mouse.wheel(0, 20000);
  await page.waitForFunction(() => document.querySelectorAll('a[href*="/photos/"]').length >= 80, null, { timeout: 5000 }).catch(() => undefined);
  check(`${label}: 無限スクロールで次ページ読み込み`, (await page.locator('a[href*="/photos/"]').count()) === 80);
  // 投稿者で絞り込み
  await page.getByRole('tab', { name: '花子' }).click();
  await page.waitForURL(/by=/);
  await page.waitForFunction((n) => document.querySelectorAll('a[href*="/photos/"]').length === n, photos.filter((p) => p.uploader_id === OTHER_ID).length, { timeout: 5000 }).catch(() => undefined);
  check(`${label}: 投稿者で絞り込み`, (await page.locator('a[href*="/photos/"]').count()) === photos.filter((p) => p.uploader_id === OTHER_ID).length);
  await page.getByRole('tab', { name: 'すべて' }).click();

  // 複数選択して一括削除 (長押しで選択モード開始)
  page.once('dialog', (d) => d.accept());
  const thumbs = page.locator('a[href*="/photos/"]');
  const firstBox = await thumbs.nth(0).boundingBox();
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.getByText('1 件を選択中').waitFor({ timeout: 3000 }).catch(() => undefined);
  check(`${label}: 長押しで選択モードになり写真は開かない`, (await page.getByText('1 件を選択中').count()) === 1 && !page.url().includes('/photos/'));
  await page.getByRole('checkbox').nth(1).click();
  await page.getByRole('checkbox').nth(2).click();
  await page.screenshot({ path: `${OUT}/${label}-05b-select.png` });
  await page.getByRole('button', { name: '3 件を削除' }).click();
  await page.getByText('3 件を削除しました').waitFor({ timeout: 5000 }).catch(() => undefined);
  check(
    `${label}: 選択した 3 件をまとめて削除 (ファイル + データ)`,
    mock.state.deletedIds?.length === 3 && mock.state.removedPaths?.length === 3 * 3 - (mock.state.deletedIds.some((id) => photos.find((p) => p.id === id)?.preview_path === null) ? 1 : 0),
    `ids=${mock.state.deletedIds?.join(',')} files=${mock.state.removedPaths?.length}`,
  );
  check(`${label}: 削除後は選択モードを終了`, (await page.getByRole('checkbox').count()) === 0);
  // メニューからも選択モードに入れる
  await page.getByRole('button', { name: 'メニュー' }).click();
  await page.getByRole('button', { name: '写真を選択 (保存・削除)' }).click();
  await page.getByRole('button', { name: 'すべて選択' }).click();
  check(`${label}: すべて選択 (読み込み済みの写真)`, (await page.getByRole('checkbox', { checked: true }).count()) === (await page.getByRole('checkbox').count()));
  await page.getByRole('button', { name: '選択を解除' }).click();

  // 一括保存 (iPhone エミュレーションは共有シート非対応のため ZIP、Android は 1 件ずつダウンロード)
  const downloads = [];
  page.on('download', async (d) => downloads.push({ name: d.suggestedFilename(), path: await d.path().catch(() => null) }));
  for (const i of [0, 1, 2]) await page.getByRole('checkbox').nth(i).click();
  await page.getByRole('button', { name: '3 件を保存' }).click();
  await page.getByText('3 件を保存しました').waitFor({ timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  if (label === 'iPhone') {
    const zip = downloads.find((d) => d.name.endsWith('.zip'));
    const entries = zip?.path ? Object.keys(unzipSync(fs.readFileSync(zip.path))) : [];
    check(`${label}: 選択した 3 件を ZIP でまとめて保存`, entries.length === 3, `${zip?.name} [${entries.join(', ')}]`);
  } else {
    check(`${label}: 選択した 3 件を 1 件ずつダウンロード`, downloads.length === 3, downloads.map((d) => d.name).join(', '));
  }
  check(`${label}: 保存した写真を記録`, mock.state.marked?.size === 3, [...(mock.state.marked ?? [])].join(','));
  await page.getByRole('button', { name: '閉じる' }).click();
  check(`${label}: 保存後は選択モードを終了`, (await page.getByRole('checkbox').count()) === 0);

  // 他のメンバーの写真をまとめて保存 (保存済みの 1 件は除外を選ぶ)
  const others = photos.filter((p) => p.uploader_id !== USER_ID);
  const alreadySaved = others.filter((p) => mock.state.marked.has(p.id)).length;
  downloads.length = 0;
  await page.getByRole('button', { name: 'メニュー' }).click();
  await page.getByRole('button', { name: '他のメンバーの写真を保存' }).click();
  const onlyUnsaved = page.getByRole('button', { name: `未保存の ${others.length - alreadySaved} 件だけ保存` });
  await onlyUnsaved.waitFor({ timeout: 5000 }).catch(() => undefined);
  await page.screenshot({ path: `${OUT}/${label}-05c-save-others.png` });
  check(`${label}: 他のメンバーの写真で保存済みを確認表示`, (await onlyUnsaved.count()) === 1 && (await page.getByText(`${alreadySaved} 件は以前に保存しています`).count()) === 1, `others=${others.length} saved=${alreadySaved}`);
  await onlyUnsaved.click();
  await page.getByText(`${others.length - alreadySaved} 件を保存しました`).waitFor({ timeout: 60000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  const savedNow = label === 'iPhone'
    ? (() => { const z = downloads.find((d) => d.name.endsWith('.zip')); return z?.path ? Object.keys(unzipSync(fs.readFileSync(z.path))).length : 0; })()
    : downloads.length;
  check(`${label}: 未保存の ${others.length - alreadySaved} 件だけ保存 (重複なし)`, savedNow === others.length - alreadySaved, `saved=${savedNow}`);
  check(`${label}: 他のメンバーの写真をすべて記録`, others.every((p) => mock.state.marked.has(p.id)));
  await page.getByRole('button', { name: '閉じる' }).click();

  // アルバム全体の保存 + 端末の写真と照合 (p-3 と p-6 だけ端末に残っている想定)
  mock.state.thumbOverrides = { [`${ALBUM_ID}/p-3/thumb.jpg`]: deviceJpegs[0], [`${ALBUM_ID}/p-6/thumb.jpg`]: deviceJpegs[1] };
  await page.getByRole('button', { name: 'メニュー' }).click();
  await page.getByRole('button', { name: 'アルバムの写真をすべて保存 (自分の写真も含む)' }).click();
  await page.getByRole('button', { name: '写真を選んで照合' }).waitFor({ timeout: 5000 });
  const recordedBefore = mock.state.marked.size;
  check(`${label}: アルバム全体の保存で記録上の保存済みを表示`, (await page.getByText(`${recordedBefore} 件は以前に保存しています`).count()) === 1, `recorded=${recordedBefore}`);
  await page.locator('input[type=file][accept="image/*,video/*"]').setInputFiles([
    { name: 'IMG_A.JPG', mimeType: 'image/jpeg', buffer: deviceJpegs[0] },
    { name: 'IMG_B.JPG', mimeType: 'image/jpeg', buffer: deviceJpegs[1] },
  ]);
  await page.getByText('選んだ 2 件の写真と照合しました').waitFor({ timeout: 30000 }).catch(() => undefined);
  await page.screenshot({ path: `${OUT}/${label}-05d-device-check.png` });
  check(
    `${label}: 端末の写真と照合して実際に持っている 2 件だけ除外`,
    (await page.getByRole('button', { name: `未保存の ${photos.length - 2} 件だけ保存` }).count()) === 1,
  );
  check(
    `${label}: 端末にない写真の保存済み記録を取り消し`,
    mock.state.marked.size === 2 && mock.state.marked.has('p-3') && mock.state.marked.has('p-6'),
    [...mock.state.marked].join(','),
  );
  await page.keyboard.press('Escape');

  // ビューア + スワイプ
  await page.goto(`${BASE}/albums/${ALBUM_ID}/photos/p-1`);
  await page.getByLabel('詳細情報').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${label}-06-viewer.png` });
  const vp = page.viewportSize();
  await page.mouse.move(vp.width * 0.8, vp.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(vp.width * (0.8 - i * 0.07), vp.height / 2);
  await page.mouse.up();
  await page.waitForURL(/photos\/p-2/, { timeout: 3000 }).catch(() => undefined);
  check(`${label}: 左スワイプで次の写真へ`, page.url().includes('/photos/p-2'));
  await page.getByRole('button', { name: 'コメントを開く' }).click();
  await page.getByText('最初のコメントを書いてみましょう').waitFor();
  await page.screenshot({ path: `${OUT}/${label}-07-comments.png` });
  await page.keyboard.press('Escape');

  // メンバー・招待・通知・マイページ
  for (const [path, name, file] of [
    [`/albums/${ALBUM_ID}/members`, 'メンバー', '08-members'],
    [`/albums/${ALBUM_ID}/invite`, 'メンバーを招待', '09-invite'],
    ['/notifications', '通知', '10-notifications'],
    ['/profile', 'マイページ', '11-profile'],
    ['/settings', '設定', '12-settings'],
    ['/join', 'アルバムに参加', '13-join'],
  ]) {
    await page.goto(`${BASE}${path}`);
    await page.getByRole('heading', { name, exact: true }).first().waitFor();
    await page.waitForTimeout(300);
    check(`${label}: ${name} 画面のレイアウト崩れなし`, await noHorizontalOverflow(page));
    await page.screenshot({ path: `${OUT}/${label}-${file}.png` });
  }

  // 一括アップロード (120 枚 + 同一ファイル 1 枚 + 8MB 動画 1 本)
  if (label === 'iPhone') {
    const jpegs = await makeJpegs(browser, 120);
    jpegs[3] = withGpsExif(jpegs[3]);
    const before = await exifr.parse(jpegs[3], { gps: true });
    const files = jpegs.map((buf, i) => ({ name: `IMG_${String(i).padStart(4, '0')}.JPG`, mimeType: 'image/jpeg', buffer: buf }));
    files.push({ name: 'IMG_0000_copy.JPG', mimeType: 'image/jpeg', buffer: jpegs[0] });
    const video = Buffer.alloc(8 * 1024 * 1024, 1);
    Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).copy(video, 0);
    files.push({ name: 'MOV_0001.mp4', mimeType: 'video/mp4', buffer: video });

    await page.goto(`${BASE}/albums/${ALBUM_ID}/upload`);
    await page.getByText('ライブラリ').waitFor();
    const t0 = Date.now();
    await page.locator('input[type=file][multiple]').setInputFiles(files);
    await page.getByRole('button', { name: /件をアップロード/ }).waitFor();
    check('iPhone: 122 件選択してもプレビュー表示', (await page.getByRole('button', { name: '122 件をアップロード' }).count()) === 1, `${Date.now() - t0}ms`);
    await page.screenshot({ path: `${OUT}/${label}-14-picker.png` });
    await page.getByRole('button', { name: '122 件をアップロード' }).click();
    await page.waitForURL(/\/uploads/);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${label}-15-uploading.png` });

    // 自動再試行 (3 回) で失敗 → 手動再試行で成功
    await page.getByRole('button', { name: /失敗した 1 件を再試行/ }).waitFor({ timeout: 120000 });
    await page.waitForFunction(() => document.body.innerText.includes('完了しました'), null, { timeout: 120000 });
    await page.screenshot({ path: `${OUT}/${label}-16-failed.png` });
    check('iPhone: 通信エラー時に自動再試行し、失敗が 1 件として表示', mock.state.failures === 3, `failures=${mock.state.failures}`);
    await page.getByRole('button', { name: /失敗した 1 件を再試行/ }).click();
    await page.waitForFunction(() => document.body.innerText.includes('完了 121 / 122 件'), null, { timeout: 60000 }).catch(() => undefined);
    const text = await page.locator('main').innerText();
    check('iPhone: 再試行後に全件完了 (重複 1 件はスキップ)', text.includes('完了 121 / 122 件') && text.includes('スキップ 1 件'), text.split('\n').slice(0, 4).join(' / '));
    check('iPhone: 完了処理の呼び出し回数', mock.state.complete === 121, `complete=${mock.state.complete}`);
    check('iPhone: 8MB 動画は TUS (再開可能アップロード) で送信', [...mock.state.tus.values()].some((t) => t.received === t.len && t.len >= 8 * 1024 * 1024));
    await page.screenshot({ path: `${OUT}/${label}-17-done.png` });

    // GPS 除去の確認: 4 枚目 (index 3) のオリジナル
    const uploadedOriginals = [...mock.state.uploads.entries()].filter(([k]) => k.endsWith('original.jpg'));
    const gpsTarget = uploadedOriginals.find(([, buf]) => buf.length === jpegs[3].length);
    const after = gpsTarget ? await exifr.parse(gpsTarget[1], { gps: true }).catch(() => null) : null;
    check('iPhone: アップロード前に GPS 位置情報を除去', before?.GPSLatitude && gpsTarget && !after?.GPSLatitude, `before=${JSON.stringify(before?.GPSLatitude)} after=${JSON.stringify(after?.GPSLatitude)}`);
    const thumbs = [...mock.state.uploads.keys()].filter((k) => k.endsWith('thumb.jpg')).length;
    const previews = [...mock.state.uploads.keys()].filter((k) => k.endsWith('preview.jpg')).length;
    check('iPhone: 写真の見た目の指紋 (phash) を送信', (mock.state.phashes ?? 0) >= 120, `phash=${mock.state.phashes}`);
    check('iPhone: サムネイル・プレビューを生成して送信', thumbs >= 120 && previews >= 120, `thumbs=${thumbs} previews=${previews}`);

    // 完了表示は数秒後に自動で消える
    const extra = await makeJpegs(browser, 2);
    await page.getByRole('link', { name: 'アルバムを見る' }).click().catch(() => undefined);
    await page.getByRole('link', { name: '追加' }).click();
    await page.locator('input[type=file][multiple]').setInputFiles(extra.map((buf, i) => ({ name: `EXTRA_${i}.JPG`, mimeType: 'image/jpeg', buffer: Buffer.concat([buf, Buffer.from([i])]) })));
    await page.getByRole('button', { name: '2 件をアップロード' }).click();
    await page.getByText('完了しました').waitFor({ timeout: 30000 });
    await page.getByRole('link', { name: 'アルバムを見る' }).click();
    const banner = page.getByRole('status').filter({ hasText: 'アップロード完了' });
    const shown = await banner.waitFor({ timeout: 2000 }).then(() => true).catch(() => false);
    await page.screenshot({ path: `${OUT}/${label}-18-banner.png` });
    await page.waitForTimeout(4600);
    check('iPhone: アップロード完了の表示が数秒後に自動で消える', shown && (await banner.count()) === 0, `shown=${shown}`);
  }

  check(`${label}: コンソールエラーなし`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
