import { useState } from 'preact/hooks';
import { addDays, addMonths, totals } from '../../shared/billing.ts';
import { money } from '../../shared/format.ts';
import type { AppState } from '../../shared/types.ts';
import { Sheet } from '../components/ui.tsx';
import { allCharges, earliest, toBase } from '../derive.ts';

type Range = 'month' | 'next' | 'year' | 'all';

export function Receipt({ state, today, onClose }: { state: AppState; today: string; onClose: () => void }) {
  const [range, setRange] = useState<Range>('month');
  const base = state.settings.baseCurrency;
  const y = today.slice(0, 4);
  const m = today.slice(0, 7);
  const [from, to, title] =
    range === 'month'
      ? [m + '-01', addDays(addMonths(m + '-01', 1), -1), `${y} 年 ${Number(m.slice(5))} 月`]
      : range === 'next'
        ? [today, addDays(today, 29), '未来 30 天']
        : range === 'year'
          ? [`${y}-01-01`, `${y}-12-31`, `${y} 全年`]
          : [earliest(state) ?? today, today, '有史以来'];
  const charges = allCharges(state, from, to, today);
  // 同一订阅合并成一行
  const lines = new Map<string, { name: string; n: number; sum: number }>();
  for (const c of charges) {
    const l = lines.get(c.sub.id) ?? { name: c.sub.name, n: 0, sum: 0 };
    l.n++;
    l.sum += toBase(state, c.amount, c.currency);
    lines.set(c.sub.id, l);
  }
  const rows = [...lines.values()].sort((a, b) => b.sum - a.sum);
  const total = rows.reduce((a, r) => a + r.sum, 0);
  const t = totals(state, today);
  const no = (today.replace(/-/g, '') + String(charges.length).padStart(3, '0')).slice(2);
  return (
    <Sheet narrow title="账单小票" onClose={onClose}>
      <div class="seg-ctl" style={{ marginBottom: 22 }}>
        {(
          [
            ['month', '本月'],
            ['next', '30 天'],
            ['year', '今年'],
            ['all', '全部'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} class={range === k ? 'on' : ''} onClick={() => setRange(k)}>
            {l}
          </button>
        ))}
      </div>
      <div style={{ padding: '10px 4px 18px' }}>
        <div class="receipt">
          <h4>SUBSCRIPTIONS</h4>
          <div class="c">{state.settings.displayName} 的订阅账本</div>
          <div class="c">
            {title} · NO.{no}
          </div>
          <div class="hr" />
          {rows.length === 0 && <div class="c">— 没有扣款 —</div>}
          {rows.map((r) => (
            <div key={r.name} class="l">
              <span>
                {r.name}
                {r.n > 1 ? ` ×${r.n}` : ''}
              </span>
              <span>{money(r.sum, base)}</span>
            </div>
          ))}
          <div class="hr" />
          <div class="l">
            <span>ITEMS</span>
            <span>{charges.length}</span>
          </div>
          <div class="l tot">
            <span>TOTAL</span>
            <span>{money(total, base)}</span>
          </div>
          <div class="hr" />
          <div class="l">
            <span>负 MRR</span>
            <span>{money(-t.mrr, base)}</span>
          </div>
          <div class="l">
            <span>负 ARR</span>
            <span>{money(-t.mrr * 12, base)}</span>
          </div>
          <div class="bar" />
          <div class="c" style={{ marginTop: 10 }}>
            THANK YOU FOR SUBSCRIBING
          </div>
          <div class="c">calends.example.com</div>
        </div>
      </div>
      <small class="soft">截图即可分享；按 ⌘P 可打印。</small>
    </Sheet>
  );
}
