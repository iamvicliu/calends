import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

const LOCAL_PUBLIC = fileURLToPath(new URL('./local/public', import.meta.url));
const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

/** 个人部署的素材（local/public）覆盖 public 里的同名文件：开发时优先提供，构建后复制进 dist */
function localPublic(): Plugin {
  return {
    name: 'local-public',
    configureServer(server) {
      if (!existsSync(LOCAL_PUBLIC)) return;
      server.middlewares.use((req, res, next) => {
        const file = join(LOCAL_PUBLIC, decodeURIComponent((req.url ?? '').split('?')[0]));
        if (!file.startsWith(LOCAL_PUBLIC) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (existsSync(LOCAL_PUBLIC)) cpSync(LOCAL_PUBLIC, 'dist', { recursive: true });
    },
  };
}

const VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  // 页脚等处显示的版本号
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  // React 生态组件（shadcn/ui、Radix、Motion、Recharts）统一跑在 preact/compat 上，不引入第二个框架
  plugins: [preact(), tailwindcss(), localPublic()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    // 本地开发：wrangler dev 跑在 8787
    proxy: { '/api': 'http://127.0.0.1:8787', '/cal': 'http://127.0.0.1:8787', '/mcp': 'http://127.0.0.1:8787' },
  },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
