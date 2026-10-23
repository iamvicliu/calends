import { copyParts } from '../components/copy.tsx';
import { PersonAvatar, personFor } from '../components/PersonAvatar.tsx';
import { useState } from 'react';
import { addDays, cycleLabel, effectiveStatus, nextCharge, todayIn } from '../../../shared/billing.ts';
import { flow, cnDate, cnDateFull, money } from '../../../shared/format.ts';
import { toBaseAt } from '../../../shared/fx.ts';
import type { AppState, ProxyEntry, Subscription } from '../../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { MetricCards, Metric, Amount, MoneyInput, Cell, Group, NameLink, PayBadge, Seg, Sheet, StatusPill, SubIcon, Toolbar } from '../components/ui.tsx';
import { contactText } from './Members.tsx';
import { run, saveSub, usePref } from '../store.ts';
import { CurrencySelect } from '../components/Picker.tsx';
import { proxyRows, type ProxyRow } from '../../../shared/proxy.ts';
import { t } from '../../../shared/i18n.ts';

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
    .sort((a, b) => Number(['ended', 'terminated'].includes(effectiveStatus(a, today))) - Number(['ended', 'terminated'].includes(effectiveStatus(b, today))));
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
  const next = nextCharge(s, addDays(today, 1));
  const method = state.methods.find((m) => m.id === s.methodId);
  const charged = list.reduce((a, r) => a + r.chargedBase, 0);
  const received = list.reduce((a, r) => a + (r.receivedBase ?? 0), 0);
  const open = list.filter((r) => r.receivedBase == null);
  const st = effectiveStatus(s, today);
  const stopped = ['ended', 'terminated'].includes(st);
  // 状态胶囊只说进度：进行中 / 待收 / 已停止；是否结清看下面的「待收」格
  const tone = stopped ? 'stop' : open.length ? 'owe' : st === 'active' || st === 'lifetime' ? 'ok' : 'notice';
  const label = open.length && !stopped ? t('proxy.owed') : stopped ? t('proxy.status.ended') : statusLabel(st);

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
        <div className="proxy-top">
          <div className="proxy-head">
            <SubIcon sub={s} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ph-name text-ellipsis">
                <NameLink onClick={() => onOpen(s)}>{s.name}</NameLink>
              </div>
              <div className="muted ph-meta">
                {money(s.price, s.currency)} {cycleLabel(s.cycle)}
                {copyParts(stopped ? (s.end ? t('proxy.stoppedOn', { date: cnDate(s.end) }) : '') : next ? t('proxy.nextOn', { date: cnDate(next) }) : '')}
              </div>
            </div>
          </div>
          <StatusPill tone={tone}>{label}</StatusPill>
        </div>
        <div className="ph-chips">
          <span className="who-chip" title={s.proxy!.note}>
            <PersonAvatar p={personFor(state, s.proxy!.personId, s.proxy!.forName)} size={20} />
            {t('proxy.payFor', { name: s.proxy!.forName || t('proxy.unset') })}
            {contactText(s.proxy!) && <em>{contactText(s.proxy!)}</em>}
          </span>
          <PayBadge m={method} />
        </div>

        <MetricCards inline>
          <Metric label={t('proxy.paidPeriods', { count: list.length })} value={flow(-charged, base, { compact: true })} />
          <Metric label={t('proxy.received')} value={flow(received, base, { compact: true })} valueClassName="green" />
          <Metric
            label={open.length ? t('proxy.owedPeriods', { count: open.length }) : t('proxy.owed')}
            value={
              open.length
                ? `≈ ${money(
                    open.reduce((a, r) => a + r.chargedBase, 0),
                    base,
                    { compact: true },
                  )}`
                : t('proxy.settled')
            }
            valueClassName={open.length ? 'warn' : 'done'}
          />
        </MetricCards>
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
  const stopped = ['ended', 'terminated'].includes(st);
  const next = nextCharge(live, addDays(today, 1));
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
            <div className="ph-name text-ellipsis">
              <NameLink
                onClick={() => {
                  onClose();
                  onOpen(live);
                }}
              >
                {live.name}
              </NameLink>
            </div>
            <div className="muted ph-meta">
              {money(live.price, live.currency)} {cycleLabel(live.cycle)}
              {copyParts(cardCcy ? t('proxy.cardCcy', { ccy: cardCcy }) : '')}
            </div>
          </div>
          <StatusPill tone={stopped ? 'stop' : open.length ? 'owe' : st === 'active' || st === 'lifetime' ? 'ok' : 'notice'}>
            {stopped ? t('proxy.status.ended') : open.length ? t('proxy.owed') : statusLabel(st)}
          </StatusPill>
        </div>

        <div className="ld-top">
          <Group>
            <Cell
              label={
                <span className="row">
                  <PersonAvatar p={personFor(state, live.proxy!.personId, live.proxy!.forName)} size={28} />
                  {t('proxy.forWhom')}
                </span>
              }
            >
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

          <MetricCards>
            <Metric label={t('proxy.paidPeriods', { count: list.length })} value={flow(-charged, base, { compact: true })} />
            <Metric label={t('proxy.received')} value={flow(received, base, { compact: true })} valueClassName="green" />
            <Metric
              label={t('proxy.owed')}
              value={
                open.length
                  ? `≈ ${money(
                      open.reduce((a, r) => a + r.chargedBase, 0),
                      base,
                      { compact: true },
                    )}`
                  : t('proxy.settled')
              }
              valueClassName={open.length ? 'warn' : 'done'}
            />
            <Metric
              label={t('proxy.diffLabel')}
              value={flow(diff, base, { compact: true })}
              valueClassName={Math.abs(diff) < 0.5 ? '' : diff > 0 ? 'done' : 'loss'}
            />
          </MetricCards>
        </div>

        <div className="ld-table">
          <div className="ld-row ld-th table-head">
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
                  <b>{flow(-r.charged, r.currency)}</b>
                  {/* 窄屏没有「当时成本」一列，折合写在实扣下面 */}
                  <small className="ld-cost-inline">≈ {flow(-r.chargedBase, base)}</small>
                </span>
                <span className="ld-cost">{flow(-r.chargedBase, base)}</span>
                <span className={r.receivedBase != null ? 'green' : undefined}>
                  {r.receivedBase == null ? (
                    <em className="todo">{ro ? t('proxy.owed') : t('proxy.table.record')}</em>
                  ) : (
                    <>
                      <b className="green">{flow(r.entry!.received!, rc)}</b>
                      {(r.entry?.receivedOn || rc !== base) && (
                        <small style={{ color: 'var(--green)' }}>
                          {copyParts(
                            [
                              r.entry?.receivedOn && t('proxy.table.receivedOn', { date: cnDate(r.entry.receivedOn) }),
                              rc !== base && `≈ ${flow(r.receivedBase, base)}`,
                            ]
                              .filter(Boolean)
                              .join('\n'),
                          )}
                        </small>
                      )}
                    </>
                  )}
                </span>
                <span className={d == null || Math.abs(d) < 0.5 ? 'muted' : d > 0 ? 'gain' : 'loss'}>
                  {d == null ? '—' : Math.abs(d) < 0.5 ? t('proxy.table.even') : flow(d, base)}
                </span>
              </button>
            );
          })}
          {list.length > 1 && (
            <div className="ld-row ld-tf">
              <span>{copyParts(t('proxy.table.total', { count: list.length }))}</span>
              <span>{new Set(list.map((r) => r.currency)).size === 1 ? flow(-list.reduce((a, r) => a + r.charged, 0), list[0].currency) : ''}</span>
              <span className="ld-cost">{flow(-charged, base)}</span>
              <span className="green">{flow(received, base)}</span>
              <span className={Math.abs(diff) < 0.5 ? 'muted' : diff > 0 ? 'gain' : 'loss'}>
                {Math.abs(diff) < 0.5 ? t('proxy.table.even') : flow(diff, base)}
              </span>
            </div>
          )}
          {list.length === 0 && (
            <div className="muted" style={{ fontSize: 'var(--fs-2)', padding: '12px 0' }}>
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
        <div className="row">
          <PersonAvatar p={personFor(state, s.proxy!.personId, s.proxy!.forName)} size={36} />
          <b>{s.proxy!.forName}</b>
        </div>
        <Group
          title={t('proxy.table.charged')}
          foot={t('proxy.entry.chargedFoot', { amount: flow(-chargedBase, base), list: money(row.list, row.listCurrency) })}
        >
          <Cell label={t('proxy.entry.amount')}>
            <MoneyInput ccy={chargedCcy} className="num" value={charged} placeholder={String(row.list)} onChange={(ev) => setCharged(val(ev))} />
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
                  amount: flow(recvBase!, base),
                  diff: money(Math.abs(diff), base),
                })
          }
        >
          <Cell label={t('proxy.entry.amount')}>
            <MoneyInput
              ccy={ccy}
              className="num"
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
  const [filter, setFilter] = usePref<ProxyFilter>('proxy-filter', 'all', (v): v is ProxyFilter => (PROXY_FILTERS as readonly string[]).includes(v));
  const stopped = (s: Subscription) => ['ended', 'terminated'].includes(effectiveStatus(s, today));
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
        <MetricCards>
          <Metric
            label={t('proxy.owed')}
            value={<Amount plain value={sum.owed} ccy={base} />}
            valueStyle={{ color: sum.owedCount ? 'var(--orange)' : undefined }}
            note={sum.owedCount ? t('proxy.page.owedSub', { count: sum.owedCount }) : t('proxy.page.allBack')}
          />
          <Metric
            label={t('proxy.page.total')}
            value={<Amount value={-sum.charged} ccy={base} />}
            note={copyParts(t('proxy.page.totalSub', { count: sum.count, subs: t('proxy.page.subs', { count: sum.subs.length }) }))}
          />
          <Metric
            label={t('proxy.diffLabel')}
            value={<Amount value={sum.diff} ccy={base} />}
            valueStyle={{ color: Math.abs(sum.diff) < 0.5 ? undefined : sum.diff > 0 ? 'var(--green)' : 'var(--red)' }}
            note={t('proxy.page.diffSub')}
          />
        </MetricCards>
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
