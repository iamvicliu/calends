import { useMemo, useState } from 'preact/hooks';
import { addDays, addMonths, diffDays, parseDay, type Charge } from '../../shared/billing.ts';
import { cnDate, money, relDays } from '../../shared/format.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { Icon, SubIcon, tipProps } from '../components/ui.tsx';
import { allCharges, toBase } from '../derive.ts';

const DOW = ['一', '二', '三', '四', '五', '六', '日'];

function monthGrid(month: string) {
  const first = month + '-01';
  const dow = (new Date(parseDay(first)).getUTCDay() + 6) % 7; // 周一开头
  const start = addDays(first, -dow);
  const last = addDays(addMonths(first, 1), -1);
  const cells = Math.ceil((dow + Number(last.slice(8))) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => addDays(start, i));
}

export function Calendar({ state, today, onOpen, onIcs }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onIcs: () => void }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [sel, setSel] = useState<string>(today);
  const base = state.settings.baseCurrency;

  const year = month.slice(0, 4);
  const charges = useMemo(() => allCharges(state, `${year}-01-01`, `${year}-12-31`, today), [state, year, today]);
  const byDay = useMemo(() => {
    const m = new Map<string, Charge[]>();
    for (const c of charges) m.set(c.date, [...(m.get(c.date) ?? []), c]);
    return m;
  }, [charges]);
  const sumOf = (list: Charge[] = []) => list.reduce((a, c) => a + toBase(state, c.amount, c.currency), 0);
  const monthCharges = charges.filter((c) => c.date.startsWith(month));
  const monthSum = sumOf(monthCharges);
  const yearSum = sumOf(charges);
  const shift = (n: number) => setMonth(addMonths(month + '-01', mode === 'year' ? n * 12 : n).slice(0, 7));
  const selList = byDay.get(sel) ?? [];

  return (
    <div class="wrap wide fade-in">
      <div class="cal-head">
        <div class="cal-title">
          {mode === 'month' ? `${year} 年 ${Number(month.slice(5))} 月` : `${year} 年`}
          <small>
            {mode === 'month' ? `${monthCharges.length} 笔 · ${money(monthSum, base, { compact: true })}` : `${charges.length} 笔 · ${money(yearSum, base, { compact: true })}`}
          </small>
        </div>
        <div class="seg-ctl">
          <button class={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>
            月
          </button>
          <button class={mode === 'year' ? 'on' : ''} onClick={() => setMode('year')}>
            年
          </button>
        </div>
        <button class="icon-btn" aria-label="上一页" onClick={() => shift(-1)}>
          <Icon name="left" />
        </button>
        <button
          class="btn sm"
          onClick={() => {
            setMonth(today.slice(0, 7));
            setSel(today);
          }}
        >
          今天
        </button>
        <button class="icon-btn" aria-label="下一页" onClick={() => shift(1)}>
          <Icon name="right" />
        </button>
        {!state.readonly && (
          <button class="btn sm" onClick={onIcs}>
            <Icon name="cal" /> 订阅到日历
          </button>
        )}
      </div>

      {mode === 'year' ? (
        <YearHeat
          year={year}
          byDay={byDay}
          today={today}
          sumOf={sumOf}
          base={base}
          onPick={(m) => {
            setMonth(m);
            setMode('month');
          }}
        />
      ) : (
        <>
          <div class="card" style={{ padding: '14px 0 0', overflow: 'hidden' }}>
            <div class="cal-grid">
              {DOW.map((d) => (
                <div key={d} class="cal-dow">
                  {d}
                </div>
              ))}
              {monthGrid(month).map((d) => {
                const list = byDay.get(d) ?? (d.startsWith(year) ? [] : allCharges(state, d, d, today));
                const out = !d.startsWith(month);
                return (
                  <button key={d} class={`cal-cell ${out ? 'out' : ''} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}`} onClick={() => setSel(d)}>
                    <div class="cal-day">
                      <b>{Number(d.slice(8))}</b>
                      {list.length > 0 && <span class="cal-sum">{money(sumOf(list), base, { compact: true })}</span>}
                    </div>
                    <div class="cal-items">
                      {list.slice(0, 3).map((c) => (
                        <div key={c.sub.id} class={`cal-item ${c.date < today ? 'past' : ''}`}>
                          <SubIcon sub={c.sub} size="xs" />
                          <span>{c.sub.name}</span>
                        </div>
                      ))}
                      {list.length > 3 && <span class="cal-more">+{list.length - 3}</span>}
                    </div>
                    <div class="cal-icons">
                      {list.slice(0, 2).map((c) => (
                        <SubIcon key={c.sub.id} sub={c.sub} size="xs" />
                      ))}
                      {list.length > 2 && <span class="cal-more">+{list.length - 2}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ paddingTop: 32 }}>
            <div class="eyebrow">
              {cnDate(sel, true)} · {relDays(diffDays(today, sel))}
            </div>
            <div class="ledger" style={{ marginTop: 14 }}>
              {selList.length === 0 && <div class="empty" style={{ marginTop: 14, padding: 28 }}>这一天没有扣款</div>}
              {selList.map((c) => (
                <button key={c.sub.id} class="row" onClick={() => onOpen(c.sub)}>
                  <SubIcon sub={c.sub} />
                  <div style={{ minWidth: 0 }}>
                    <div class="row-title">{c.sub.name}</div>
                    <div class="row-sub">{state.methods.find((m) => m.id === c.sub.methodId)?.name ?? '未指定支付'}</div>
                  </div>
                  <div class="leader" />
                  <div class="row-amt">
                    <div class="a">{money(c.amount, c.currency)}</div>
                    {c.currency !== base && <div class="b">≈ {money(toBase(state, c.amount, c.currency), base)}</div>}
                  </div>
                  <div class="row-when">
                    <div class="a">{c.projected ? '预计' : '已扣'}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function YearHeat({ year, byDay, today, sumOf, base, onPick }: { year: string; byDay: Map<string, Charge[]>; today: string; sumOf: (l?: Charge[]) => number; base: string; onPick: (m: string) => void }) {
  const max = Math.max(1, ...[...byDay.values()].map((l) => sumOf(l)));
  return (
    <div class="heat">
      {Array.from({ length: 12 }, (_, i) => {
        const m = `${year}-${String(i + 1).padStart(2, '0')}`;
        const grid = monthGrid(m);
        const total = grid.filter((d) => d.startsWith(m)).reduce((a, d) => a + sumOf(byDay.get(d)), 0);
        return (
          <button key={m} class={`heat-m ${today.startsWith(m) ? 'cur' : ''}`} onClick={() => onPick(m)}>
            <div class="heat-h">
              {i + 1} 月<span>{money(total, base, { compact: true })}</span>
            </div>
            <div class="heat-g">
              {grid.map((d) => {
                const list = d.startsWith(m) ? byDay.get(d) : undefined;
                const v = sumOf(list);
                const a = v ? 0.25 + 0.75 * Math.sqrt(v / max) : 0;
                return (
                  <i
                    key={d}
                    style={{
                      visibility: d.startsWith(m) ? 'visible' : 'hidden',
                      background: v ? `color-mix(in srgb, var(--accent) ${Math.round(a * 100)}%, var(--line-2))` : undefined,
                      outline: d === today ? '1.5px solid var(--ink)' : undefined,
                    }}
                    {...(list ? tipProps(() => `${cnDate(d)} · ${list.map((c) => c.sub.name).join('、')} · ${money(v, base, { compact: true })}`) : {})}
                  />
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}
