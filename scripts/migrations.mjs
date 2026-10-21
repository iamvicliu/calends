// 把 SQL 打包进 Worker；与 wrangler d1 migrations apply 共用解析器和 d1_migrations 表。
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { unstable_splitSqlQuery as splitSql } from 'wrangler';

// Wrangler follows SQLite statement completeness, including multiline trigger BEGIN…END bodies.
export { splitSql };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = new URL('../worker/migrations/', import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const items = files.map((name) => ({ name, statements: splitSql(readFileSync(new URL(name, dir), 'utf8')) }));
  writeFileSync(
    new URL('../worker/migrations.gen.ts', import.meta.url),
    `// 由 scripts/migrations.mjs 生成，请勿手改\nexport const MIGRATIONS: Array<{ name: string; statements: string[] }> = ${JSON.stringify(items, null, 2)};\n`,
  );
  console.log(`migrations: ${files.length}`);
}
