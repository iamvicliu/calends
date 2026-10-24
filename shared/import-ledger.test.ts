import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import initSqlJs from 'sql.js';
import { zipSync } from 'fflate';
import { readImportBackup, IMPORT_LIMIT } from './import-backup.ts';
import { readImportCsv, prepareImport, readImportTables } from './import-ledger.ts';
import { importSubscriptionsCsv } from './csv.ts';
import { chargesBetween, subError } from './billing.ts';
import { setLocale, flatten } from './i18n.ts';
import { maskForPublic } from './mask.ts';
import { DEFAULT_SETTINGS } from './types.ts';

setLocale(
  'en',
  ['core', 'mcp'].map((ns) => flatten(ns, JSON.parse(readFileSync(new URL(`./locales/en/${ns}.json`, import.meta.url), 'utf8')))),
);
const today = '2026-10-24';
const head = 'Name,Payment Cycle,Next Payment,Renewal,Category,Payment Method,Paid By,Price,Notes,URL,State,Notifications,Cancellation Date,Active';
const csv = head + '\nExample Cloud,Yearly,2026-12-01,Automatic,Tools,Example Card,Demo,$120,,https://example.test,Disabled,Disabled,,No';

test('foreign CSV requires currency review, preserves annual cycle, next date, inactive status and URL', () => {
  assert.throws(() => importSubscriptionsCsv(csv, [], today), /Import data/);
  const source = readImportCsv(csv, [], today);
  const unresolved = prepareImport(source, [], today);
  assert.equal(unresolved.subscriptions.length, 0);
  assert.equal(unresolved.issues.length, 1);
  const result = prepareImport(source, [], today, { '0': { currency: 'USD' } });
  assert.equal(result.issues.length, 0);
  const sub = result.subscriptions[0];
  assert.deepEqual(sub.cycle, { unit: 'year', every: 1 });
  assert.equal(sub.price, 120);
  assert.equal(sub.currency, 'USD');
  assert.equal(sub.nextDue, '2026-12-01');
  assert.equal(sub.status, 'paused');
  assert.equal(sub.remindDays, -1);
  assert.equal(sub.url, 'https://example.test');
  assert.equal(sub.start, today);
  assert.match(sub.notes!, /unknown/);
  assert.match(sub.notes!, /Demo/);
  const withCancellation = readImportCsv(csv.replace('Disabled,Disabled,,No', 'Disabled,Disabled,2026-11-29,No'), [], today);
  assert.match(prepareImport(withCancellation, [], today, { '0': { currency: 'USD' } }).subscriptions[0].notes!, /Cancel by: 2026-11-29/);
  assert.equal(subError(sub), undefined);
});

test('CSV symbols, zero, quoted notes and same-name rows retain separate identities', () => {
  const source = readImportCsv(
    head +
      '\nSame,Every 3 Months,2026-12-01,Automatic,Tools,,Demo,€0,"first, note",,Enabled,Enabled,,Yes\nSame,Monthly,2026-12-01,Automatic,Tools,,Demo,£9,,,Enabled,Enabled,,Yes',
    [],
    today,
  );
  const p = prepareImport(source, [], today);
  assert.equal(p.issues.length, 0);
  assert.equal(p.subscriptions.length, 2);
  assert.notEqual(p.subscriptions[0].id, p.subscriptions[1].id);
  assert.deepEqual(
    p.subscriptions.map((s) => s.currency),
    ['EUR', 'GBP'],
  );
  assert.equal(p.subscriptions[0].price, 0);
  assert.equal(p.subscriptions[0].cycle.every, 3);
  assert.equal(p.subscriptions[0].notes!.split('\n')[0], 'first, note');
});

test('invalid amounts/cycles and unsupported currencies block import until corrected', () => {
  const source = readImportCsv(head + '\nExample,Unknown,2026-12-01,Automatic,Tools,,Demo,$oops,,,Enabled,Enabled,,Yes', [], today);
  assert.ok(prepareImport(source, [], today).issues.length);
  assert.ok(prepareImport(source, [], today, { '0': { currency: 'ZZZ', cycle: { unit: 'month', every: 1 }, price: 12 } }, undefined, ['USD']).issues.length);
  const good = prepareImport(source, [], today, { '0': { currency: 'USD', cycle: { unit: 'month', every: 1 }, price: 12 } }, undefined, ['USD']);
  assert.equal(good.issues.length, 0);
  assert.equal(good.subscriptions[0].price, 12);
  assert.throws(() => readImportCsv('unrecognized,headers\na,b', [], today));
  const malformedDate = readImportCsv(csv.replace('2026-12-01', '2026-02-30'), [], today);
  // 下次扣款日没有修正入口：不合法时不导入这一项、原值进备注，不拦下整行
  const dropped = prepareImport(malformedDate, [], today, { '0': { currency: 'USD' } });
  assert.equal(dropped.issues.length, 0);
  assert.equal(dropped.subscriptions[0].nextDue, undefined);
  assert.match(dropped.subscriptions[0].notes!, /2026-02-30/);
  const unsafeUrl = readImportCsv(csv.replace('https://example.test', 'javascript:alert(1)'), [], today);
  assert.equal(prepareImport(unsafeUrl, [], today, { '0': { currency: 'USD' } }).subscriptions[0].url, undefined);
});

