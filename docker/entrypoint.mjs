// 容器入口：迁移数据库 → 准备初始化令牌 → 启动 Worker → 每小时触发一次定时任务（提醒、汇率）。
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = process.env.PORT || '8787';
const DATA = process.env.DATA_DIR || '/data';
const wrangler = join('node_modules', '.bin', 'wrangler');
mkdirSync(DATA, { recursive: true });

const log = (...a) => console.log('[calends]', ...a);

// 1. 数据库迁移（幂等）
const m = spawnSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', DATA], { stdio: 'inherit', env: { ...process.env, CI: 'true' } });
if (m.status !== 0) process.exit(m.status ?? 1);

// 2. 初始化令牌：环境变量优先；否则首次启动时生成并保存在数据目录，设好密码后就用不到了
let setupToken = process.env.SETUP_TOKEN;
const tokenFile = join(DATA, 'setup-token');
if (!setupToken) {
  if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(18).toString('base64url') + '\n', { mode: 0o600 });
  setupToken = readFileSync(tokenFile, 'utf8').trim();
}

// 3. 透传给 Worker 的变量
const vars = setupToken ? { SETUP_TOKEN: setupToken } : {};
for (const k of ['SITE_URL', 'OWNER_PASSCODE', 'TRUST_PROXY', 'BASE_PATH']) if (process.env[k]) vars[k] = process.env[k];
const args = [
  'dev',
  '--local',
  '--ip',
  '0.0.0.0',
  '--port',
  PORT,
  '--persist-to',
  DATA,
  '--show-interactive-dev-session=false',
  '--log-level',
  process.env.LOG_LEVEL || 'warn',
];
for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);

const worker = spawn(wrangler, args, { stdio: 'inherit' });
worker.on('exit', (code) => process.exit(code ?? 1));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => worker.kill(sig));

// 4. 等 Worker 就绪后打印访问方式；还没设密码时把初始化令牌打在日志里
const base = `http://127.0.0.1:${PORT}`;
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/api/auth/status`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('worker did not start');
}
const status = await ready();
log(`listening on port ${PORT} — open ${process.env.BASE_PATH || ''}/ in your browser`);
if (status.needsSetup) {
  log(`first run: create your password at ${process.env.BASE_PATH || ''}/ with this setup token:`);
  log(`    ${setupToken}`);
  log(`(also saved in ${tokenFile}; you can set SETUP_TOKEN yourself instead)`);
}

// 5. 定时任务：wrangler 本地模式不会自己跑 cron，这里每 15 分钟触发一次（与 Cloudflare 上的配置一致）
function scheduleNext() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes((Math.floor(now.getUTCMinutes() / 15) + 1) * 15, 0, 0);
  setTimeout(async () => {
    try {
      await fetch(`${base}/cdn-cgi/local/scheduled?cron=${encodeURIComponent('*/15 * * * *')}`);
    } catch (e) {
      log('scheduled trigger failed:', e.message);
    }
    scheduleNext();
  }, next - now);
}
scheduleNext();
