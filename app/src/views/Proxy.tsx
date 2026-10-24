import { copyParts } from '../components/copy.tsx';
import { PersonAvatar, personFor } from '../components/PersonAvatar.tsx';
import { useState } from 'react';
import { addDays, cycleLabel, diffDays, effectiveStatus, nextCharge, todayIn } from '../../../shared/billing.ts';
import { flow, cnDate, cnDateFull, money, relDays } from '../../../shared/format.ts';
import { toBaseAt } from '../../../shared/fx.ts';
import type { AppState, ProxyEntry, Subscription } from '../../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { DetailHead, DetailSheet, Facts, Note, Prop } from '../components/DetailKit.tsx';
import { MetricCards, Metric, Amount, MoneyInput, Cell, Group, NameLink, PayBadge, Seg, Sheet, StatusPill, SubIcon, Toolbar } from '../components/ui.tsx';
import { contactText } from './Members.tsx';
import { LtHead, nextSort, PlanPrice, usePhone } from '../components/LtHead.tsx';
import { run, saveSub, usePref } from '../store.ts';
import { CurrencySelect } from '../components/Picker.tsx';
import { proxyRows, type ProxyRow } from '../../../shared/proxy.ts';
import { locale, t } from '../../../shared/i18n.ts';

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
  const live = subs.filter((s) => !['ended', 'terminated'].includes(effectiveStatus(s, today)));
  return {
    subs,
    live: live.length,
    next: live.map((s) => nextCharge(s, addDays(today, 1))).reduce<string | undefined>((a, d) => (d && (!a || d < a) ? d : a), undefined),
    lastIn: closed.map((r) => r.entry?.receivedOn ?? r.date).reduce<string | undefined>((a, d) => (!a || d > a ? d : a), undefined),
    closedCount: closed.length,
    count: all.length,
    charged: all.reduce((a, r) => a + r.chargedBase, 0),
    owed: open.reduce((a, r) => a + r.chargedBase, 0),
    owedCount: open.length,
    received: closed.reduce((a, r) => a + r.receivedBase!, 0),
    diff: closed.reduce((a, r) => a + r.receivedBase! - r.chargedBase, 0),
  };
}

/**
 * 右上角的状态胶囊：已停止 > 待收 > 已结清（各期都收回）；其余按订阅状态，计费中不显示。
 * 结清后第三格改为盈亏，「已结清」只在这里说一次
 */
function proxyStatus(st: string, list: Row[]): ['stop' | 'owe' | 'done' | 'ok' | 'notice', string] {
  if (['ended', 'terminated'].includes(st)) return ['stop', t('proxy.status.ended')];
  if (list.some((r) => r.receivedBase == null)) return ['owe', t('proxy.owed')];
  if (list.length) return ['done', t('proxy.settled')];
  return [st === 'active' || st === 'lifetime' ? 'ok' : 'notice', statusLabel(st)];
}

/**
 * 第三格：还有没收的期就是待收；全部结清后不再写「已结清」，改为这笔代付最终赚了还是亏了（收回 − 实扣）
 */
