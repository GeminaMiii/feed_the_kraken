import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // @ftk/engine 是工作区 CJS 包（__exportStar 转发导出），dev 下必须显式预打包为 ESM，
  // 否则浏览器原生 import 拿不到命名导出（生产构建由 commonjsOptions 兜底）
  optimizeDeps: {
    include: ['@ftk/engine'],
  },
  server: {
    port: 5173,
    // The temporary trycloudflare host is generated per session. Allow it so
    // remote phone previews are not rejected by Vite's host check.
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    commonjsOptions: {
      include: [/node_modules/, /packages.+engine/],
    },
  },
});
