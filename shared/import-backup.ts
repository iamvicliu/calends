import { ICON_DATA_LIMIT } from './icon.ts';
import { unzipSync } from 'fflate';
import { readImportTables, type ImportSource } from './import-ledger.ts';
import { t } from './i18n.ts';

export const IMPORT_LIMIT = 32 * 1024 * 1024;
const MAX_ROWS = 5000;
interface DatabaseReader {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  close(): void;
}

const columns: Record<string, string[]> = {
  user: ['id', 'username'],
  subscriptions: [
    'id',
    'user_id',
    'name',
    'price',
    'currency_id',
    'cycle',
    'frequency',
    'start_date',
    'next_payment',
    'cancellation_date',
    'inactive',
    'auto_renew',
    'category_id',
    'payment_method_id',
    'payer_user_id',
    'notes',
    'url',
    'logo',
    'notify',
    'notify_days_before',
  ],
  currencies: ['id', 'code'],
  categories: ['id', 'name'],
  payment_methods: ['id', 'name'],
  household: ['id', 'name'],
  subscription_categories: ['subscription_id', 'category_id'],
  subscription_payers: ['subscription_id', 'payer_id'],
};

/** Never extract files to disk, execute source migrations, or read credential columns. */
export function readImportBackup(bytes: Uint8Array, open: (bytes: Uint8Array) => DatabaseReader): ImportSource {
  if (bytes.length > IMPORT_LIMIT) throw new Error(t('core.import.tooLarge'));
  let database = bytes;
  let files: Record<string, Uint8Array> = {};
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let total = 0;
    files = unzipSync(bytes, {
      filter: (file) => {
        const wanted = /(^|\/)wallos\.db(?:-wal)?$/.test(file.name) || /(^|\/)logos\/[^/]+\.(png|jpe?g|webp)$/i.test(file.name);
        if (!wanted) return false;
        if (file.name.startsWith('/') || file.name.split('/').includes('..')) throw new Error(t('core.import.invalid'));
        total += file.originalSize;
        if (file.originalSize > IMPORT_LIMIT || total > IMPORT_LIMIT) throw new Error(t('core.import.tooLarge'));
        return (!file.name.includes('/logos/') && !file.name.startsWith('logos/')) || file.originalSize <= 64 * 1024;
      },
    });
    const names = Object.keys(files).filter((name) => /(^|\/)wallos\.db$/.test(name));
    if (names.length !== 1) throw new Error(t('core.import.invalid'));
    if (Object.entries(files).some(([name, content]) => name.endsWith('wallos.db-wal') && content.length > 0)) throw new Error(t('core.import.pending'));
    database = files[names[0]];
  }
  if (new TextDecoder().decode(database.subarray(0, 16)) !== 'SQLite format 3\0') throw new Error(t('core.import.invalid'));
  const db = open(database);
  try {
    db.exec('PRAGMA query_only = ON');
    const names = new Set(db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.map((r) => String(r[0])) ?? []);
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    for (const [table, allow] of Object.entries(columns)) {
      if (!names.has(table)) continue;
      const info = db.exec(`PRAGMA table_info("${table}")`)[0];
      const available = new Set(info?.values.map((r) => String(r[1])) ?? []);
      const select = allow.filter((column) => available.has(column));
      if (!select.length) throw new Error(t('core.import.invalid'));
      const result = db.exec(`SELECT ${select.map((c) => `"${c}"`).join(',')} FROM "${table}" LIMIT ${MAX_ROWS + 1}`)[0];
      if ((result?.values.length ?? 0) > MAX_ROWS) throw new Error(t('core.import.tooLarge'));
      tables[table] = result?.values.map((row) => Object.fromEntries(result.columns.map((c, i) => [c, row[i]]))) ?? [];
    }
    const source = readImportTables(tables);
    for (const row of source.rows) {
      const record = tables.subscriptions.find((r) => String(r.id) === row.key);
      const logo = String(record?.logo ?? '')
        .split('/')
        .pop();
      const entry = Object.entries(files).find(([path]) => logo && (path === `logos/${logo}` || path.endsWith(`/logos/${logo}`)));
      if (!entry) continue;
      const data = entry[1];
      const mime =
        data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71
          ? 'image/png'
          : data[0] === 255 && data[1] === 216
            ? 'image/jpeg'
            : new TextDecoder().decode(data.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(data.subarray(8, 12)) === 'WEBP'
              ? 'image/webp'
              : undefined;
      // 超过上限的 logo 不导入，图标退回官网图标或首字母
      if (mime && data.length <= ICON_DATA_LIMIT) row.icon = `data:${mime};base64,${btoa(Array.from(data, (b) => String.fromCharCode(b)).join(''))}`;
    }
    return source;
  } finally {
    db.close();
  }
}
