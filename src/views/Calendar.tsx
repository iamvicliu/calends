import { useMemo, useState } from 'preact/hooks';
import { addDays, addMonths, diffDays, parseDay, type Charge } from '../../shared/billing.ts';
import { cnDate, money, relDays } from '../../shared/format.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { Amount, Cell, Group, Icon, PayBadge, Seg, SubIcon, tipProps, Toolbar } from '../components/ui.tsx';
import { chargeValue } from '../../shared/fx.ts';
import { allCharges, sumBase } from '../derive.ts';

const DOW_MON = ['一', '二', '三', '四', '五', '六', '日'];
const DOW_SUN = ['日', '一', '二', '三', '四', '五', '六'];
/** 周起始日：设置里选的，缺省周一 */
let weekStart: 0 | 1 = 1;

function monthGrid(month: string) {
  const first = month + '-01';
  const dow = (new Date(parseDay(first)).getUTCDay() + 7 - weekStart) % 7;
  const start = addDays(first, -dow);
  const last = addDays(addMonths(first, 1), -1);
  const cells = Math.ceil((dow + Number(last.slice(8))) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => addDays(start, i));
}

export function Calendar({ state, today, onOpen, onIcs }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onIcs: () => void }) {
  weekStart = state.settings.weekStart ?? 1;
  const DOW = weekStart === 0 ? DOW_SUN : DOW_MON;
  const [month, setMonth] = useState(today.slice(0, 7));
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [sel, setSel] = useState<string>(today);
  const base = state.settings.baseCurrency;

  const year = month.slice(0, 4);
  const grid = monthGrid(month);
  const charges = useMemo(() => allCharges(state, grid[0] < `${year}-01-01` ? grid[0] : `${year}-01-01`, grid[grid.length - 1] > `${year}-12-31` ? grid[grid.length - 1] : `${year}-12-31`, today), [state, year, month, today]);
  const byDay = useMemo(() => {
    const m = new Map<string, Charge[]>();
    for (const c of charges) m.set(c.date, [...(m.get(c.date) ?? []), c]);
    return m;
  }, [charges]);
  const sumOf = (list: Charge[] = []) => sumBase(state, list);
  const monthCharges = charges.filter((c) => c.date.startsWith(month));
  const yearCharges = charges.filter((c) => c.date.startsWith(year));
  const shift = (n: number) => setMonth(addMonths(month + '-01', mode === 'year' ? n * 12 : n).slice(0, 7));
  const selList = byDay.get(sel) ?? [];
  const list = mode === 'month' ? monthCharges : yearCharges;

  return (
    <>
      <Toolbar
        title={mode === 'month' ? `${year}年${Number(month.slice(5))}月` : `${year}年`}
        sub={`${list.length} 笔 · ${money(sumOf(list), base, { compact: true })}`}
      >
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            ['month', '月'],
            ['year', '年'],
          ]}
        />
        <button class="icon-btn" aria-label="上一页" onClick={() => shift(-1)}>
          <Icon name="left" />
        </button>
        <button
          class="btn"
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
          <button class="icon-btn" onClick={onIcs} title="订阅到系统日历" aria-label="订阅到系统日历">
            <Icon name="share" />
          </button>
        )}
      </Toolbar>
      <div class="page fade-in">
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
          <div class="cal-wrap">
            <div class="card cal">
              <div class="cal-grid">
                {DOW.map((d) => (
                  <div key={d} class="cal-dow">
                    {d}
                  </div>
                ))}
                {grid.map((d) => {
                  const items = byDay.get(d) ?? [];
                  return (
                    <button key={d} class={`cal-cell ${d.startsWith(month) ? '' : 'out'} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}`} onClick={() => setSel(d)}>
                      <div class="cal-day">
                        <b>{Number(d.slice(8))}</b>
                        {items.length > 0 && <span class="sum">{money(sumOf(items), base, { decimals: 0 })}</span>}
                      </div>
                      <div class="cal-icons">
                        {items.slice(0, 4).map((c) => (
                          <span key={c.sub.id} {...tipProps(() => `${c.sub.name} · ${money(c.amount, c.currency)}`)}>
                            <SubIcon sub={c.sub} size={24} />
                          </span>
                        ))}
                        {items.length > 4 && <span class="cal-more">+{items.length - 4}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div class="stack">
              <Group title={`${cnDate(sel, true)} · ${relDays(diffDays(today, sel))}`}>
                {selList.length === 0 && <div class="cell muted">这一天没有扣款</div>}
                {selList.map((c) => (
                  <button key={c.sub.id} class="cell tap" onClick={() => onOpen(c.sub)}>
                    <SubIcon sub={c.sub} size={34} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{c.sub.name}</div>
                      <PayBadge m={state.methods.find((m) => m.id === c.sub.methodId)} />
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      <Amount value={c.amount} ccy={c.currency} />
                      <div class="muted" style={{ fontSize: 12 }}>
                        {c.projected ? '预计' : '已扣'}
                        {c.currency !== base ? ` · ≈${money(chargeValue(state, c), base, { compact: true })}` : ''}
                      </div>
                    </span>
                  </button>
                ))}
              </Group>
              <Group title={`${Number(month.slice(5))}月全部扣款`}>
                {monthCharges.length === 0 && <div class="cell muted">本月没有扣款</div>}
                {monthCharges.map((c) => (
                  <Cell key={c.sub.id + c.date} label={<span class="row cal-name"><SubIcon sub={c.sub} size={24} /><span>{c.sub.name}</span></span>} onClick={() => onOpen(c.sub)}>
                    <span style={{ color: c.date < today ? 'var(--label-3)' : undefined, whiteSpace: 'nowrap' }}>{Number(c.date.slice(8))}日</span>
                    <b style={{ color: 'var(--label)', fontWeight: 600, whiteSpace: 'nowrap' }}>{money(c.amount, c.currency, { compact: true })}</b>
                  </Cell>
                ))}
              </Group>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function YearHeat({ year, byDay, today, sumOf, base, onPick }: { year: string; byDay: Map<string, Charge[]>; today: string; sumOf: (l?: Charge[]) => number; base: string; onPick: (m: string) => void }) {
  const DOW = weekStart === 0 ? DOW_SUN : DOW_MON;
  return (
    <div class="heat">
      {Array.from({ length: 12 }, (_, i) => {
        const m = `${year}-${String(i + 1).padStart(2, '0')}`;
        // 固定 6 行，让 12 张月卡等高对齐
        const grid = Array.from({ length: 42 }, (_, k) => addDays(monthGrid(m)[0], k));
        const days = grid.filter((d) => d.startsWith(m));
        const total = days.reduce((a, d) => a + sumOf(byDay.get(d)), 0);
        const count = days.reduce((a, d) => a + (byDay.get(d)?.length ?? 0), 0);
        return (
          <button key={m} class={`heat-m ${today.startsWith(m) ? 'cur' : ''} ${m < today.slice(0, 7) ? 'past' : ''}`} onClick={() => onPick(m)}>
            <div class="heat-h">
              {i + 1}月
              <span>
                {count ? `${count} 笔 · ` : ''}
                {money(total, base, { compact: true })}
              </span>
            </div>
            <div class="heat-g">
              {DOW.map((w) => (
                <em key={w}>{w}</em>
              ))}
              {grid.map((d) => {
                if (!d.startsWith(m)) return <i key={d} class="hd out" />;
                const list = (byDay.get(d) ?? []).slice().sort((x, y) => y.amount - x.amount);
                const cls = `hd ${d === today ? 'today' : ''} ${list.length ? 'has' : ''} ${d < today ? 'gone' : ''}`;
                if (!list.length)
                  return (
                    <i key={d} class={cls}>
                      {Number(d.slice(8))}
                    </i>
                  );
                return (
                  <i key={d} class={cls} {...tipProps(() => (
                    <>
                      <b>{cnDate(d, true)}</b>
                      {list.map((c) => (
                        <div key={c.sub.id}>
                          {c.sub.name} · {money(c.amount, c.currency)}
                        </div>
                      ))}
                    </>
                  ))}>
                    {/* 同一天多笔：像一叠卡片，后面的略小、往右上错开；悬停时展开 */}
                    <span class="hd-stack">
                      {list.slice(0, 3).map((c, k) => (
                        <span key={c.sub.id} class="hd-card" style={{ '--k': k } as Record<string, number>}>
                          <SubIcon sub={c.sub} size={20} />
                        </span>
                      ))}
                    </span>
                  </i>
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}
