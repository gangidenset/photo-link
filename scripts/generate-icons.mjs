// public/favicon.svg から PWA 用 PNG アイコンを生成する (Playwright の Chromium を使用)
//   使い方: npm run icons
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

// playwright はプロジェクト依存に含めない (グローバル導入版も NODE_PATH 経由で使えるように)
const { chromium } = await import('playwright').catch(() => createRequire(import.meta.url)('playwright'));

const svg = readFileSync('public/favicon.svg', 'utf8');
const targets = [
  { file: 'public/icons/icon-192.png', size: 192, pad: 0 },
  { file: 'public/icons/icon-512.png', size: 512, pad: 0 },
  // maskable: Android が丸や角丸に切り抜くため、周囲に余白を取る
  { file: 'public/icons/icon-maskable-512.png', size: 512, pad: 0.12, bg: '#c24a2c' },
  { file: 'public/apple-touch-icon.png', size: 180, pad: 0, bg: '#c24a2c' },
];

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  const inner = Math.round(t.size * (1 - t.pad * 2));
  // apple-touch-icon / maskable は角丸なしの正方形 (OS 側で切り抜く)
  const body = t.bg
    ? svg.replace('rx="112"', 'rx="0"')
    : svg;
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<html><body style="margin:0;background:${t.bg ?? 'transparent'};display:flex;align-items:center;justify-content:center;width:${t.size}px;height:${t.size}px">
      <div style="width:${inner}px;height:${inner}px">${body.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
    </body></html>`,
  );
  await page.screenshot({ path: t.file, omitBackground: !t.bg });
  console.log('generated', t.file);
}
await browser.close();
