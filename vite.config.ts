/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'PhotoLink',
        short_name: 'PhotoLink',
        description: '大切な人たちと、写真や思い出を簡単に共有できるプライベートアルバム',
        lang: 'ja',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#faf9f7',
        theme_color: '#faf9f7',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // アプリ本体 (HTML/JS/CSS/アイコン) のみキャッシュ。写真は署名付き URL のためキャッシュしない
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // HEIC 変換ライブラリ (約 1.3MB) は必要な端末だけが必要な時に読み込む
        globIgnores: ['**/heic2any-*.js', 'icons/**'], // ホーム画面用アイコンはインストール時に OS が取得する
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth\/callback/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: ['es2020', 'safari15'],
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
