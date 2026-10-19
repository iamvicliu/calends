import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    // 本地开发：wrangler dev 跑在 8787
    proxy: { '/api': 'http://127.0.0.1:8787', '/cal': 'http://127.0.0.1:8787' },
  },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
