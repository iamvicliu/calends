import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { normalizeBasePath, stripBase, withBase } from './shared/base.ts';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const BASE_PATH = normalizeBasePath(process.env.BASE_PATH);
const assetPath = (path: string) => withBase(path, BASE_PATH);

const LOCAL_PUBLIC = fileURLToPath(new URL('./local/public', import.meta.url));
const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

function manifest(source: string): string {
  const data = JSON.parse(source);
  data.start_url = assetPath(data.start_url);
  data.scope = assetPath(data.scope);
  for (const icon of data.icons ?? []) icon.src = assetPath(icon.src);
  for (const shortcut of data.shortcuts ?? []) shortcut.url = assetPath(shortcut.url);
  return JSON.stringify(data, null, 2) + '\n';
}

function baseManifest(): Plugin {
  return {
    name: 'base-manifest',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (stripBase((req.url ?? '').split('?')[0], BASE_PATH) !== '/manifest.webmanifest') return next();
        const local = join(LOCAL_PUBLIC, 'manifest.webmanifest');
        res.setHeader('content-type', 'application/manifest+json');
        res.end(manifest(readFileSync(existsSync(local) ? local : 'public/manifest.webmanifest', 'utf8')));
      });
    },
    closeBundle: {
      order: 'post',
      handler() {
        const file = 'dist/manifest.webmanifest';
        writeFileSync(file, manifest(readFileSync(file, 'utf8')));
      },
    },
  };
}

/** 个人部署的素材（local/public）覆盖 public 里的同名文件：开发时优先提供，构建后复制进 dist */
function localPublic(): Plugin {
  return {
    name: 'local-public',
    configureServer(server) {
      if (!existsSync(LOCAL_PUBLIC)) return;
      server.middlewares.use((req, res, next) => {
        const path = stripBase(decodeURIComponent((req.url ?? '').split('?')[0]), BASE_PATH);
        const file = join(LOCAL_PUBLIC, path);
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
  base: `${BASE_PATH}/`,
  // 页脚等处显示的版本号
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  // React 19 + React Compiler（Rust 版，自动做组件记忆化）
  plugins: [react({ compiler: true }), tailwindcss(), baseManifest(), localPublic()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    // 本地开发：wrangler dev 跑在 8787
    proxy: Object.fromEntries(['/api', '/cal', '/mcp'].map((path) => [assetPath(path), 'http://127.0.0.1:8787'])),
  },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