function OwedOrNet({ list, base, exact = false }: { list: Row[]; base: string; exact?: boolean }) {
  const open = list.filter((r) => r.receivedBase == null);
  if (open.length)
    return (
      <Metric
        label={t('proxy.owedPeriods', { count: open.length })}
        value={`≈ ${money(
          open.reduce((a, r) => a + r.chargedBase, 0),
          base,
          { compact: !exact },
        )}`}
        note={exact ? t('proxy.page.owedRate') : undefined}
        valueClassName="warn"
      />
    );
  const net = list.reduce((a, r) => a + (r.receivedBase ?? 0) - r.chargedBase, 0);
  const even = Math.abs(net) < 0.5;
  return (
    <Metric
      label={t('family.strip.profit')}
      value={even ? t('proxy.table.even') : flow(net, base, { compact: !exact })}
      note={exact && list.length ? t('proxy.page.perPeriod', { amount: flow(net / list.length, base) }) : undefined}
      valueClassName={even ? '' : net > 0 ? 'done' : 'loss'}
    />
  );
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
  const st = effectiveStatus(s, today);
  const stopped = ['ended', 'terminated'].includes(st);
  const [tone, label] = proxyStatus(st, list);

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
            <PersonAvatar p={personFor(state, s.proxy!.personId, s.proxy!.forName)} size={16} />
            {t('proxy.payFor', { name: s.proxy!.forName || t('proxy.unset') })}
            {contactText(s.proxy!) && <em>{contactText(s.proxy!)}</em>}
          </span>
          <PayBadge m={method} />
        </div>

        <MetricCards inline>
          <Metric label={t('proxy.paidPeriods', { count: list.length })} value={flow(-charged, base, { compact: true })} />
          <Metric label={t('proxy.received')} value={flow(received, base, { compact: true })} valueClassName="green" />
          <OwedOrNet list={list} base={base} />
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
  const lastIn = done.map((r) => r.entry?.receivedOn ?? r.date).reduce<string | undefined>((a, d) => (!a || d > a ? d : a), undefined);

  return (
    <DetailSheet label={t('proxy.detailTitle')} onClose={onClose}>
      <div className="dt">
        <DetailHead
          icon={<SubIcon sub={live} size={48} />}
          title={
            <NameLink
              onClick={() => {
                onClose();
                onOpen(live);
              }}
            >
              {live.name}
            </NameLink>
          }
          badge={<StatusPill tone={proxyStatus(st, list)[0]}>{proxyStatus(st, list)[1]}</StatusPill>}
          meta={
            <>
              <b>
                {money(live.price, live.currency)} {cycleLabel(live.cycle)}
              </b>
              {cardCcy && <span>{t('proxy.cardCcy', { ccy: cardCcy })}</span>}
            </>
          }
          onClose={onClose}
        />
        <div className="dt-body">
          <MetricCards>
            {/* 弹窗里看的是明细：金额都写到分，不用简写 */}
            <Metric
              label={t('proxy.paidPeriods', { count: list.length })}
              value={flow(-charged, base)}
              note={list.length ? t('proxy.page.perPeriod', { amount: flow(-charged / list.length, base) }) : undefined}
            />
            <Metric
              label={t('proxy.received')}
              value={flow(received, base)}
              valueClassName="green"
              note={lastIn ? t('proxy.page.lastIn', { date: cnDateFull(lastIn) }) : t('proxy.page.noneIn')}
            />
            <OwedOrNet list={list} base={base} exact />
            {/* 还有待收时，已收各期的汇差单列；全部结清后第三格就是盈亏，不再重复 */}
            {open.length > 0 && Math.abs(diff) >= 0.5 && (
              <Metric
                label={t('family.strip.profit')}
                value={flow(diff, base)}
                valueClassName={diff > 0 ? 'done' : 'loss'}
                note={t('proxy.page.perPeriod', { amount: flow(diff / done.length, base) })}
              />
            )}
          </MetricCards>
          <Facts
            items={
              <>
                <Prop k={t('proxy.forWhom')}>
                  <span className="row">
                    <PersonAvatar p={personFor(state, px.personId, px.forName)} size={20} />
                    {px.forName || t('proxy.unset')}
                  </span>
                  {contactText(px) && <small>{contactText(px)}</small>}
                </Prop>
                <Prop k={t('proxy.method')}>
                  <PayBadge m={method} />
                </Prop>
                <Prop k={stopped ? t('proxy.stoppedAt') : t('proxy.nextCharge')}>
                  {stopped ? (live.end ? cnDateFull(live.end) : '—') : next ? cnDateFull(next) : '—'}
                </Prop>
              </>
            }
          >
            {px.note && <Note text={px.note} />}
          </Facts>

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
                    {/* 窄屏没有「当时成本」一列，外币时折合写在实扣下面 */}
                    {r.currency !== base && <small className="ld-cost-inline">≈ {flow(-r.chargedBase, base)}</small>}
                  </span>
                  <span className="ld-cost">{flow(-r.chargedBase, base)}</span>
                  <span className={r.receivedBase != null ? 'green' : undefined}>
                    {r.receivedBase == null ? (
                      <em className="todo">{ro ? t('proxy.owed') : t('proxy.table.record')}</em>
                    ) : (
                      <>
                        <b className="green">{flow(r.entry!.received!, rc)}</b>
                        {/* 当天就收回的不再写收款日，和左边的扣款日重复 */}
                        {((r.entry?.receivedOn && r.entry.receivedOn !== r.date) || rc !== base) && (
                          <small style={{ color: 'var(--green)' }}>
                            {copyParts(
                              [
                                r.entry?.receivedOn && r.entry.receivedOn !== r.date && t('proxy.table.receivedOn', { date: cnDate(r.entry.receivedOn) }),
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
      </div>
      {edit && <EntrySheet state={state} s={live} row={edit} onClose={() => setEdit(null)} />}
    </DetailSheet>
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
type ProxyView = 'grid' | 'list';
type ProxySort = 'status' | 'name' | 'who' | 'price' | 'next' | 'paid' | 'received' | 'profit';
const isProxySort = (v: string): v is ProxySort => ['status', 'name', 'who', 'price', 'next', 'paid', 'received', 'profit'].includes(v);
/** 默认方向：待收多的在前、名称与对象 A→Z、扣款近的在前、金额大的在前、亏得多的在前 */
const PROXY_SORT_DIR: Record<ProxySort, 'asc' | 'desc'> = {
  status: 'desc',
  name: 'asc',
  who: 'asc',
  price: 'desc',
  next: 'asc',
  paid: 'desc',
  received: 'desc',
  profit: 'asc',
};

/**
 * 代付的列表视图（桌面）：一行一个代付，比卡片多出支付方式、每期本币金额、下次扣款与最近一次收款；点一行打开代付详情。
 * 各列按比例分宽度；表格变窄时先收起 data-p=2 的列，再收起 data-p=3。手机上不出表格，仍用卡片
 */
function ProxyTable({ state, today, subs, onOpen }: { state: AppState; today: string; subs: Subscription[]; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  // 表头排序存在服务端；默认按状态（待收多的在前、已结清其次，已停止始终最后），表头不为默认排序标箭头。
  // 三态：该列默认方向、反向、回到默认
  const [sort, setSort] = usePref<ProxySort>('proxy-sort', 'status', isProxySort);
  const [dir, setDir] = usePref<'asc' | 'desc'>('proxy-dir', PROXY_SORT_DIR[sort], (v): v is 'asc' | 'desc' => v === 'asc' || v === 'desc');
  const onSort = (k: ProxySort) => {
    const [ns, nd] = nextSort(k, sort, dir, PROXY_SORT_DIR, 'status');
    setSort(ns);
    setDir(nd);
  };
  const items = subs.map((s) => {
    const list = rows(state, s, today);
    const st = effectiveStatus(s, today);
    const stopped = ['ended', 'terminated'].includes(st);
    const done = list.filter((r) => r.receivedBase != null);
    const open = list.filter((r) => r.receivedBase == null);
    return {
      s,
      list,
      st,
      stopped,
      done,
      open,
      next: stopped ? undefined : nextCharge(s, addDays(today, 1)),
      charged: list.reduce((a, r) => a + r.chargedBase, 0),
      received: done.reduce((a, r) => a + r.receivedBase!, 0),
      owed: open.reduce((a, r) => a + r.chargedBase, 0),
      diff: done.reduce((a, r) => a + r.receivedBase! - r.chargedBase, 0),
      priceBase: toBaseAt(state, s.price, s.currency),
    };
  });
  type Item = (typeof items)[number];
  const num = (v: number) => (Number.isFinite(v) ? v : 0);
  // 状态：待收的按金额排在最前，其次已结清，还没扣过款的最后
  const statusRank = (x: Item) => (x.open.length ? 1e9 + num(x.owed) : x.done.length ? 1 : 0);
  const amountOf = (x: Item) => ({ status: statusRank(x), price: x.priceBase, paid: x.charged, received: x.received, profit: x.diff });
  const asc = (a: Item, b: Item): number =>
    sort === 'name'
      ? a.s.name.localeCompare(b.s.name, locale())
      : sort === 'who'
        ? (a.s.proxy!.forName ?? '').localeCompare(b.s.proxy!.forName ?? '', locale())
        : sort === 'next'
          ? (a.next ?? a.s.end ?? '9999').localeCompare(b.next ?? b.s.end ?? '9999')
          : num(amountOf(a)[sort]) - num(amountOf(b)[sort]);
  const sorted = [...items].sort((a, b) => Number(a.stopped) - Number(b.stopped) || (dir === 'asc' ? asc(a, b) : asc(b, a)));
  const [ledger, setLedger] = useState<string | null>(null);
  const ledgerSub = ledger ? state.subscriptions.find((x) => x.id === ledger) : undefined;
  const fmt = (v: number) => flow(v, base, { compact: true });
  return (
    <div className="ltable-wrap">
      <div className="ltable lt-x proxy-lt" role="table">
        <LtHead<ProxySort>
          initial={['status', PROXY_SORT_DIR.status]}
          sort={sort}
          dir={dir}
          onSort={onSort}
          cols={[
            { label: t('list.col.name'), sort: 'name' },
            { label: t('proxy.forWhom'), sort: 'who' },
            { label: t('family.pool.status'), sort: 'status' },
            { label: t('proxy.method'), p: 2 },
            { label: t('list.col.planPrice'), sort: 'price', p: 3, num: true },
            { label: t('proxy.nextCharge'), sort: 'next', num: true },
            { label: t('proxy.paid'), sort: 'paid', p: 3, num: true },
            { label: t('proxy.received'), sort: 'received', p: 3, num: true },
            { label: t('family.strip.profit'), sort: 'profit', num: true },
          ]}
        />
        {sorted.map(({ s, list, st, stopped, next, charged, done, open, received, owed, diff, priceBase }) => {
          const [tone, label] = proxyStatus(st, list);
          const lastIn = done.map((r) => r.entry?.receivedOn ?? r.date).reduce<string | undefined>((a, d) => (!a || d > a ? d : a), undefined);
          const px = s.proxy!;
          return (
            <button key={s.id} className={`lt-row ${stopped ? 'st-ended' : ''}`} role="row" onClick={() => setLedger(s.id)}>
              <span className="lt-name">
                <SubIcon sub={s} size={32} />
                <span className="lt-title">
                  <span className="nm">
                    <b>{s.name}</b>
                  </span>
                  <small className="lt-sub">{t('family.strip.since', { date: cnDateFull(s.start) })}</small>
                </span>
              </span>
              {/* 人员一律用胶囊，与卡片里的「替谁付」一致 */}
              <span className="lt-who" title={px.note}>
                <span className="who-chip">
                  <PersonAvatar p={personFor(state, px.personId, px.forName)} size={16} />
                  {px.forName || t('proxy.unset')}
                  {contactText(px) && <em>{contactText(px)}</em>}
                </span>
              </span>
              {/* 状态胶囊：已停止 > 待收约多少 > 已结清；计费中还没扣过款的不显示。放在左侧文字区，右边都是数字 */}
              <span className="lt-status">
                {tone === 'ok' ? (
                  <small>—</small>
                ) : (
                  <StatusPill tone={tone}>
                    {tone === 'owe' ? t('family.pool.owedAmount', { amount: `≈ ${money(owed, base, { compact: true })}` }) : label}
                  </StatusPill>
                )}
              </span>
              <span className="lt-pay" data-p={2}>
                <PayBadge m={state.methods.find((m) => m.id === s.methodId)} />
              </span>
              <PlanPrice state={state} s={s} today={today} />
              <span className="lt-num">
                {/* 已停止的不再有下次扣款，留空 */}
                {stopped ? null : next ? (
                  <>
                    {cnDate(next)}
                    <small>{relDays(diffDays(today, next))}</small>
                  </>
                ) : (
                  <small>—</small>
                )}
              </span>
              <span className="lt-num" data-p={3}>
                {fmt(-charged)}
                <small>{t('proxy.periods', { count: list.length })}</small>
              </span>
              <span className="lt-num" data-p={3}>
                {done.length ? (
                  <>
                    {fmt(received)}
                    {lastIn && <small>{t('proxy.lastIn', { date: cnDate(lastIn) })}</small>}
                  </>
                ) : (
                  <small>—</small>
                )}
              </span>
              <span className={`lt-num ${Math.abs(diff) < 0.5 ? '' : diff > 0 ? 'gain' : 'loss'}`}>
                {!done.length ? <small>—</small> : Math.abs(diff) < 0.5 ? t('proxy.table.even') : fmt(diff)}
              </span>
            </button>
          );
        })}
      </div>
      {ledgerSub && <LedgerSheet state={state} s={ledgerSub} onClose={() => setLedger(null)} onOpen={onOpen} />}
    </div>
  );
}

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
  const [savedView, setView] = usePref<ProxyView>('proxy-view', 'grid', (v): v is ProxyView => v === 'grid' || v === 'list');
  const phone = usePhone();
  const view = phone ? 'grid' : savedView;
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
        {sum.subs.length > 0 && !phone && (
          <Seg
            small
            value={view}
            onChange={setView}
            options={[
              ['grid', t('list.view.grid')],
              ['list', t('list.view.list')],
            ]}
          />
        )}
      </Toolbar>
      <div className="page fade-in stack">
        {/* 与卡片同一套口径：已代付、已收回、盈亏；还有没收回的才加一格待收 */}
        <MetricCards>
          <Metric
            label={t('proxy.paidPeriods', { count: sum.count })}
            value={<Amount value={-sum.charged} ccy={base} />}
            note={sum.next ? t('proxy.page.liveNext', { count: sum.live, date: cnDate(sum.next) }) : t('proxy.page.subs', { count: sum.subs.length })}
          />
          <Metric
            label={t('proxy.received')}
            value={<Amount value={sum.received} ccy={base} />}
            valueStyle={{ color: 'var(--green)' }}
            note={sum.lastIn ? t('proxy.page.lastIn', { date: cnDateFull(sum.lastIn) }) : t('proxy.page.noneIn')}
          />
          <Metric
            label={t('family.strip.profit')}
            value={Math.abs(sum.diff) < 0.5 ? t('proxy.table.even') : <Amount value={sum.diff} ccy={base} />}
            valueStyle={{ color: Math.abs(sum.diff) < 0.5 ? undefined : sum.diff > 0 ? 'var(--green)' : 'var(--red)' }}
            note={
              sum.closedCount ? t('proxy.page.diffAvg', { count: sum.closedCount, amount: flow(sum.diff / sum.closedCount, base) }) : t('proxy.page.diffSub')
            }
          />
          {sum.owedCount > 0 && (
            <Metric
              label={t('proxy.owed')}
              value={<Amount plain value={sum.owed} ccy={base} />}
              valueStyle={{ color: 'var(--orange)' }}
              note={t('proxy.page.owedSub', { count: sum.owedCount })}
            />
          )}
        </MetricCards>
        {sum.subs.length === 0 ? (
          <div className="card empty">
            <b>{t('proxy.page.emptyTitle')}</b>
            {t('proxy.page.emptyBody')}
          </div>
        ) : (
          <>
            {shown.length === 0 && <div className="card empty">{t('proxy.filter.none')}</div>}
            {view === 'list' ? (
              shown.length > 0 && <ProxyTable state={state} today={today} subs={shown} onOpen={onOpen} />
            ) : (
              <div className="grid g-2">
                {shown.map((s) => (
                  <ProxyCard key={s.id} state={state} s={s} onOpen={onOpen} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
