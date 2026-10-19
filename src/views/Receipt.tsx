import { useState } from 'preact/hooks';
import { totals } from '../../shared/billing.ts';
import { money } from '../../shared/format.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { Seg, Sheet, SubIcon } from '../components/ui.tsx';
import { allCharges, earliest, periodRange, toBase } from '../derive.ts';

type Range = 'month' | 'year' | 'all';

export function Receipt({ state, today, onClose }: { state: AppState; today: string; onClose: () => void }) {
  const [range, setRange] = useState<Range>('month');
  const base = state.settings.baseCurrency;
  const [from, to] = range === 'all' ? [earliest(state) ?? today, today] : periodRange(range, today);
  const title = range === 'month' ? `${today.slice(0, 4)}.${today.slice(5, 7)} RECEIPT` : range === 'year' ? `${today.slice(0, 4)} RECEIPT` : 'ALL TIME RECEIPT';
  const charges = allCharges(state, from, to, today);
  // 同一订阅合并成一行
  const lines = new Map<string, { sub: Subscription; n: number; sum: number }>();
  const cats = new Map<string, number>();
  for (const c of charges) {
    const v = toBase(state, c.amount, c.currency);
    const l = lines.get(c.sub.id) ?? { sub: c.sub, n: 0, sum: 0 };
    l.n++;
    l.sum += v;
    lines.set(c.sub.id, l);
    cats.set(c.sub.category, (cats.get(c.sub.category) ?? 0) + v);
  }
  const rows = [...lines.values()].sort((a, b) => a.sub.name.localeCompare(b.sub.name, 'zh'));
  const total = rows.reduce((a, r) => a + r.sum, 0);
  const t = totals(state, today);
  const cashback = charges.reduce((a, c) => {
    const m = state.methods.find((x) => x.id === c.sub.methodId);
    return a + (m?.cashback ? (toBase(state, c.amount, c.currency) * m.cashback) / 100 : 0);
  }, 0);
  return (
    <Sheet narrow title="账单小票" onClose={onClose}>
      <div class="stack">
        <Seg
          value={range}
          onChange={setRange}
          options={[
            ['month', '本月'],
            ['year', '今年'],
            ['all', '全部'],
          ]}
        />
        <div class="receipt-wrap">
          <div class="receipt">
            <h4>SUBSCRIPTION LEDGER</h4>
            <div class="c">{title}</div>
            <div class="hr" />
            <div class="l b">
              <span>TOTAL DUE:</span>
              <span class="dots" style={{ border: 0 }} />
              <span>{money(total, base)}</span>
            </div>
            <div class="l b">
              <span>负 MRR:</span>
              <span class="dots" style={{ border: 0 }} />
              <span>{money(-t.mrr, base)}</span>
            </div>
            {cashback > 0 && (
              <div class="l b">
                <span>REWARDS:</span>
                <span class="dots" style={{ border: 0 }} />
                <span>{money(cashback, base)}</span>
              </div>
            )}
            <div class="hr" />
            {[...cats.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div key={k} class="l">
                  <span>{k}</span>
                  <span class="dots" style={{ border: 0 }} />
                  <span>{total > 0 ? Math.round((v / total) * 100) : 0}%</span>
                </div>
              ))}
            <div class="hr" />
            <div class="c" style={{ fontSize: 12.5 }}>
              SUBSCRIPTIONS
            </div>
            <div class="c" style={{ fontWeight: 500, marginBottom: 8 }}>
              {rows.length} ITEMS · {charges.length} CHARGES
            </div>
            {rows.length === 0 && <div class="c">— 没有扣款 —</div>}
            {rows.map((r) => (
              <div key={r.sub.id} class="l">
                <SubIcon sub={r.sub} size={15} />
                <span>
                  {r.sub.name}
                  {r.n > 1 ? ` ×${r.n}` : ''}
                </span>
                <span class="dots" />
                <span>{money(r.sum, base)}</span>
              </div>
            ))}
            <div class="hr" />
            <div class="l b" style={{ fontSize: 14 }}>
              <span>TOTAL</span>
              <span class="dots" style={{ border: 0 }} />
              <span>{money(total, base)}</span>
            </div>
            <div class="hr" />
            <div class="c" style={{ fontSize: 12 }}>
              TIP
            </div>
            <div class="tip-row" style={{ marginTop: 4 }}>
              <span>☐ 20%</span>
              <span>☐ 30%</span>
              <span>☐ 40%</span>
              <span>☐ 50%</span>
            </div>
            <div class="hr" />
            <div class="c" style={{ marginTop: 6 }}>
              THANK YOU FOR YOUR
              <br />
              SUBSCRIPTIONS
            </div>
            <div class="c" style={{ fontWeight: 500, marginTop: 10 }}>
              calends.example.com
            </div>
          </div>
        </div>
        <small class="muted" style={{ textAlign: 'center' }}>
          截图即可分享，⌘P 可打印。
        </small>
      </div>
    </Sheet>
  );
}
