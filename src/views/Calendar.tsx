import { useMemo, useState } from 'react';
import { addDays, addMonths, diffDays, parseDay, type Charge } from '../../shared/billing.ts';
import { cnDate, money, monthLabel, relDays, weekdayShort } from '../../shared/format.ts';
import { t } from '../../shared/i18n.ts';
import type { AppState, Subscription } from '../../shared/types.ts';
import { Cell, Group, Icon, PayBadge, Seg, SubIcon, tipProps, Toolbar, useWidth } from '../components/ui.tsx';
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
  // 图标只排一行、叠放约四成：按格子实际宽度算能放几个，放不下的换成「+N」，格子高度始终不变。
  // 悬停格子时依次轻浮一下，悬停某个图标时它浮到最上层；是哪几项看右侧当天列表
  const [gridRef, gridW] = useWidth();
  const narrow = gridW > 0 && gridW < 560;
  const icon = narrow ? 17 : 24;
  const step = Math.round(icon * 0.6);
  const inner = gridW / 7 - (narrow ? 6 : 14);
  const MORE_W = 20;
  const iconCap = gridW ? Math.max(2, Math.floor((inner - icon - MORE_W) / step) + 1) : 4;
  /** 不叠也放得下（间隔 3px）就平铺，放不下才叠 */
  const fits = (n: number) => icon * n + 3 * (n - 1) <= inner;
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
        // 月视图的笔数与合计放进右侧的指标卡；年视图没有右栏，仍写在标题下
        sub={mode === 'year' ? t('calendar.summary', { count: list.length, amount: money(sumOf(list), base, { compact: true }) }) : undefined}
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
            {/* 左：日历，下面紧跟选中那天的明细（卡片）；右：整月列表 */}
            <div className="stack">
              <div className="card cal">
                <div className="cal-grid" ref={gridRef}>
                  {DOW.map((d, i) => (
                    <div key={i} className="cal-dow">
                      {d}
                    </div>
                  ))}
                  {grid.map((d) => {
                    const items = byDay.get(d) ?? [];
                    const shown = items.length > iconCap ? items.slice(0, iconCap) : items;
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
                        <div className="cal-icons" style={{ '--m0': `${fits(shown.length) ? 3 : step - icon}px` } as Record<string, string>}>
                          {shown.map((c, i) => (
                            <span
                              key={c.sub.id}
                              style={{ '--i': i } as Record<string, number>}
                              {...tipProps(() => `${c.sub.name} · ${money(c.amount, c.currency)}`)}
                            >
                              <SubIcon sub={c.sub} size={24} />
                            </span>
                          ))}
                          {items.length > shown.length && <span className="cal-more">+{items.length - shown.length}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <section className="cal-dayhead">
                <h3>{`${cnDate(sel, true)} · ${relDays(diffDays(today, sel))}`}</h3>
                {selList.length > 0 && <span>{t('calendar.summary', { count: selList.length, amount: money(sumOf(selList), base, { compact: true }) })}</span>}
              </section>
              {selList.length === 0 ? (
                <div className="card cal-none">{t('calendar.noneDay')}</div>
              ) : (
                <div className="cal-daycards">
                  {selList.map((c) => {
                    const amt = pair(c.amount, c.currency, { value: chargeValue(state, c) });
                    return (
                      <button key={c.sub.id} className="card cal-daycard" onClick={() => onOpen(c.sub)}>
                        <SubIcon sub={c.sub} size={40} />
                        <span className="cal-dc-main">
                          <b>{c.sub.name}</b>
                          <PayBadge m={state.methods.find((m) => m.id === c.sub.methodId)} />
                        </span>
                        <span className="cal-dc-amt">
                          {amt.main}
                          <small>
                            {/* 先说原币金额，再说状态；放在一起时「预计 · $45.99」容易读成预计扣 $45.99 */}
                            {amt.alt ? `${t('list.originalPrice', { amount: amt.alt })} · ` : ''}
                            {c.projected ? t('calendar.projected') : t('calendar.charged')}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="stack">
              <MonthStat charges={monthCharges} month={month} sumOf={sumOf} base={base} />
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

/** 右栏顶部：本月合计，拆成已扣与待扣，下面一条进度看已经扣了多少 */
function MonthStat({ charges, month, sumOf, base }: { charges: Charge[]; month: string; sumOf: (l?: Charge[]) => number; base: string }) {
  const done = charges.filter((c) => !c.projected);
  const left = charges.filter((c) => c.projected);
  const total = sumOf(charges);
  const paid = sumOf(done);
  const pct = total > 0 ? Math.min(100, Math.max(0, (paid / total) * 100)) : 0;
  return (
    <div className="card cal-stat">
      <small>{t('calendar.monthTotal', { month: monthLabel(month, { year: false }) })}</small>
      <div className="cal-stat-big">
        <b>{money(total, base, { compact: true })}</b>
        <span>{t('calendar.count', { count: charges.length })}</span>
      </div>
      <div className="cal-stat-bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="cal-stat-split">
        <div>
          <small>{t('calendar.charged')}</small>
          <b>{money(paid, base, { compact: true })}</b>
          <span>{t('calendar.count', { count: done.length })}</span>
        </div>
        <div>
          <small>{t('calendar.pending')}</small>
          <b>{money(total - paid, base, { compact: true })}</b>
          <span>{t('calendar.count', { count: left.length })}</span>
        </div>
      </div>
    </div>
  );
}
