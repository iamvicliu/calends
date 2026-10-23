import { validatePeopleAvatars } from './avatar.ts';
// Ledger references and non-secret settings. Pure functions; no storage or platform APIs.
import { categoryList, cleanCategories, renameInSubs, type Category } from './categories.ts';
import { mergePeople, refsFor, syncPerson } from './people.ts';
import { channelsOf, DEFAULT_SETTINGS, type AppState, type PaymentMethod, type Person, type Settings, type Subscription } from './types.ts';
import { PREF_KEYS, mergePrefs } from './prefs.ts';
import { isLocale, t } from './i18n.ts';
import { collectionAnchor, validDay } from './billing.ts';
import { objectSchema, textSchema, daySchema, nullable } from './tool-schema.ts';

export const METHOD_FIELDS = objectSchema({
  name: textSchema,
  kind: {
    type: 'string',
    enum: ['debit', 'credit', 'alipay', 'wechat', 'paypal', 'appstore', 'googleplay', 'giftcard', 'prepaid', 'phone', 'crypto', 'other'],
  },
  currency: textSchema,
  balance: nullable({ type: 'number' }),
  balanceAsOf: nullable(daySchema),
  ...Object.fromEntries(['last4', 'color', 'region', 'notes', 'brand', 'logo', 'bank', 'phone', 'url'].map((k) => [k, nullable(textSchema)])),
  network: nullable({ type: 'string', enum: ['visa', 'mastercard', 'unionpay', 'jcb', 'american-express', 'discover', 'diners', 'maestro'] }),
  logoWide: { type: 'boolean' },
  order: { type: 'integer', minimum: 0 },
  lowRunwayDays: nullable({ type: 'number', minimum: 0 }),
  cashback: nullable({ type: 'number', minimum: 0 }),
});
export const TOP_UP_FIELDS = objectSchema({
  date: daySchema,
  amount: { type: 'number', minimum: 0 },
  cost: nullable({ type: 'number', minimum: 0 }),
  costCurrency: nullable(textSchema),
  note: nullable(textSchema),
});
export const SETTINGS_FIELDS = objectSchema({
  baseCurrency: textSchema,
  collectCurrency: nullable(textSchema),
  defaultMethodId: nullable(textSchema),
  signedAmounts: { type: 'boolean' },
  remindDays: { type: 'integer', minimum: -1, maximum: 365 },
  notifyHour: { type: 'integer', minimum: 0, maximum: 23 },
  timezone: textSchema,
  publicView: { type: 'boolean' },
  publicHidden: nullable({ type: 'array', items: textSchema }),
  monthlyDigest: { type: 'boolean' },
  displayName: textSchema,
  avatar: nullable(textSchema),
  publicTitle: nullable(textSchema),
  sidebarUpcoming: { type: 'boolean' },
  upcomingDays: { type: 'integer', minimum: 0 },
  hiddenNav: nullable({ type: 'array', items: textSchema }),
  navOrder: nullable({ type: 'array', items: textSchema }),
  startPage: nullable(textSchema),
  weekStart: { type: 'integer', enum: [0, 1] },
  language: nullable(textSchema),
});
export const PREF_FIELDS = objectSchema(Object.fromEntries(PREF_KEYS.map((k) => [k, nullable(textSchema)])));
export const excludedAccess =
  'Never exposes or changes authentication, passwords, Passkeys, sessions, MCP tokens, backup/restore/reset/migration, whole-ledger deletion, or outbound notification credentials. Channel access is limited to existing channel enable switches; no config/address/secret fields.';