const SQL = await initSqlJs({ locateFile: () => new URL('../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url).pathname });
function backup() {
  const db = new SQL.Database();
  db.run(`CREATE TABLE user(id INTEGER, username TEXT, password TEXT, api_key TEXT);
CREATE TABLE currencies(id INTEGER, code TEXT);
CREATE TABLE subscriptions(id INTEGER, user_id INTEGER, name TEXT, price REAL, currency_id INTEGER, cycle INTEGER, frequency INTEGER, start_date TEXT, next_payment TEXT, inactive INTEGER, auto_renew INTEGER, category_id INTEGER, payment_method_id INTEGER, payer_user_id INTEGER, notes TEXT, url TEXT, logo TEXT, notify INTEGER, notify_days_before INTEGER);
CREATE TABLE categories(id INTEGER, name TEXT);
CREATE TABLE household(id INTEGER, name TEXT);
CREATE TABLE payment_methods(id INTEGER, name TEXT);
CREATE TABLE subscription_categories(subscription_id INTEGER, category_id INTEGER);
CREATE TABLE subscription_payers(subscription_id INTEGER, payer_id INTEGER);
CREATE TABLE notifications(api_key TEXT);
INSERT INTO user VALUES(1,'Personal','NEVER_IMPORT_ME','NEVER_IMPORT_ME'),(2,'Work','NEVER_IMPORT_ME','NEVER_IMPORT_ME');
INSERT INTO currencies VALUES(1,'USD'),(2,'CAD');
INSERT INTO subscriptions VALUES(10,1,'ChatGPT',20,1,3,1,'2020-01-01','2026-11-01',0,1,1,1,1,'Personal note','https://example.test','logo.png',1,3),(11,2,'ChatGPT',25,2,3,1,'2022-01-01','2026-11-02',0,0,1,1,1,'Work note','https://example.test',NULL,0,0);
INSERT INTO categories VALUES(1,'Tools'),(2,'Work');
INSERT INTO household VALUES(1,'Fictional member');
INSERT INTO payment_methods VALUES(1,'Example Card');
INSERT INTO subscription_categories VALUES(10,1),(10,2);
INSERT INTO subscription_payers VALUES(10,1);
INSERT INTO notifications VALUES('NEVER_IMPORT_ME');`);
  const bytes = db.export();
  db.close();
  return bytes;
}

test('offline ZIP/SQLite reads only business fields, preserves ownership/currencies, and requires owner selection', () => {
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64'));
  const files = zipSync({ 'wallos.db': backup(), 'logos/logo.png': png, 'private-config.txt': new TextEncoder().encode('NEVER_IMPORT_ME') });
  const source = readImportBackup(files, (bytes) => new SQL.Database(bytes));
  assert.equal(source.users.length, 2);
  assert.equal(source.rows.length, 2);
  assert.ok(!JSON.stringify(source).includes('NEVER_IMPORT_ME'));
  assert.equal(prepareImport(source, [], today).subscriptions.length, 0);
  const personal = prepareImport(source, [], today, {}, '1');
  const work = prepareImport(source, [], today, {}, '2');
  assert.equal(personal.subscriptions[0].currency, 'USD');
  assert.equal(work.subscriptions[0].currency, 'CAD');
  assert.equal(personal.subscriptions[0].start, '2020-01-01');
  assert.equal(personal.subscriptions[0].nextDue, '2026-11-01');
  assert.deepEqual(personal.subscriptions[0].tags, ['Work']);
  assert.match(personal.subscriptions[0].notes!, /Fictional member/);
  assert.match(personal.subscriptions[0].icon!, /^data:image\/png;base64,/);
  assert.equal(work.subscriptions[0].status, 'paused');
  assert.equal(personal.subscriptions[0].remindDays, 3);
  assert.equal(work.subscriptions[0].remindDays, -1);
  assert.equal(readImportBackup(backup(), (bytes) => new SQL.Database(bytes)).rows.length, 2);
});

test('imported records do not reconstruct payments before import, but retain explicit payments and future forecasts', () => {
  const source = readImportBackup(backup(), (bytes) => new SQL.Database(bytes));
  const sub = prepareImport(source, [], today, {}, '1').subscriptions[0];
  assert.equal(chargesBetween(sub, '2020-01-01', '2026-10-23', today).length, 0);
  assert.equal(chargesBetween(sub, today, '2026-11-30', today)[0].date, '2026-11-01');
  const recorded = { ...sub, payments: [{ date: '2026-09-01', amount: 7 }] };
  assert.equal(chargesBetween(recorded, '2020-01-01', '2026-10-23', today)[0].amount, 7);
  const phased = { ...sub, phases: [{ start: sub.start, price: 20, currency: 'USD', cycle: sub.cycle, nextDue: sub.nextDue }] };
  assert.equal(chargesBetween(phased, '2020-01-01', '2026-10-23', today).length, 0);
  const masked = maskForPublic({ subscriptions: [sub], methods: [], settings: DEFAULT_SETTINGS, fx: { base: 'USD', rates: { USD: 1 }, fetchedAt: '' } });
  assert.equal(masked.subscriptions[0].estimateFrom, today);
  assert.equal(chargesBetween(masked.subscriptions[0], '2020-01-01', '2026-10-23', today).length, 0);
});

test('corrupt, ambiguous, pending-WAL and oversized backups fail without returning an empty ledger', () => {
  const open = (bytes: Uint8Array) => new SQL.Database(bytes);
  assert.throws(() => readImportBackup(new Uint8Array([1, 2, 3]), open));
  assert.throws(() => readImportBackup(zipSync({ 'a/wallos.db': backup(), 'b/wallos.db': backup() }), open));
  assert.throws(() => readImportBackup(zipSync({ 'wallos.db': backup(), 'wallos.db-wal': new Uint8Array([1]) }), open), /pending/);
  assert.throws(() => readImportBackup(new Uint8Array(IMPORT_LIMIT + 1), open), /32 MB/);
  const invalid = new SQL.Database();
  invalid.run('CREATE TABLE unrelated(id INTEGER)');
  assert.throws(() => readImportBackup(invalid.export(), open));
  invalid.close();
  const source = readImportTables({
    subscriptions: [{ id: 1, name: 'Example', price: null, cycle: 3, frequency: 1, currency_id: 1 }],
    currencies: [{ id: 1, code: 'USD' }],
  });
  assert.ok(prepareImport(source, [], today).issues.length);
});

test('existing CSV remains compatible with dates, tags and referenced payment methods', () => {
  const source = readImportCsv(
    'Name,Currency,Price,Category,Cycle,Starts,Ends,Tags,Payment Account,URL,Notes\nExample,USD,10,Tools,Monthly,01/15/2025,12/31/2027,work,My Card,https://example.test,Note',
    [],
    today,
  );
  const existing = [{ id: 'my-card', name: 'My Card', kind: 'credit' as const, currency: 'USD' }];
  const result = prepareImport(source, existing, today);
  assert.equal(result.subscriptions[0].start, '2025-01-15');
  assert.equal(result.subscriptions[0].end, '2027-12-31');
  assert.equal(result.subscriptions[0].methodId, 'my-card');
  assert.equal(result.created.length, 0);
  assert.deepEqual(result.subscriptions[0].tags, ['work']);
  const closed = readImportCsv(
    'Name,Currency,Price,Cycle,Starts,Ends,Payment Account\nExample,USD,10,Monthly,01/15/2025,12/31/2025,My Card',
    [{ ...existing[0], currency: 'CNY' }],
    today,
  );
  const preserved = prepareImport(closed, [{ ...existing[0], currency: 'CNY' }], today);
  assert.equal(preserved.subscriptions[0].status, 'cancelled');
  assert.equal(preserved.subscriptions[0].methodId, 'my-card');
  assert.equal(preserved.methods[0].kind, 'credit');
  assert.equal(preserved.methods[0].currency, 'CNY');
  assert.equal(preserved.created.length, 0);
});

test('本站与 iOS 导出的 CSV 不设导入边界：历史扣款照常推算；Wallos 等外部来源才设', () => {
  // 本站格式（旧路径）：2023-01-05 起的月付，导入后历史推算应与直接录入一致
  const own = prepareImport(readImportCsv('Name,Currency,Price,Category,Cycle,Starts\nNetflix,USD,10,Video,Monthly,2023-01-05', [], today), [], today);
  const sub = own.subscriptions[0];
  assert.equal(sub.estimateFrom, undefined);
  assert.ok(chargesBetween(sub, '2023-01-01', today, today).filter((c) => !c.projected).length >= 45);
  // Wallos 导出：仍从导入日起算
  const wallos = prepareImport(readImportCsv(csv, [], today), [], today, { '0': { currency: 'USD' } });
  assert.equal(wallos.subscriptions[0].estimateFrom, today);
});

test('同名支付方式付不同币种时复用同一个钱包，不新建同名钱包', () => {
  const rows =
    head +
    '\nA Cloud,Monthly,2026-12-01,Automatic,Tools,Shared Card,Demo,$10,,,Enabled,Disabled,,Yes\nB Cloud,Monthly,2026-12-01,Automatic,Tools,Shared Card,Demo,€10,,,Enabled,Disabled,,Yes';
  const existing = [{ id: 'mine', name: 'Shared Card', kind: 'credit' as const, currency: 'CNY' }];
  const result = prepareImport(readImportCsv(rows, existing, today), existing, today, { '0': { currency: 'USD' } });
  assert.equal(result.created.length, 0);
  assert.ok(result.subscriptions.every((s) => s.methodId === 'mine'));
});

test('下次扣款日、结束日格式不对时不再整行拦下：不导入这两项，原值写进备注', () => {
  const bad = csv.replace('2026-12-01', 'someday');
  const result = prepareImport(readImportCsv(bad, [], today), [], today, { '0': { currency: 'USD' } });
  assert.equal(result.issues.length, 0);
  assert.equal(result.subscriptions[0].nextDue, undefined);
  assert.match(result.subscriptions[0].notes!, /someday/);
});
