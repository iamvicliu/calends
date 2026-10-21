import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** CALENDS_LOCAL 的相对路径始终从仓库根目录解析，空值保留 local/ 默认行为。 */
export function resolveLocalDir(env, repoRoot) {
  return resolve(repoRoot, env.CALENDS_LOCAL || 'local');
}

/** 注入文件存在性检查，便于离线测试参数选择，不启动 Wrangler。 */
export function resolveWranglerArgs(args, env, repoRoot, exists = existsSync) {
  const result = [...args];
  const config = join(resolveLocalDir(env, repoRoot), 'wrangler.jsonc');
  const explicitConfig = args.some((arg) => arg === '--config' || arg.startsWith('--config=') || arg.startsWith('-c'));
  if (!explicitConfig && exists(config)) result.push('--config', config);
  const local = args[0] === 'dev' || args.includes('--local');
  if (local && !args.some((arg) => arg === '--persist-to' || arg.startsWith('--persist-to='))) {
    result.push('--persist-to', join(repoRoot, '.wrangler/state'));
  }
  return result;
}
