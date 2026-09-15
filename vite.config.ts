import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    // 绑定 127.0.0.1 与 localhost 都可访问，避免只监听其中之一造成连不上
    host: true,
    // 本地开发时把 /api 转发给 wrangler（含真实密钥），
    // 前端仍走 Vite 热更新，改代码即时生效，无需每次重新构建或发版。
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
