// wrangler 的薄封装：有 CALENDS_LOCAL/wrangler.jsonc（默认 local/）时自动带上 --config；
// 本地命令统一把数据放在仓库根目录的 .wrangler/state，换配置文件也不会丢本地数据。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveWranglerArgs } from './local-config.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = resolveWranglerArgs(process.argv.slice(2), process.env, ROOT);
const p = spawn('npx', ['wrangler', ...args], { stdio: 'inherit', cwd: ROOT });
p.on('exit', (code) => process.exit(code ?? 1));
