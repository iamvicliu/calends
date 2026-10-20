import type { Cycle, MethodKind, PaymentMethod, Subscription } from './types.ts';
import { uid } from './billing.ts';
import { t } from './i18n.ts';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function toCsvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(toCsvCell).join(',')).join('\n');
}

function parseCycle(s: string): Cycle {
  const t = s.trim().toLowerCase();
  if (t === 'lifetime' || t === 'one time' || t === 'once') return { unit: 'lifetime', every: 1 };
  const map: Record<string, Cycle> = {
    daily: { unit: 'day', every: 1 },
    weekly: { unit: 'week', every: 1 },
    monthly: { unit: 'month', every: 1 },
    quarterly: { unit: 'month', every: 3 },
    yearly: { unit: 'year', every: 1 },
    annually: { unit: 'year', every: 1 },
  };
  if (map[t]) return map[t];
  const m = t.match(/every\s+(\d+)\s+(day|week|month|year)s?/);
  if (m) return { unit: m[2] as Cycle['unit'], every: Number(m[1]) };
  return { unit: 'month', every: 1 };
}

function mdy(s: string): string | undefined {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return s.trim();
  return undefined;
}

function amount(s: string): number {
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 依据账户名称推断类型 */
function guessKind(name: string): MethodKind {
  if (/支付宝|alipay/i.test(name)) return 'alipay';
  if (/微信|wechat/i.test(name)) return 'wechat';
  if (/paypal/i.test(name)) return 'paypal';
  if (/电话卡|手机卡|话费|smart|globe|load/i.test(name)) return 'phone';
  if (/app ?store|apple|礼品卡|余额/i.test(name)) return 'appstore';
  if (/信用卡|credit|visa|master|amex/i.test(name)) return 'credit';
  if (/银行|bank|card|卡/i.test(name)) return 'debit';
  return 'other';
}

const REGION_BY_CCY: Record<string, string> = { TRY: 'TR', NGN: 'NG', PHP: 'PH', INR: 'IN', PKR: 'PK', EGP: 'EG', CNY: 'CN', USD: 'US' };

export interface ImportResult {
  subscriptions: Subscription[];
  /** 要写入的支付方式：新建的加上被引用到的已有的 */
  methods: PaymentMethod[];
  /** 其中新建的 */
  created: PaymentMethod[];
}

/**
 * 导入 Subscriptions（iOS/macOS）导出的 CSV：
 * Name,Currency,Price,Category,Cycle,Starts,Ends,Tags,Payment Account,URL,Notes
 * 也兼容本站导出的 CSV（同名表头）。
 */
export function importSubscriptionsCsv(text: string, existing: PaymentMethod[], today: string): ImportResult {
  const rows = parseCsv(text);
  const head = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  const col = (r: string[], ...names: string[]) => {
    for (const n of names) {
      const i = head.indexOf(n);
      if (i >= 0) return (r[i] ?? '').trim();
    }
    return '';
  };
  const methods = [...existing];
  const created: PaymentMethod[] = [];
  const methodFor = (name: string, ccy: string): string | undefined => {
    let label = name.trim();
    if (!label) {
      // 空账户的外币订阅，多为对应区 App Store 余额（礼品卡）支付
      const region = REGION_BY_CCY[ccy];
      if (!region || region === 'CN' || region === 'US') return undefined;
      label = t('core.csv.appStoreBalance', { region });
    }
    let m = methods.find((x) => x.name === label);
    if (!m) {
      const kind = guessKind(label);
      m = {
        id: uid(),
        name: label,
        kind,
        currency: kind === 'debit' || kind === 'credit' || kind === 'alipay' || kind === 'wechat' ? 'CNY' : ccy,
        region: kind === 'appstore' || kind === 'phone' ? REGION_BY_CCY[ccy] : undefined,
      };
      methods.push(m);
      created.push(m);
    }
    return m.id;
  };
  // 没有名称的行（空行、合计行等）直接跳过，不让整批导入失败
  const subscriptions: Subscription[] = rows
    .filter((r) => col(r, 'name'))
    .map((r) => {
      const ccy = col(r, 'currency').toUpperCase() || 'CNY';
      const start = mdy(col(r, 'starts', 'start')) ?? today;
      const end = mdy(col(r, 'ends', 'end'));
      const cycle = parseCycle(col(r, 'cycle'));
      const tags = col(r, 'tags')
        .split(/[\s,，]+/)
        .filter(Boolean);
      const sub: Subscription = {
        id: uid(),
        name: col(r, 'name'),
        category: col(r, 'category') || t('core.csv.otherCategory'),
        tags,
        price: amount(col(r, 'price')),
        currency: ccy,
        cycle,
        start,
        end,
        status: end && end < today ? 'cancelled' : 'active',
        methodId: methodFor(col(r, 'payment account', 'payment method'), ccy),
        url: col(r, 'url') || undefined,
        notes: col(r, 'notes') || undefined,
        region: REGION_BY_CCY[ccy] !== 'CN' && REGION_BY_CCY[ccy] !== 'US' ? REGION_BY_CCY[ccy] : undefined,
        createdAt: today,
      };
      return sub;
    });
  // 除新建的，也带上被引用到的已有支付方式：「替换全部」会清空支付方式，不带上引用就悬空了
  const used = new Set(subscriptions.map((x) => x.methodId));
  return { subscriptions, methods: methods.filter((m) => created.includes(m) || used.has(m.id)), created };
}
