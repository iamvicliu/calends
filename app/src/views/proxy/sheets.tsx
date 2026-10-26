import { copyParts } from '../../components/copy.tsx';
import { PersonAvatar, personFor } from '../../components/PersonAvatar.tsx';
import { useState } from 'react';
import { addDays, cycleLabel, effectiveStatus, nextCharge, todayIn, isStopped } from '../../../../shared/billing.ts';
import { flow, cnDate, cnDateFull, money } from '../../../../shared/format.ts';
import { toBaseOrNaN } from '../../../../shared/fx.ts';
import type { AppState, Receipt, Subscription, Waiver } from '../../../../shared/types.ts';
import { recordProxyCharge } from '../../../../shared/receivable-edit.ts';
import { ReceivableSheet } from '../Receivable.tsx';
import { DetailHead, DetailSheet, Facts, Note, Panel, Prop } from '../../components/DetailKit.tsx';
import { YearLedger } from '../../components/YearLedger.tsx';
import { MetricCards, Metric, Cell, Group } from '../../components/ui.tsx';
import { MoneyInput, useSubmit } from '../../components/inputs.tsx';
import { NameLink, PayBadge, StatusPill, SubIcon } from '../../components/marks.tsx';
import { Sheet } from '../../components/overlays.tsx';
import { Icon } from '../../components/icons.tsx';
import { Plus } from 'lucide-react';
import { contactText } from '../../components/Contact.tsx';
import { getState, saveSub } from '../../store.ts';
import { run } from '../../toast.ts';
import { CurrencySelect } from '../../components/Picker.tsx';
import { proxyAhead, proxyLedger, proxyTotals } from '../../../../shared/proxy.ts';
import { t } from '../../../../shared/i18n.ts';
import type { Row } from './common.tsx';
import { rows } from './common.tsx';
import { proxyStatus } from './common.tsx';
import { OwedOrNet } from './common.tsx';

/** 代付详情：上面是订阅与对象的基本信息和汇总，下面是每一期的扣款与收款列表；点一行记收款或修改 */
export function LedgerSheet({ state, s, onClose, onOpen }: { state: AppState; s: Subscription; onClose: () => void; onOpen: (s: Subscription) => void }) {
  const today = todayIn(state.settings.timezone);
  const base = state.settings.baseCurrency;
  const live = state.subscriptions.find((x) => x.id === s.id) ?? s;
  const list = rows(state, live, today);
  const ahead = proxyAhead(state, live, today);
  const [edit, setEdit] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const px = live.proxy!;
  const st = effectiveStatus(live, today);
  const stopped = isStopped(st);
  const next = nextCharge(live, addDays(today, 1));
  const method = state.methods.find((m) => m.id === live.methodId);
  const { charged, done, received, open, diff, lastIn } = proxyTotals(list);
  // 表格的行：预收的期（还没扣款）在前，然后是已扣款的期，都按日期从新到旧
  const all = [...ahead, ...list];
  const cardCcy = list.find((r) => r.currency !== r.listCurrency)?.currency;

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
          badge={<StatusPill tone={proxyStatus(st, list, ahead)[0]}>{proxyStatus(st, list, ahead)[1]}</StatusPill>}
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
              note={
                // 预收的期还没扣款，不计入已收回，在这里单独说一句
                ahead.length
                  ? t('proxy.page.prepaid', {
                      count: ahead.length,
                      amount: money(
                        ahead.reduce((a, r) => a + r.receivedBase!, 0),
                        base,
                      ),
                    })
                  : lastIn
                    ? t('proxy.page.lastIn', { date: cnDateFull(lastIn) })
                    : t('proxy.page.noneIn')
              }
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

          {/* 与订阅详情、合租详情一样：标题和操作在卡片里，表格贴着卡片边 */}
          <Panel
            className="dt-charges"
            title={t('proxy.table.title')}
            aside={
              <button className="dt-btn dt-add" onClick={() => setAdding(true)}>
                <Plus size={14} /> {t('proxy.receipt.add')}
              </button>
            }
          >
            {/* 与订阅详情、合租详情同一套表格（YearLedger）：只有一年就平铺，跨年按年分组带小计；没有合计行，总数在上方指标卡 */}
            {all.length ? (
              <YearLedger
                items={all}
                keepSecond
                dateOf={(r) => r.date}
                head={[t('proxy.table.date'), t('proxy.table.charged'), t('proxy.table.received'), t('proxy.table.diff')]}
                extraHead={t('proxy.table.cost')}
                yearCells={(ys) => {
                  // 小计只算已经扣款的期：预收的期还没扣，不计入已代付与盈亏（与上方指标卡一致）
                  const done = ys.filter((r) => r.date <= today);
                  const ccys = new Set(done.map((r) => r.currency));
                  const settled = done.filter((r) => r.receivedBase != null);
                  const d = settled.reduce((a, r) => a + r.receivedBase! - r.chargedBase, 0);
                  return {
                    second: ccys.size === 1 ? flow(-done.reduce((a, r) => a + r.charged, 0), done[0].currency) : '',
                    extra: flow(-done.reduce((a, r) => a + r.chargedBase, 0), base),
                    orig: (
                      <span className="green">
                        {flow(
                          settled.reduce((a, r) => a + r.receivedBase!, 0),
                          base,
                        )}
                      </span>
                    ),
                    base: settled.length ? (Math.abs(d) < 0.5 ? t('proxy.table.even') : flow(d, base)) : '—',
                    baseClass: !settled.length || Math.abs(d) < 0.5 ? 'muted' : d > 0 ? 'gain' : 'loss',
                  };
                }}
                row={(r) => {
                  const ahead = r.date > today;
                  const d = ahead || r.receivedBase == null ? undefined : r.receivedBase - r.chargedBase;
                  return {
                    date: (
                      <>
                        {cnDate(r.date)}
                        {ahead && <small>{t('proxy.table.notCharged')}</small>}
                      </>
                    ),
                    second: flow(-r.charged, r.currency),
                    extra: flow(-r.chargedBase, base),
                    orig: r.receivedBase == null ? <em className="todo">{t('proxy.table.record')}</em> : <ReceivedCell r={r} base={base} brief />,
                    base: d == null ? '—' : Math.abs(d) < 0.5 ? t('proxy.table.even') : flow(d, base),
                    baseClass: d == null || Math.abs(d) < 0.5 ? 'muted' : d > 0 ? 'gain' : 'loss',
                  };
                }}
                rowKey={(r) => r.date}
                rowClass={(r) => (r.date > today ? 'ld-ahead' : '')}
                onRow={setEdit}
              />
            ) : (
              <div className="muted dt-import-note">{t('proxy.table.none')}</div>
            )}
          </Panel>
        </div>
      </div>
      {edit && <EntrySheet state={state} s={live} row={edit} onClose={() => setEdit(null)} />}
      {adding && <ReceiptSheet state={state} s={live} onClose={() => setAdding(false)} />}
    </DetailSheet>
  );
}

