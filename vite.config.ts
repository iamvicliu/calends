import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // React 生态组件（shadcn/ui、Radix、Motion、Recharts）统一跑在 preact/compat 上，不引入第二个框架
  plugins: [preact(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    // 本地开发：wrangler dev 跑在 8787
    proxy: { '/api': 'http://127.0.0.1:8787', '/cal': 'http://127.0.0.1:8787' },
  },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