export function applyFields<T extends object>(current: T, patch: Record<string, unknown>): T {
  const next = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as T;
}
export const referenceSummary = (subs: Subscription[]) => subs.map((s) => ({ id: s.id, name: s.name }));
export function requireMigration(references: unknown[], into: string | undefined): void {
  if (references.length && !into) throw new Error(t('mcp.error.references', { references: JSON.stringify(references) }));
}
export function methodReferences(st: AppState, id: string) {
  return [
    ...st.subscriptions.flatMap((s) => [
      ...(s.methodId === id ? [{ subscription: s.id, name: s.name, kind: 'subscription' }] : []),
      ...(s.phases ?? [])
        .filter((p) => p.methodId === id)
        .map((p) => ({ subscription: s.id, name: s.name, kind: 'phase', start: p.start, payments: p.payments?.length ?? 0 })),
    ]),
    ...(st.settings.defaultMethodId === id ? [{ kind: 'default_method' }] : []),
  ];
}
export function deleteMethodData(st: AppState, id: string, into?: string) {
  const references = methodReferences(st, id);
  if (into === id || (into && !st.methods.some((m) => m.id === into))) throw new Error(t('mcp.error.invalidTarget'));
  requireMigration(references, into);
  const subscriptions = st.subscriptions
    .filter((s) => s.methodId === id || s.phases?.some((p) => p.methodId === id))
    .map((s) => ({
      ...s,
      methodId: s.methodId === id ? into : s.methodId,
      phases: s.phases?.map((p) => (p.methodId === id ? { ...p, methodId: into } : p)),
    }));
  return { references, subscriptions, settings: st.settings.defaultMethodId === id ? { ...st.settings, defaultMethodId: into } : st.settings };
}
export function categoryEdit(st: AppState, action: string, ref: string | undefined, patch: Partial<Category>, into?: string, order?: string[]) {
  let categories = categoryList(st.settings, st.subscriptions);
  const old = categories.find((c) => c.name === ref);
  if (action !== 'create' && action !== 'reorder' && !old) throw new Error(t('mcp.error.invalidTarget'));
  const references = referenceSummary(st.subscriptions.filter((s) => s.category === ref));
  const renames: Record<string, string> = Object.create(null);
  if (action === 'reorder') {
    if (!order || order.length !== categories.length || new Set(order).size !== categories.length || order.some((n) => !categories.some((c) => c.name === n)))
      throw new Error(t('mcp.error.invalidTarget'));
    categories = order.map((n) => categories.find((c) => c.name === n)!);
  } else if (action === 'delete') {
    if (into === ref || (into && !categories.some((c) => c.name === into))) throw new Error(t('mcp.error.invalidTarget'));
    requireMigration(references, into);
    categories = categories.filter((c) => c !== old);
    if (into && ref) renames[ref] = into;
  } else {
    const next = applyFields(old ?? {}, patch) as Category;
    if (action === 'create') categories = [...categories, next];
    else {
      categories = categories.map((c) => (c === old ? next : c));
      if (next.name !== ref) renames[ref!] = next.name;
    }
  }
  const cleaned = cleanCategories(categories);
  if ('error' in cleaned) throw new Error(cleaned.error);
  return { categories: cleaned.list, subscriptions: renameInSubs(st.subscriptions, renames), references };
}
export function personReferences(st: AppState, id: string) {
  return refsFor(st.subscriptions, id).map((r) => ({
    subscription: r.sub.id,
    name: r.sub.name,
    kind: r.kind,
    ...(r.kind === 'member' ? { member: r.member.id } : {}),
  }));
}
export function personEdit(st: AppState, person: Person, deleting: boolean, into?: string) {
  const references = personReferences(st, person.id);
  if (deleting) {
    if (into === person.id || (into && !(st.people ?? []).some((p) => p.id === into))) throw new Error(t('mcp.error.invalidTarget'));
    requireMigration(references, into);
    const result = into
      ? mergePeople(st.people ?? [], st.subscriptions, person.id, into)
      : { people: (st.people ?? []).filter((p) => p.id !== person.id), subs: [] };
    return { people: result.people, subscriptions: result.subs, references };
  }
  if (!person.name.trim()) throw new Error(t('mcp.error.invalidInput', { field: 'name' }));
  const people = [...(st.people ?? []).filter((p) => p.id !== person.id), person];
  validatePeopleAvatars(people);
  return { people, subscriptions: syncPerson(st.subscriptions, person), references };
}
export function validateCurrency(st: AppState, code: string): void {
  if (!/^[A-Z]{3}$/.test(code) || !(st.fx.rates[code] > 0)) throw new Error(t('mcp.error.unsupportedCurrency', { code }));
}
export function validateMethod(st: AppState, m: PaymentMethod): void {
  if (!m.name?.trim()) throw new Error(t('mcp.error.invalidInput', { field: 'name' }));
  validateCurrency(st, m.currency);
}
export function safeSettings(st: AppState) {
  return {
    settings: Object.fromEntries(
      Object.keys(SETTINGS_FIELDS.properties!)
        .filter((k) => k in st.settings)
        .map((k) => [k, st.settings[k as keyof Settings]]),
    ),
    channels: channelsOf(st.settings).map((c) => ({ id: c.id, kind: c.kind, name: c.name, enabled: c.enabled })),
    prefs: Object.fromEntries(PREF_KEYS.filter((k) => st.prefs?.[k] !== undefined).map((k) => [k, st.prefs![k]])),
  };
}
export function settingsEdit(
  st: AppState,
  patch: Record<string, unknown>,
  switches: Array<{ id: string; enabled: boolean }> = [],
  prefs: Record<string, string | null> = {},
) {
  const settings = { ...DEFAULT_SETTINGS, ...applyFields(st.settings, patch) };
  validateCurrency(st, settings.baseCurrency);
  if (settings.collectCurrency) validateCurrency(st, settings.collectCurrency);
  if (settings.defaultMethodId && !st.methods.some((m) => m.id === settings.defaultMethodId)) throw new Error(t('mcp.error.invalidTarget'));
  try {
    new Intl.DateTimeFormat('en', { timeZone: settings.timezone }).format();
  } catch {
    throw new Error(t('mcp.error.invalidInput', { field: 'timezone' }));
  }
  if (settings.language && !isLocale(settings.language)) throw new Error(t('mcp.error.invalidInput', { field: 'language' }));
  if (settings.publicHidden?.some((id) => !st.subscriptions.some((s) => s.id === id))) throw new Error(t('mcp.error.invalidTarget'));
  if (settings.avatar && (!/^(https?:\/\/|data:image\/(png|jpeg|webp|gif|svg\+xml);base64,)/.test(settings.avatar) || settings.avatar.length > 300000))
    throw new Error(t('mcp.error.invalidInput', { field: 'avatar' }));
  if (switches.length) {
    const channels = channelsOf(settings);
    if (new Set(switches.map((x) => x.id)).size !== switches.length || switches.some((x) => !channels.some((c) => c.id === x.id)))
      throw new Error(t('mcp.error.invalidTarget'));
    settings.channels = channels.map((c) => ({ ...c, enabled: switches.find((x) => x.id === c.id)?.enabled ?? c.enabled }));
  }
  return { settings, prefs: mergePrefs(st.prefs ?? {}, prefs) };
}

