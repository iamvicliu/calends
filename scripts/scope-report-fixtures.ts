import { DEFAULT_SETTINGS, type AppState, type Subscription } from '../shared/types.ts';
import { FALLBACK_FX } from '../shared/billing.ts';

export const SCOPE_TODAY = '2026-10-26';
export function scopeFixtures(): Record<string, AppState> {
  const sub = (id: string, extra: Partial<Subscription> = {}): Subscription => ({
    id,
    name: `Kiro Demo ${id}`,
    category: 'Tools',
    tags: ['fictional'],
    price: 120,
    currency: 'USD',
    cycle: { unit: 'year', every: 1 },
    start: '2025-01-01',
    status: 'active',
    methodId: 'card',
    region: 'US',
    ...extra,
  });
  const stop = (id: string, start: string, date: string, paidThrough: string, refund = 0) =>
    sub(id, {
      start,
      end: date,
      status: 'terminated',
      stop: { kind: 'terminate', date, paidThrough, reason: 'Fictional provider shutdown' },
      payments: [{ date: start, amount: 120 }, ...(refund ? [{ date, amount: -refund, kind: 'refund' as const }] : [])],
    });
  const subs = [
    stop('01', '2025-01-01', '2025-02-01', '2025-12-31'),
    stop('02', '2025-03-01', '2025-04-01', '2026-02-28', 120),
    stop('03', '2025-05-01', '2025-06-01', '2026-04-30', 30),
    stop('04', '2025-07-01', '2026-06-30', '2026-06-30'),
    stop('05', '2026-01-01', '2026-06-01', '2026-12-31'),
    stop('06', '2026-04-01', '2026-09-01', '2027-03-31', 120),
    sub('07', { start: '2026-09-10', price: 20, cycle: { unit: 'month', every: 1 }, methodId: 'wallet', region: 'JP', category: 'AI' }),
  ];
  const state = (subscriptions: Subscription[]): AppState => ({
    subscriptions,
    methods: [
      { id: 'card', name: 'Demo Card', kind: 'card', currency: 'USD', balance: 0, color: 'blue' },
      { id: 'wallet', name: 'Demo Wallet', kind: 'gift', currency: 'USD', balance: 0, color: 'orange' },
    ],
    settings: { ...DEFAULT_SETTINGS, baseCurrency: 'USD' },
    fx: FALLBACK_FX,
  });
  return {
    kiro: state(subs),
    stopped: state(subs.slice(0, 6)),
    ordinary: state([
      sub('08', { name: 'Ordinary Demo', start: '2026-01-01' }),
      sub('09', { name: 'Ordinary Stopped', start: '2025-01-01', end: '2025-12-31', status: 'cancelled' }),
    ]),
    single: state([subs[6]]),
    missing: state([...subs.slice(0, 1), sub('10', { name: 'Kiro Demo Missing FX', start: '2026-01-01', currency: 'XCD' })]),
  };
}
