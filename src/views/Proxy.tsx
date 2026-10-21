import { useState } from 'react';
import { cycleLabel, effectiveStatus, nextCharge, todayIn } from '../../shared/billing.ts';
import { cnDate, cnDateFull, money } from '../../shared/format.ts';
import { toBaseAt } from '../../shared/fx.ts';
import type { AppState, ProxyEntry, Subscription } from '../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { Amount, Cell, Group, Icon, PayBadge, Seg, Sheet, SubIcon, Toolbar } from '../components/ui.tsx';
import { contactText } from './Members.tsx';
import { run, saveSub } from '../store.ts';
import { CurrencySelect } from '../components/Picker.tsx';
import { proxyRows, type ProxyRow } from '../../shared/proxy.ts';
import { t } from '../../shared/i18n.ts';

/** 代付的状态文案：进行中、到期停付、已停止是代付自己的说法，其余沿用订阅状态 */
const statusLabel = (st: string): string => (['active', 'ending', 'ended'].includes(st) ? t(`proxy.status.${st}`) : t(`list.status.${st}`));

export type Row = ProxyRow;
const rows = proxyRows;

/** 某个代付订阅还有几期没收回 */
export function proxyOwed(state: AppState, s: Subscription, today: string): number {
  return rows(state, s, today).filter((r) => r.receivedBase == null).length;
}

/** 代付总账：待收多少、收回的钱和实扣相比赚了还是亏了 */
function proxySummary(state: AppState, today: string) {
  // 进行中的在前，已停止的排到最后
  const subs = state.subscriptions
    .filter((s) => s.proxy)
    .sort((a, b) => Number(effectiveStatus(a, today) === 'ended') - Number(effectiveStatus(b, today) === 'ended'));
  const all = subs.flatMap((s) => rows(state, s, today));
  const open = all.filter((r) => r.receivedBase == null);
  const closed = all.filter((r) => r.receivedBase != null);
  return {
    subs,
    count: all.length,
    charged: all.reduce((a, r) => a + r.chargedBase, 0),
    owed: open.reduce((a, r) => a + r.chargedBase, 0),
    owedCount: open.length,
    diff: closed.reduce((a, r) => a + r.receivedBase! - r.chargedBase, 0),
  };
}

/**
 * 代付卡片：头部（图标、名称）点开是订阅详情；底部「N 期明细」点开是逐期的扣款与收款。
 * 卡片本身只放摘要，高度统一；停止的盖一枚模糊的 🚫 水印。
 */