// Replace/delete one indexed record, with optional optimistic snapshot protection.
export function editRecord<T>(records: T[], index: number, replacement: T | undefined, expected?: T): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= records.length) throw new Error(t('mcp.error.invalidTarget'));
  if (expected !== undefined && JSON.stringify(expected) !== JSON.stringify(records[index])) throw new Error(t('mcp.error.staleRecord'));
  return records.flatMap((x, i) => (i === index ? (replacement === undefined ? [] : [replacement]) : [x]));
}

/** Revise or remove one actual share receipt or proxy entry. No inferred fallback on a failed lookup. */
export function reviseReceivable(st: AppState, s: AppState['subscriptions'][number], a: Record<string, unknown>) {
  if (a.kind === 'proxy') {
    if (!s.proxy) throw new Error(t('mcp.error.notProxy', { name: s.name }));
    const index = s.proxy.entries.findIndex((e) => e.charge === a.charge);
    const old = s.proxy.entries[index];
    const next = a.action === 'delete' ? undefined : applyFields(old ?? {}, (a.entry ?? {}) as Record<string, unknown>);
    const entries =
      a.action === 'record' && index < 0 && next
        ? [...s.proxy.entries, { ...next, charge: String(next.charge ?? a.charge) } as typeof old]
        : editRecord(s.proxy.entries, index, next as typeof old | undefined);
    if (entries.some((e) => !validDay(e.charge))) throw new Error(t('mcp.error.invalidTarget'));
    if (next) {
      if (entries.filter((e) => e.charge === (next.charge ?? a.charge)).length > 1) throw new Error(t('mcp.error.invalidTarget'));
      for (const key of ['chargedCurrency', 'receivedCurrency'] as const) if (next[key]) validateCurrency(st, String(next[key]));
    }
    return { after: { ...s, proxy: { ...s.proxy, entries } }, before: old, record: next ?? null };
  }
  const members = s.share?.members ?? [];
  const matches = members.filter((m) => m.id === a.member || m.name === a.member);
  if (matches.length !== 1) throw new Error(t('mcp.error.invalidTarget'));
  const m = matches[0];
  const index = Number(a.index);
  const old = m.payments?.[index];
  const next = a.action === 'delete' ? undefined : (applyFields(old ?? {}, (a.receipt ?? {}) as Record<string, unknown>) as typeof old);
  const payments = editRecord(m.payments ?? [], index, next);
  if (next) {
    validateCurrency(st, next.currency);
    if (next.from && next.from > next.until) throw new Error(t('mcp.error.invalidTarget'));
  }
  // Explicit paid_until can preserve manually known coverage; otherwise removing a receipt retracts its coverage.
  const paidUntil =
    'paid_until' in a
      ? (a.paid_until as string | undefined)
      : payments.reduce<string | undefined>((end, p) => (!end || p.until > end ? p.until : end), undefined);
  return {
    after: {
      ...s,
      share: {
        ...s.share!,
        collectFrom: collectionAnchor(s),
        members: members.map((x) => (x.id === m.id ? { ...m, payments, paidUntil: paidUntil ?? undefined } : x)),
      },
    },
    before: old,
    record: next ?? null,
  };
}
