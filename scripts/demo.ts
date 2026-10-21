// 生成演示数据：一位虚构用户（Alex）的完整账本，日期都相对今天，任何时候生成都显得「正在使用」。
// 用法：
//   node --experimental-strip-types scripts/demo.ts > demo.json          备份文件，可在设置里「从备份恢复」
//   node --experimental-strip-types scripts/demo.ts --sql > demo.sql     直接写库：wrangler d1 execute DB --file demo.sql
//   加 --lang zh-CN 等：界面语言、分类名、本位币按该语言来（官网截图用）
import { readFileSync } from 'node:fs';
import { demoState } from '../shared/demo.ts';

const { subscriptions, methods, people, settings } = demoState(new Date().toISOString().slice(0, 10));

// CLI 仍供官网截图、普通部署的示例备份使用，沿用公开页与 AI 接入的展示开关。
settings.publicView = true;
settings.aiEnabled = true;

// 指定语言时：分类名换成该语言的内置分类名，本位币换成当地货币
const LANG = process.argv[process.argv.indexOf('--lang') + 1];
if (process.argv.includes('--lang') && LANG) {
  const cats = (lang: string) =>
    (JSON.parse(readFileSync(new URL(`../shared/locales/${lang}/core.json`, import.meta.url), 'utf8')) as { category: Record<string, string> }).category;
  const en = cats('en');
  const to = cats(LANG);
  const rename = new Map(Object.entries(en).map(([code, name]) => [name, to[code] ?? name]));
  for (const s of subscriptions) s.category = rename.get(s.category) ?? s.category;
  const CCY: Record<string, string> = {
    'zh-CN': 'CNY',
    'zh-TW': 'TWD',
    'zh-HK': 'HKD',
    ja: 'JPY',
    ko: 'KRW',
    de: 'EUR',
    fr: 'EUR',
    es: 'EUR',
    'pt-BR': 'BRL',
    ru: 'RUB',
    tr: 'TRY',
    id: 'IDR',
    vi: 'VND',
  };
  settings.language = LANG;
  settings.baseCurrency = CCY[LANG] ?? 'USD';
}

const backup = { format: 'calends-backup', version: 3, exportedAt: new Date().toISOString(), subscriptions, methods, people, settings, fxDaily: [] };

if (process.argv.includes('--sql')) {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const rows = [
    'DELETE FROM subscriptions;',
    'DELETE FROM methods;',
    ...subscriptions.map((s) => `INSERT INTO subscriptions (id, data) VALUES (${q(s.id)}, ${q(JSON.stringify(s))});`),
    ...methods.map((m) => `INSERT INTO methods (id, data) VALUES (${q(m.id)}, ${q(JSON.stringify(m))});`),
    `INSERT INTO kv (key, value) VALUES ('settings', ${q(JSON.stringify(settings))}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    `INSERT INTO kv (key, value) VALUES ('people', ${q(JSON.stringify(people))}) ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
  ];
  console.log(rows.join('\n'));
} else {
  console.log(JSON.stringify(backup, null, 2));
}