/** 收回一列：这一期分到的钱；收款日与扣款日不同、外币折合、一笔分几期时在下面补一行。免收、期初结清写明 */
export function ReceivedCell({ r, base, brief }: { r: Row; base: string; brief?: boolean }) {
  if (r.status === 'waived') return <span className="muted">{t('receivable.waived')}</span>;
  const e = r.receipt!;
  if (r.share == null) return <span className="green">{t('receivable.opening')}</span>;
  // 表格里只写收回多少，每行一样高；收款日、外币折合、一笔分几期点开这一期再看
  if (brief)
    return (
      <span>
        <b className="green">{flow(r.share, e.currency)}</b>
      </span>
    );
  const lines = [
    // 当天就收回的不再写收款日，和左边的扣款日重复
    e.date !== r.date && t('proxy.table.receivedOn', { date: cnDate(e.date) }),
    e.currency !== base && `≈ ${flow(r.receivedBase!, base)}`,
  ].filter(Boolean);
  return (
    <span className="green">
      <b className="green">{flow(r.share, e.currency)}</b>
      {lines.length > 0 && <small style={{ color: 'var(--green)' }}>{copyParts(lines.join('\n'))}</small>}
      {/* 一笔分几期只在宽屏写；窄屏点开这一期能看到 */}
      {e.periods.length > 1 && (
        <small className="ld-batch" style={{ color: 'var(--green)' }}>
          {t('proxy.table.batch', { amount: money(e.amount, e.currency), count: e.periods.length })}
        </small>
      )}
    </span>
  );
}

/**
 * 记一笔收款或免收（与合租同一个表单）：勾选抵扣哪几期，可以跳过前面没收的期，也可以勾还没扣款的期（预收）；
 * 金额按各期实扣的比例分摊。传 edit 时修改那一笔
 */
export function ReceiptSheet({
  state,
  s,
  edit,
  preset,
  onClose,
}: {
  state: AppState;
  s: Subscription;
  edit?: Receipt | Waiver;
  preset?: string[];
  onClose: () => void;
}) {
  const today = todayIn(state.settings.timezone);
  const px = s.proxy!;
  return (
    <ReceivableSheet
      state={state}
      today={today}
      title={
        <span className="icon-text">
          <PersonAvatar p={personFor(state, px.personId, px.forName)} size={24} />
          {px.forName || t('proxy.unset')}
        </span>
      }
      ledger={(through) => proxyLedger(s, today, through).periods}
      record={px}
      edit={edit}
      preset={preset}
      defaultCurrency={state.settings.baseCurrency}
      save={async (r) => {
        const current = getState().subscriptions.find((x) => x.id === s.id) ?? s;
        await saveSub({ ...current, proxy: { ...current.proxy!, receipts: r.receipts, waivers: r.waivers } });
      }}
      onDone={onClose}
    />
  );
}

