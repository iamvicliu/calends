import { IMPORT_LIMIT, readImportCsv, type ImportSource } from '../../shared/import-ledger.ts';
import type { PaymentMethod } from '../../shared/types.ts';
import { t } from '../../shared/i18n.ts';

/** Heavy SQLite/WASM and ZIP parsing are loaded only after a backup is selected. */
export async function readImportFile(file: File, methods: PaymentMethod[], today: string): Promise<ImportSource> {
  if (file.size > IMPORT_LIMIT) throw new Error(t('core.import.tooLarge'));
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return readImportCsv(await file.text(), methods, today);
  const [{ default: initSqlJs }, { default: wasm }, { readImportBackup, ImportError }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
    import('../../shared/import-backup.ts'),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasm });
  try {
    return readImportBackup(new Uint8Array(await file.arrayBuffer()), (data) => new SQL.Database(data));
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new Error(t('core.import.invalid'));
  }
}
