// wrangler 的薄封装：有 local/wrangler.jsonc（个人部署配置）时自动带上 --config；
// 本地命令统一把数据放在仓库根目录的 .wrangler/state，换配置文件也不会丢本地数据。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const extra = [];
if (existsSync('local/wrangler.jsonc') && !args.includes('--config') && !args.includes('-c')) extra.push('--config', 'local/wrangler.jsonc');
const local = args[0] === 'dev' || args.includes('--local');
if (local && !args.includes('--persist-to')) extra.push('--persist-to', '.wrangler/state');
const p = spawn('npx', ['wrangler', ...args, ...extra], { stdio: 'inherit' });
p.on('exit', (code) => process.exit(code ?? 1));