/** 一期的详情：卡上实扣（可修正）和这一期收回的情况；记收款、改收款都进同一个收款表单 */
export function EntrySheet({ state, s, row, onClose }: { state: AppState; s: Subscription; row: Row; onClose: () => void }) {
  const base = state.settings.baseCurrency;
  const today = todayIn(state.settings.timezone);
  const live = state.subscriptions.find((x) => x.id === s.id) ?? s;
  const future = row.date > today;
  const [charged, setCharged] = useState(row.charge?.amount != null ? String(row.charge.amount) : '');
  const [chargedCcy, setChargedCcy] = useState(row.charge?.currency ?? row.listCurrency);
  const [receipt, setReceipt] = useState(false);
  const chargedN = charged === '' ? row.list : Number(charged);
  // 缺汇率时为 NaN：差额显示「—」，不按 0 算出假的盈亏
  const chargedBase = toBaseOrNaN(state, chargedN, charged === '' ? row.listCurrency : chargedCcy, row.date);
  const rec = row.receipt ?? row.waiver;
  const diff = row.receivedBase == null ? undefined : row.receivedBase - chargedBase;
  const dirty =
    charged !== (row.charge?.amount != null ? String(row.charge.amount) : '') || (charged !== '' && chargedCcy !== (row.charge?.currency ?? row.listCurrency));

  const [busy, submit] = useSubmit();
  const save = () =>
    run(async () => {
      const amount = charged === '' ? undefined : Number(charged);
      const { after } = recordProxyCharge(
        live,
        {
          charge: row.date,
          ...(amount != null ? { amount } : {}),
          ...(amount != null && chargedCcy !== row.listCurrency ? { currency: chargedCcy } : {}),
          ...(row.charge?.note ? { note: row.charge.note } : {}),
        },
        today,
      );
      await saveSub(after);
      onClose();
    }, t('proxy.entry.saved'));

  return (
    <Sheet
      narrow
      title={t('proxy.entry.title', { date: cnDateFull(row.date) })}
      onClose={onClose}
      foot={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('proxy.entry.cancel')}
          </button>
          {!future && (
            <button
              className="btn primary"
              disabled={busy || !dirty || (charged !== '' && !Number.isFinite(Number(charged)))}
              onClick={() => void submit(save)}
            >
              {t('proxy.entry.save')}
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="row">
          <PersonAvatar p={personFor(state, live.proxy!.personId, live.proxy!.forName)} size={36} />
          <b>{live.proxy!.forName}</b>
        </div>
        {/* 还没到扣款日的期没有实扣可改 */}
        {!future && (
          <Group
            title={t('proxy.table.charged')}
            foot={t('proxy.entry.chargedFoot', { amount: flow(-chargedBase, base), list: money(row.list, row.listCurrency) })}
          >
            <Cell label={t('proxy.entry.amount')}>
              <MoneyInput
                ccy={chargedCcy}
                className="num"
                value={charged}
                placeholder={String(row.list)}
                onChange={(ev) => setCharged((ev.target as HTMLInputElement).value)}
              />
            </Cell>
            <Cell label={t('proxy.entry.currency')}>
              <CurrencySelect value={chargedCcy} onChange={setChargedCcy} />
            </Cell>
          </Group>
        )}
        <Group
          title={live.proxy!.forName ? t('proxy.entry.paidBack', { name: live.proxy!.forName }) : t('proxy.entry.paidBackAnon')}
          foot={
            diff == null || row.status === 'waived'
              ? undefined
              : t(Math.abs(diff) < 0.5 ? 'proxy.entry.receivedEven' : diff > 0 ? 'proxy.entry.receivedMore' : 'proxy.entry.receivedLess', {
                  amount: flow(row.receivedBase!, base),
                  diff: money(Math.abs(diff), base),
                })
          }
        >
          {rec ? (
            <button type="button" className="cell tap" disabled={!!row.receipt?.opening} onClick={() => setReceipt(true)}>
              <span className="cell-l">
                <ReceivedCell r={row} base={base} />
                <small className="muted">
                  {copyParts(
                    [cnDateFull(rec.date), rec.periods.length > 1 && t('receivable.periodsCount', { count: rec.periods.length }), rec.note]
                      .filter(Boolean)
                      .join('\n'),
                  )}
                </small>
              </span>
            </button>
          ) : (
            <button type="button" className="cell tap member-pay-add" onClick={() => setReceipt(true)}>
              <Icon name="plus" /> {t('proxy.receipt.add')}
            </button>
          )}
        </Group>
      </div>
      {receipt && <ReceiptSheet state={state} s={live} edit={rec} preset={rec ? undefined : [row.key]} onClose={() => setReceipt(false)} />}
    </Sheet>
  );
}
