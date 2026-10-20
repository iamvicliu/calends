// 把 migrations/*.sql 打包进 Worker（worker/migrations.gen.ts），让新部署首次访问时自动建表。
// 与 wrangler d1 migrations apply 共用 d1_migrations 表，两种方式可以混用。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const items = files.map((name) => {
  const sql = readFileSync(new URL(name, dir), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const statements = sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
  return { name, statements };
});
writeFileSync(new URL('../worker/migrations.gen.ts', import.meta.url), `// 由 scripts/migrations.mjs 生成，请勿手改\nexport const MIGRATIONS: Array<{ name: string; statements: string[] }> = ${JSON.stringify(items, null, 2)};\n`);
console.log(`migrations: ${files.length}`);
