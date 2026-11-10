import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const csp = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data: blob:",
  "worker-src blob:",
  "connect-src 'none'",
  "frame-src blob:",
  "child-src blob:",
  "media-src blob:",
  "object-src blob:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    {
      name: 'inject-offline-csp',
      apply: 'build',
      transformIndexHtml(html) {
        return html.replace('</head>', `  <meta http-equiv="Content-Security-Policy" content="${csp}">\n</head>`);
      },
    },
  ],
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100 * 1024 * 1024,
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  worker: {
    // Windows 上双击 HTML 以 file:// 打开时，Chrome 不允许 blob 的 module worker；
    // 用经典 worker 才能离线运行。
    format: 'iife',
  },
});
