import { useMemo, useState } from 'react';
import { addDays, addMonths, diffDays, parseDay, type Charge } from '../../shared/billing.ts';
import { cnDate, money, monthLabel, relDays, weekdayShort } from '../../shared/format.ts';
import { t } from '../../shared/i18n.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { Cell, Group, Icon, PayBadge, Seg, SubIcon, tipProps, Toolbar } from '../components/ui.tsx';
import { chargeValue } from '../../shared/fx.ts';
import { allCharges, sumBase } from '../derive.ts';
import { useMoneyPair } from '../components/MoneyPair.tsx';

/** 表头的星期简称，按周起始日排好 */
const dows = () => Array.from({ length: 7 }, (_, i) => weekdayShort((i + weekStart) % 7, true));
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
  // 大字 / 小字金额跟随显示货币设置
  const pair = useMoneyPair(state);
  weekStart = state.settings.weekStart ?? 1;
  const DOW = dows();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [sel, setSel] = useState<string>(today);
  const base = state.settings.baseCurrency;

  const year = month.slice(0, 4);
  const grid = monthGrid(month);
  const charges = useMemo(
    () =>
      allCharges(
        state,
        grid[0] < `${year}-01-01` ? grid[0] : `${year}-01-01`,
        grid[grid.length - 1] > `${year}-12-31` ? grid[grid.length - 1] : `${year}-12-31`,
        today,
      ),
    [state, year, month, today],
  );
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
        title={mode === 'month' ? monthLabel(month, { long: true }) : t('calendar.yearTitle', { year })}
        sub={t('calendar.summary', { count: list.length, amount: money(sumOf(list), base, { compact: true }) })}
      >
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            ['month', t('calendar.mode.month')],
            ['year', t('calendar.mode.year')],
          ]}
        />
        <button className="icon-btn" aria-label={t('calendar.prev')} onClick={() => shift(-1)}>
          <Icon name="left" />
        </button>
        <button
          className="btn"
          onClick={() => {
            setMonth(today.slice(0, 7));
            setSel(today);
          }}
        >
          {t('calendar.today')}
        </button>
        <button className="icon-btn" aria-label={t('calendar.next')} onClick={() => shift(1)}>
          <Icon name="right" />
        </button>
        {!state.readonly && (
          <button className="icon-btn" onClick={onIcs} title={t('calendar.ics')} aria-label={t('calendar.ics')}>
            <Icon name="share" />
          </button>
        )}
      </Toolbar>
      <div className="page fade-in">
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
          <div className="cal-wrap">
            <div className="card cal">
              <div className="cal-grid">
                {DOW.map((d, i) => (
                  <div key={i} className="cal-dow">
                    {d}
                  </div>
                ))}
                {grid.map((d) => {
                  const items = byDay.get(d) ?? [];
                  return (
                    <button
                      key={d}
                      className={`cal-cell ${d.startsWith(month) ? '' : 'out'} ${d === today ? 'today' : ''} ${d === sel ? 'sel' : ''}`}
                      onClick={() => setSel(d)}
                    >
                      <div className="cal-day">
                        <b>{Number(d.slice(8))}</b>
                        {items.length > 0 && <span className="sum">{money(sumOf(items), base, { decimals: 0 })}</span>}
                      </div>
                      <div className="cal-icons">
                        {items.slice(0, 4).map((c) => (
                          <span key={c.sub.id} {...tipProps(() => `${c.sub.name} · ${money(c.amount, c.currency)}`)}>
                            <SubIcon sub={c.sub} size={24} />
                          </span>
                        ))}
                        {items.length > 4 && <span className="cal-more">+{items.length - 4}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="stack">
              <Group title={`${cnDate(sel, true)} · ${relDays(diffDays(today, sel))}`}>
                {selList.length === 0 && <div className="cell muted">{t('calendar.noneDay')}</div>}
                {selList.map((c) => (
                  <button key={c.sub.id} className="cell tap" onClick={() => onOpen(c.sub)}>
                    <SubIcon sub={c.sub} size={34} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{c.sub.name}</div>
                      <PayBadge m={state.methods.find((m) => m.id === c.sub.methodId)} />
                    </span>
                    <span style={{ textAlign: 'right' }}>
                      {pair(c.amount, c.currency, { value: chargeValue(state, c) }).main}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {c.projected ? t('calendar.projected') : t('calendar.charged')}
                        {pair(c.amount, c.currency, { value: chargeValue(state, c) }).alt
                          ? ` · ${pair(c.amount, c.currency, { value: chargeValue(state, c) }).alt}`
                          : ''}
                      </div>
                    </span>
                  </button>
                ))}
              </Group>
              <Group title={t('calendar.monthAll', { month: monthLabel(month, { year: false }) })}>
                {monthCharges.length === 0 && <div className="cell muted">{t('calendar.noneMonth')}</div>}
                {monthCharges.map((c, i) => (
                  <Cell
                    key={c.sub.id + c.date + i}
                    label={
                      <span className="row cal-name">
                        <SubIcon sub={c.sub} size={24} />
                        <span>{c.sub.name}</span>
                      </span>
                    }
                    onClick={() => onOpen(c.sub)}
                  >
                    <span style={{ color: c.date < today ? 'var(--label-3)' : undefined, whiteSpace: 'nowrap' }}>
                      {t('calendar.day', { day: Number(c.date.slice(8)) })}
                    </span>
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

function YearHeat({
  year,
  byDay,
  today,
  sumOf,
  base,
  onPick,
}: {
  year: string;
  byDay: Map<string, Charge[]>;
  today: string;
  sumOf: (l?: Charge[]) => number;
  base: string;
  onPick: (m: string) => void;
}) {
  const DOW = dows();
  return (
    <div className="heat">
      {Array.from({ length: 12 }, (_, i) => {
        const m = `${year}-${String(i + 1).padStart(2, '0')}`;
        // 固定 6 行，让 12 张月卡等高对齐
        const grid = Array.from({ length: 42 }, (_, k) => addDays(monthGrid(m)[0], k));
        const days = grid.filter((d) => d.startsWith(m));
        const total = days.reduce((a, d) => a + sumOf(byDay.get(d)), 0);
        const count = days.reduce((a, d) => a + (byDay.get(d)?.length ?? 0), 0);
        return (
          <button key={m} className={`heat-m ${today.startsWith(m) ? 'cur' : ''} ${m < today.slice(0, 7) ? 'past' : ''}`} onClick={() => onPick(m)}>
            <div className="heat-h">
              {monthLabel(m, { year: false })}
              <span>
                {count ? t('calendar.heatCount', { count }) : ''}
                {money(total, base, { compact: true })}
              </span>
            </div>
            <div className="heat-g">
              {DOW.map((w, k) => (
                <em key={k}>{w}</em>
              ))}
              {grid.map((d) => {
                if (!d.startsWith(m)) return <i key={d} className="hd out" />;
                const list = (byDay.get(d) ?? []).slice().sort((x, y) => y.amount - x.amount);
                const cls = `hd ${d === today ? 'today' : ''} ${list.length ? 'has' : ''} ${d < today ? 'gone' : ''}`;
                if (!list.length)
                  return (
                    <i key={d} className={cls}>
                      {Number(d.slice(8))}
                    </i>
                  );
                return (
                  <i
                    key={d}
                    className={cls}
                    {...tipProps(() => (
                      <>
                        <b>{cnDate(d, true)}</b>
                        {list.map((c) => (
                          <div key={c.sub.id}>
                            {c.sub.name} · {money(c.amount, c.currency)}
                          </div>
                        ))}
                      </>
                    ))}
                  >
                    {/* 同一天多笔：只画第一个图标，右上角标出总笔数（格子太小，叠起来只剩一道边） */}
                    <span className="hd-stack">
                      <SubIcon sub={list[0].sub} size={20} />
                      {list.length > 1 && <b className="hd-more">{list.length}</b>}
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
