// 生成 Worker 用的文案入口（shared/locales/server.gen.ts）并检查各语言的键是否齐全。
// 用法：node scripts/i18n.mjs          生成
//       node scripts/i18n.mjs --check  另外列出缺失、多余的键（以 en 为准）
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../shared/locales/', import.meta.url).pathname;
// Worker 端会用到的命名空间：共享逻辑、服务端接口、提醒邮件、MCP
const SERVER_NS = ['common', 'core', 'server', 'notify', 'mcp'];

const locales = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const lines = ['// 由 scripts/i18n.mjs 生成，请勿手改', "import type { MessageTree } from '../i18n.ts';"];
const table = [];
let i = 0;
for (const loc of locales) {
  const entries = [];
  for (const ns of SERVER_NS) {
    if (!existsSync(join(ROOT, loc, `${ns}.json`))) continue;
    const id = `m${i++}`;
    lines.push(`import ${id} from './${loc}/${ns}.json';`);
    entries.push(`${JSON.stringify(ns)}: ${id} as MessageTree`);
  }
  table.push(`  ${JSON.stringify(loc)}: { ${entries.join(', ')} },`);
}
lines.push('', 'export const SERVER_MESSAGES: Record<string, Record<string, MessageTree>> = {', ...table, '};', '');
writeFileSync(join(ROOT, 'server.gen.ts'), lines.join('\n'));

if (process.argv.includes('--check')) {
  const keys = (tree, prefix = '', out = new Set()) => {
    for (const [k, v] of Object.entries(tree)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string' || Object.keys(v).every((x) => ['zero', 'one', 'two', 'few', 'many', 'other'].includes(x))) out.add(p);
      else keys(v, p, out);
    }
    return out;
  };
  const load = (loc) => {
    const all = new Set();
    for (const f of readdirSync(join(ROOT, loc)).filter((f) => f.endsWith('.json'))) for (const k of keys(JSON.parse(readFileSync(join(ROOT, loc, f), 'utf8')), f.slice(0, -5))) all.add(k);
    return all;
  };
  const en = load('en');
  let bad = 0;
  for (const loc of locales) {
    const have = load(loc);
    const missing = [...en].filter((k) => !have.has(k));
    const extra = [...have].filter((k) => !en.has(k));
    if (missing.length || extra.length) bad++;
    console.log(`${loc.padEnd(6)} ${have.size} keys · missing ${missing.length} · extra ${extra.length}${missing.length ? '\n  - ' + missing.slice(0, 10).join('\n  - ') : ''}${extra.length ? '\n  + ' + extra.slice(0, 10).join('\n  + ') : ''}`);
  }
  process.exitCode = bad ? 1 : 0;
}