function ProxyCard({ state, s, onOpen }: { state: AppState; s: Subscription; onOpen: (s: Subscription) => void }) {
  const today = todayIn(state.settings.timezone);
  const base = state.settings.baseCurrency;
  const list = rows(state, s, today);
  const [ledger, setLedger] = useState(false);
  const next = nextCharge(s, today);
  const method = state.methods.find((m) => m.id === s.methodId);
  const charged = list.reduce((a, r) => a + r.chargedBase, 0);
  const received = list.reduce((a, r) => a + (r.receivedBase ?? 0), 0);
  const open = list.filter((r) => r.receivedBase == null);
  const st = effectiveStatus(s, today);
  const stopped = st === 'ended';
  // 状态胶囊只说进度：进行中 / 待收 / 已停止；是否结清看下面的「待收」格
  const tone = stopped ? 'stop' : open.length ? 'owe' : 'ok';
  const label = open.length && !stopped ? t('proxy.owedPeriods', { count: open.length }) : stopped ? t('proxy.status.ended') : statusLabel(st);

  return (
    <>
      {/* 整张卡片点开代付详情 */}
      <div
        className={`card proxy-card ${stopped ? 'stopped' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => setLedger(true)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setLedger(true))}
      >
        {stopped && (
          <span className="stop-stamp" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M5.6 5.6l12.8 12.8" />
            </svg>
          </span>
        )}
        <div className="proxy-top">
          <button
            className="proxy-head"
            title={t('proxy.viewSub')}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(s);
            }}
          >
            <SubIcon sub={s} size={46} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ph-name">{s.name}</div>
              <div className="muted ph-meta">
                {money(s.price, s.currency)} {cycleLabel(s.cycle)}
                {stopped ? (s.end ? t('proxy.stoppedOn', { date: cnDate(s.end) }) : '') : next ? t('proxy.nextOn', { date: cnDate(next) }) : ''}
              </div>
            </div>
          </button>
          <span className={`ph-status ${tone}`}>
            <i />
            {label}
          </span>
        </div>
        <div className="ph-chips">
          <span className="who-chip" title={s.proxy!.note}>
            <Icon name="users" size={12} />
            {t('proxy.payFor', { name: s.proxy!.forName || t('proxy.unset') })}
            {contactText(s.proxy!) && <em>{contactText(s.proxy!)}</em>}
          </span>
          <PayBadge m={method} />
        </div>

        <div className="proxy-facts">
          <div>
            <small>{t('proxy.paidPeriods', { count: list.length })}</small>
            <b>{money(charged, base, { compact: true })}</b>
          </div>
          <div>
            <small>{t('proxy.received')}</small>
            <b>{money(received, base, { compact: true })}</b>
          </div>
          <div>
            <small>{open.length ? t('proxy.owedPeriods', { count: open.length }) : t('proxy.owed')}</small>
            <b className={open.length ? 'warn' : 'done'}>
              {open.length
                ? `≈ ${money(
                    open.reduce((a, r) => a + r.chargedBase, 0),
                    base,
                    { compact: true },
                  )}`
                : t('proxy.settled')}
            </b>
          </div>
        </div>
      </div>
      {/* 弹窗放在卡片外面：卡片的定位与裁切不会影响弹层，也不会把同一行的卡片撑高 */}
      {ledger && <LedgerSheet state={state} s={s} onClose={() => setLedger(false)} onOpen={onOpen} />}
    </>
  );
}

/** 代付详情：上面是订阅与对象的基本信息和汇总，下面是每一期的扣款与收款列表；点一行记收款或修改 */
export function LedgerSheet({ state, s, onClose, onOpen }: { state: AppState; s: Subscription; onClose: () => void; onOpen: (s: Subscription) => void }) {
  const today = todayIn(state.settings.timezone);
  const base = state.settings.baseCurrency;
  const live = state.subscriptions.find((x) => x.id === s.id) ?? s;
  const list = rows(state, live, today);
  const [edit, setEdit] = useState<Row | null>(null);
  const ro = !!state.readonly;
  const px = live.proxy!;
  const st = effectiveStatus(live, today);
  const stopped = st === 'ended';
  const next = nextCharge(live, today);
  const method = state.methods.find((m) => m.id === live.methodId);
  const charged = list.reduce((a, r) => a + r.chargedBase, 0);
  const done = list.filter((r) => r.receivedBase != null);
  const received = done.reduce((a, r) => a + r.receivedBase!, 0);
  const open = list.filter((r) => r.receivedBase == null);
  const diff = done.reduce((a, r) => a + r.receivedBase! - r.chargedBase, 0);
  const cardCcy = list.find((r) => r.currency !== r.listCurrency)?.currency;

  return (
    <Sheet title={t('proxy.detailTitle')} onClose={onClose}>
      <div className="stack">
        <div className="ld-head">
          <SubIcon sub={live} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ph-name">{live.name}</div>
            <div className="muted ph-meta">
              {money(live.price, live.currency)} {cycleLabel(live.cycle)}
              {cardCcy ? t('proxy.cardCcy', { ccy: cardCcy }) : ''}
            </div>
          </div>
          <span className={`ph-status ${stopped ? 'stop' : open.length ? 'owe' : 'ok'}`}>
            <i />
            {stopped ? t('proxy.status.ended') : open.length ? t('proxy.owedPeriods', { count: open.length }) : statusLabel(st)}
          </span>
        </div>

        <div className="ld-top">
          <Group>
            <Cell label={t('proxy.forWhom')}>
              <span className="ld-who">
                {px.forName || t('proxy.unset')}
                {contactText(px) && <small>{contactText(px)}</small>}
              </span>
            </Cell>
            <Cell label={t('proxy.method')}>
              <PayBadge m={method} />
            </Cell>
            <Cell
              label={t('proxy.subscription')}
              onClick={() => {
                onClose();
                onOpen(live);
              }}
            >
              {t('proxy.viewDetail')}
            </Cell>
            <Cell label={stopped ? t('proxy.stoppedAt') : t('proxy.nextCharge')}>
              {stopped ? (live.end ? cnDateFull(live.end) : '—') : next ? cnDateFull(next) : '—'}
            </Cell>
            {px.note && <Cell label={t('proxy.note')}>{px.note}</Cell>}
          </Group>

          <div className="proxy-facts four">
            <div>
              <small>{t('proxy.paidPeriods', { count: list.length })}</small>
              <b>{money(charged, base, { compact: true })}</b>
            </div>
            <div>
              <small>{t('proxy.received')}</small>
              <b>{money(received, base, { compact: true })}</b>
            </div>
            <div>
              <small>{t('proxy.owed')}</small>
              <b className={open.length ? 'warn' : 'done'}>
                {open.length
                  ? `≈ ${money(
                      open.reduce((a, r) => a + r.chargedBase, 0),
                      base,
                      { compact: true },
                    )}`
                  : t('proxy.settled')}
              </b>
            </div>
            <div>
              <small>{t('proxy.diffLabel')}</small>
              <b className={Math.abs(diff) < 0.5 ? '' : diff > 0 ? 'done' : 'loss'}>
                {diff > 0.5 ? '+' : ''}
                {money(diff, base, { compact: true })}
              </b>
            </div>
          </div>
        </div>

        <div className="ld-table">
          <div className="ld-row ld-th">
            <span>{t('proxy.table.date')}</span>
            <span>{t('proxy.table.charged')}</span>
            <span className="ld-cost">{t('proxy.table.cost')}</span>
            <span>{t('proxy.table.received')}</span>
            <span>{t('proxy.table.diff')}</span>
          </div>
          {list.map((r) => {
            const d = r.receivedBase == null ? undefined : r.receivedBase - r.chargedBase;
            const rc = r.entry?.receivedCurrency ?? base;
            return (
              <button key={r.date} className="ld-row" disabled={ro} onClick={() => setEdit(r)}>
                <span className="ld-date">{cnDate(r.date)}</span>
                <span>
                  <b>{money(r.charged, r.currency)}</b>
                  {/* 窄屏没有「当时成本」一列，折合写在实扣下面 */}
                  <small className="ld-cost-inline">≈ {money(r.chargedBase, base)}</small>
                </span>
                <span className="ld-cost">{money(r.chargedBase, base)}</span>
                <span>
                  {r.receivedBase == null ? (
                    <em className="todo">{ro ? t('proxy.owed') : t('proxy.table.record')}</em>
                  ) : (
                    <>
                      <b>{money(r.entry!.received!, rc)}</b>
                      {(r.entry?.receivedOn || rc !== base) && (
                        <small>
                          {[
                            r.entry?.receivedOn && t('proxy.table.receivedOn', { date: cnDate(r.entry.receivedOn) }),
                            rc !== base && `≈ ${money(r.receivedBase, base)}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      )}
                    </>
                  )}
                </span>
                <span className={d == null || Math.abs(d) < 0.5 ? 'muted' : d > 0 ? 'gain' : 'loss'}>
                  {d == null ? '—' : Math.abs(d) < 0.5 ? t('proxy.table.even') : `${d > 0 ? '+' : '−'}${money(Math.abs(d), base)}`}
                </span>
              </button>
            );
          })}
          {list.length > 1 && (
            <div className="ld-row ld-tf">
              <span>{t('proxy.table.total', { count: list.length })}</span>
              <span>
                {new Set(list.map((r) => r.currency)).size === 1
                  ? money(
                      list.reduce((a, r) => a + r.charged, 0),
                      list[0].currency,
                    )
                  : ''}
              </span>
              <span className="ld-cost">{money(charged, base)}</span>
              <span>{money(received, base)}</span>
              <span className={Math.abs(diff) < 0.5 ? 'muted' : diff > 0 ? 'gain' : 'loss'}>
                {Math.abs(diff) < 0.5 ? t('proxy.table.even') : `${diff > 0 ? '+' : '−'}${money(Math.abs(diff), base)}`}
              </span>
            </div>
          )}
          {list.length === 0 && (
            <div className="muted" style={{ fontSize: 13, padding: '12px 0' }}>
              {t('proxy.table.none')}
            </div>
          )}
        </div>
      </div>
      {edit && <EntrySheet state={state} s={live} row={edit} onClose={() => setEdit(null)} />}
    </Sheet>
  );
}

export function EntrySheet({ state, s, row, onClose }: { state: AppState; s: Subscription; row: Row; onClose: () => void }) {
  const base = state.settings.baseCurrency;
  const e = row.entry;
  const [charged, setCharged] = useState(e?.charged != null ? String(e.charged) : '');
  const [chargedCcy, setChargedCcy] = useState(e?.chargedCurrency ?? row.listCurrency);
  const [received, setReceived] = useState(e?.received != null ? String(e.received) : '');
  const [ccy, setCcy] = useState(e?.receivedCurrency ?? base);
  const [on, setOn] = useState<string | undefined>(e?.receivedOn ?? todayIn(state.settings.timezone));
  const [note, setNote] = useState(e?.note ?? '');
  const val = (ev: { target: EventTarget | null }) => (ev.target as HTMLInputElement).value;

  const chargedN = charged === '' ? row.list : Number(charged);
  const chargedBase = toBaseAt(state, chargedN, charged === '' ? row.listCurrency : chargedCcy, row.date);
  const recvN = received === '' ? undefined : Number(received);
  const recvBase = recvN == null ? undefined : toBaseAt(state, recvN, ccy, on ?? row.date);
  const diff = recvBase == null ? undefined : recvBase - chargedBase;

  const save = (clearReceipt = false) => {
    const next: ProxyEntry = {
      charge: row.date,
      charged: charged === '' ? undefined : Number(charged),
      chargedCurrency: charged === '' || chargedCcy === row.listCurrency ? undefined : chargedCcy,
      received: clearReceipt ? undefined : recvN,
      receivedCurrency: clearReceipt || recvN == null ? undefined : ccy,
      receivedOn: clearReceipt || recvN == null ? undefined : on,
      note: note.trim() || undefined,
    };
    // 去掉这一期原来那条（可能是按相近日期对上的旧记录），换成新的
    const others = (s.proxy?.entries ?? []).filter((x) => x.charge !== row.date && x.charge !== row.entry?.charge);
    const keep = next.charged != null || next.received != null || next.note;
    run(
      async () => {
        await saveSub({ ...s, proxy: { ...s.proxy!, entries: keep ? [...others, next].sort((a, b) => a.charge.localeCompare(b.charge)) : others } });
        onClose();
      },
      clearReceipt ? t('proxy.entry.markedDue') : t('proxy.entry.saved'),
    );
  };

  return (
    <Sheet
      narrow
      title={t('proxy.entry.title', { date: cnDateFull(row.date) })}
      onClose={onClose}
      foot={
        <>
          {e?.received != null && (
            <button className="btn plain" style={{ color: 'var(--red)' }} onClick={() => save(true)}>
              {t('proxy.entry.markDue')}
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('proxy.entry.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={(charged !== '' && !Number.isFinite(Number(charged))) || (recvN != null && !Number.isFinite(recvN))}
            onClick={() => save()}
          >
            {t('proxy.entry.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Group
          title={t('proxy.table.charged')}
          foot={t('proxy.entry.chargedFoot', { amount: money(chargedBase, base), list: money(row.list, row.listCurrency) })}
        >
          <Cell label={t('proxy.entry.amount')}>
            <input className="num" inputMode="decimal" value={charged} placeholder={String(row.list)} onChange={(ev) => setCharged(val(ev))} />
          </Cell>
          <Cell label={t('proxy.entry.currency')}>
            <CurrencySelect value={chargedCcy} onChange={setChargedCcy} />
          </Cell>
        </Group>
        <Group
          title={s.proxy!.forName ? t('proxy.entry.paidBack', { name: s.proxy!.forName }) : t('proxy.entry.paidBackAnon')}
          foot={
            diff == null
              ? t('proxy.entry.receivedEmpty')
              : t(Math.abs(diff) < 0.5 ? 'proxy.entry.receivedEven' : diff > 0 ? 'proxy.entry.receivedMore' : 'proxy.entry.receivedLess', {
                  amount: money(recvBase!, base),
                  diff: money(Math.abs(diff), base),
                })
          }
        >
          <Cell label={t('proxy.entry.amount')}>
            <input
              className="num"
              inputMode="decimal"
              autoFocus
              value={received}
              placeholder={t('proxy.entry.notReceived')}
              onChange={(ev) => setReceived(val(ev))}
            />
          </Cell>
          <Cell label={t('proxy.entry.currency')}>
            <CurrencySelect value={ccy} onChange={setCcy} />
          </Cell>
          <Cell label={t('proxy.entry.receivedOn')}>
            <DatePicker value={on} onChange={setOn} />
          </Cell>
          <Cell label={t('proxy.note')}>
            <input value={note} placeholder={t('proxy.entry.notePlaceholder')} onChange={(ev) => setNote(val(ev))} />
          </Cell>
        </Group>
      </div>
    </Sheet>
  );
}

const PROXY_FILTERS = ['all', 'live', 'owe', 'ended'] as const;
type ProxyFilter = (typeof PROXY_FILTERS)[number];

/** 代付页：替别人付的订阅，逐期记录实扣与收回 */
export function ProxyPage({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const sum = proxySummary(state, today);
  const [filter, setFilter] = useState<ProxyFilter>('all');
  const stopped = (s: Subscription) => effectiveStatus(s, today) === 'ended';
  const groups: Record<ProxyFilter, Subscription[]> = {
    all: sum.subs,
    live: sum.subs.filter((s) => !stopped(s)),
    owe: sum.subs.filter((s) => proxyOwed(state, s, today) > 0),
    ended: sum.subs.filter(stopped),
  };
  const shown = groups[filter];
  return (
    <>
      <Toolbar title={t('proxy.title')}>
        {sum.subs.length > 0 && (
          <Seg
            small
            value={filter}
            onChange={setFilter}
            options={PROXY_FILTERS.map((f) => [f, `${t(`proxy.filter.${f}`)} ${groups[f].length}`] as [ProxyFilter, string])}
          />
        )}
      </Toolbar>
      <div className="page fade-in stack">
        <div className="grid g-3">
          <div className="card stat">
            <div className="stat-label">{t('proxy.owed')}</div>
            <div className="stat-value" style={{ color: sum.owedCount ? 'var(--orange)' : undefined }}>
              <Amount value={sum.owed} ccy={base} />
            </div>
            <div className="stat-sub">{sum.owedCount ? t('proxy.page.owedSub', { count: sum.owedCount }) : t('proxy.page.allBack')}</div>
          </div>
          <div className="card stat">
            <div className="stat-label">{t('proxy.page.total')}</div>
            <div className="stat-value">
              <Amount value={sum.charged} ccy={base} />
            </div>
            <div className="stat-sub">{t('proxy.page.totalSub', { count: sum.count, subs: t('proxy.page.subs', { count: sum.subs.length }) })}</div>
          </div>
          <div className="card stat">
            <div className="stat-label">{t('proxy.diffLabel')}</div>
            <div className="stat-value" style={{ color: Math.abs(sum.diff) < 0.5 ? undefined : sum.diff > 0 ? 'var(--green)' : 'var(--red)' }}>
              <Amount value={sum.diff} ccy={base} />
            </div>
            <div className="stat-sub">{t('proxy.page.diffSub')}</div>
          </div>
        </div>
        {sum.subs.length === 0 ? (
          <div className="card empty">
            <b>{t('proxy.page.emptyTitle')}</b>
            {t('proxy.page.emptyBody')}
          </div>
        ) : (
          <div className="grid g-2">
            {shown.length === 0 && <div className="card empty">{t('proxy.filter.none')}</div>}
            {shown.map((s) => (
              <ProxyCard key={s.id} state={state} s={s} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
