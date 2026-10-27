import { formatTotal, scaleTotal, totalNote } from '../../../../shared/fx-total.ts';
import { copyParts } from '../../components/copy.tsx';
import { PersonAvatar, personFor } from '../../components/PersonAvatar.tsx';
import { useState } from 'react';
import { addDays, cycleLabel, effectiveStatus, nextCharge, todayIn, isStopped, uid } from '../../../../shared/billing.ts';
import { flow, cnDate, cnDateFull, money } from '../../../../shared/format.ts';
import { toBaseOrNaN } from '../../../../shared/fx.ts';
import type { AppState, Receipt, Subscription, Waiver } from '../../../../shared/types.ts';
import { recordProxyCharge } from '../../../../shared/receivable-edit.ts';
import { editRecordPeriod, removeRecordPeriod } from '../../../../shared/receivables.ts';
import { DatePicker } from '../../components/DatePicker.tsx';
import { ReceivableSheet } from '../Receivable.tsx';
import { DetailHead, DetailSheet, Facts, Note, Panel, Prop } from '../../components/DetailKit.tsx';
import { YearLedger } from '../../components/YearLedger.tsx';
import { MetricCards, Metric, Cell, Group } from '../../components/ui.tsx';
import { MoneyInput, NumInput, useSubmit } from '../../components/inputs.tsx';
import { NameLink, PayBadge, StatusPill, SubIcon } from '../../components/marks.tsx';
import { Sheet } from '../../components/overlays.tsx';
import { ConfirmButton } from '../../components/ConfirmButton.tsx';
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
  const { done, open, diff, lastIn, partial } = proxyTotals(list);
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
              value={formatTotal(partial.charged, base, { direction: -1, main: true })}
              note={
                totalNote(partial.charged) ||
                (list.length
                  ? t('proxy.page.perPeriod', { amount: formatTotal(scaleTotal(partial.charged, 1 / list.length), base, { direction: -1, average: true }) })
                  : undefined)
              }
            />
            <Metric
              label={t('proxy.received')}
              value={formatTotal(partial.received, base, { direction: 1, main: true })}
              valueClassName="green"
              note={
                // 预收的期还没扣款，不计入已收回，在这里单独说一句
                partial.received.incomplete
                  ? totalNote(partial.received)
                  : ahead.length
                    ? t('proxy.page.prepaid', {
                        count: ahead.length,
                        amount: formatTotal(proxyTotals(ahead).partial.received, base),
                      })
                    : lastIn
                      ? t('proxy.page.lastIn', { date: cnDateFull(lastIn) })
                      : t('proxy.page.noneIn')
              }
            />
            <OwedOrNet list={list} base={base} exact />
            {/* 还有待收时，已收各期的汇差单列；全部结清后第三格就是盈亏，不再重复 */}
            {open.length > 0 && (Math.abs(diff) >= 0.5 || partial.diff.incomplete) && (
              <Metric
                label={t('family.strip.profit')}
                value={formatTotal(partial.diff, base, { direction: 1, main: true })}
                valueClassName={partial.diff.incomplete ? undefined : diff > 0 ? 'done' : 'loss'}
                note={
                  totalNote(partial.diff) ||
                  t('proxy.page.perPeriod', { amount: formatTotal(scaleTotal(partial.diff, 1 / done.length), base, { direction: 1, average: true }) })
                }
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
            {/* 与订阅详情、合租详情同一套表格（YearLedger）：每年最多一条时平铺，任一年多条则统一按年分组带小计；没有合计行，总数在上方指标卡 */}
            {all.length ? (
              <YearLedger
                items={all}
                keepSecond
                dateOf={(r) => r.date}
                head={[t('proxy.table.date'), t('proxy.table.charged'), t('proxy.table.received'), t('proxy.table.diff')]}
                extraHead={t('proxy.table.cost')}
                yearCells={(ys) => {
                  // 实扣、成本、差额只算已经扣款的期：预收的期还没扣，不计入已代付与盈亏（与上方指标卡一致）；收回按实际收到的钱，预收的也算
                  const done = ys.filter((r) => r.date <= today);
                  const ccys = new Set(done.map((r) => r.currency));
                  const settled = done.filter((r) => r.receivedBase != null);
                  const received = ys.filter((r) => r.receivedBase != null);
                  const d = settled.reduce((a, r) => a + r.receivedBase! - r.chargedBase, 0);
                  return {
                    second: ccys.size === 1 ? flow(-done.reduce((a, r) => a + r.charged, 0), done[0].currency) : '',
                    extra: formatTotal(proxyTotals(done).partial.charged, base, { direction: -1 }),
                    orig: <span className="green">{formatTotal(proxyTotals(received).partial.received, base, { direction: 1 })}</span>,
                    base: settled.length
                      ? Math.abs(d) < 0.5
                        ? t('proxy.table.even')
                        : formatTotal(proxyTotals(settled).partial.diff, base, { direction: 1 })
                      : '—',
                    baseClass: !settled.length || !Number.isFinite(d) || Math.abs(d) < 0.5 ? 'muted' : d > 0 ? 'gain' : 'loss',
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
                    baseClass: d == null || !Number.isFinite(d) || Math.abs(d) < 0.5 ? 'muted' : d > 0 ? 'gain' : 'loss',
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

/**
 * 一期的详情：卡上实扣和这一期收回的情况。平时只看；点「编辑」后就地改实扣、收款日期、金额和备注，再点保存。
 * 一笔分几期时改的是这一期，保存时把它单独拆出来；删除也只去掉这一期。没收的期另记一笔
 */
export function EntrySheet({ state, s, row, onClose }: { state: AppState; s: Subscription; row: Row; onClose: () => void }) {
  const base = state.settings.baseCurrency;
  const today = todayIn(state.settings.timezone);
  const live = state.subscriptions.find((x) => x.id === s.id) ?? s;
  const future = row.date > today;
  const rec = row.receipt ?? row.waiver;
  const opening = !!row.receipt?.opening;
  // 期初结清金额不详，只能删；还没扣款的期没有实扣可改
  const recEditable = !!rec && !opening;
  const [editing, setEditing] = useState(false);
  const [recording, setRecording] = useState(false);
  const charged0 = row.charge?.amount != null ? String(row.charge.amount) : '';
  const [charged, setCharged] = useState(charged0);
  const [chargedCcy, setChargedCcy] = useState(row.charge?.currency ?? row.listCurrency);
  const [date, setDate] = useState(rec?.date ?? today);
  const [amount, setAmount] = useState<number | undefined>(row.share);
  const [note, setNote] = useState(rec?.note ?? '');
  const chargedN = charged === '' ? row.list : Number(charged);
  // 缺汇率时为 NaN：差额显示「—」，不按 0 算出假的盈亏
  const chargedBase = toBaseOrNaN(state, chargedN, charged === '' ? row.listCurrency : chargedCcy, row.date);
  // 还没扣款的期没有实扣，不比盈亏
  const diff = future || row.receivedBase == null ? undefined : row.receivedBase - chargedBase;
  const chargeDirty = !future && (charged !== charged0 || (charged !== '' && chargedCcy !== (row.charge?.currency ?? row.listCurrency)));
  const recDirty = recEditable && (date !== rec.date || note !== (rec.note ?? '') || (!!row.receipt && amount !== row.share));
  const valid = (charged === '' || Number.isFinite(Number(charged))) && (!row.receipt || (amount != null && amount >= 0));

  const [busy, submit] = useSubmit();
  const save = () =>
    run(async () => {
      let next = getState().subscriptions.find((x) => x.id === s.id) ?? live;
      if (chargeDirty) {
        const n = charged === '' ? undefined : Number(charged);
        next = recordProxyCharge(
          next,
          {
            charge: row.date,
            ...(n != null ? { amount: n } : {}),
            ...(n != null && chargedCcy !== row.listCurrency ? { currency: chargedCcy } : {}),
            ...(row.charge?.note ? { note: row.charge.note } : {}),
          },
          today,
        ).after;
      }
      if (recDirty) {
        const periods = proxyLedger(next, today).periods;
        next = { ...next, proxy: { ...next.proxy!, ...editRecordPeriod(next.proxy!, rec.id, row, { date, amount, note: note.trim() }, periods, uid()) } };
      }
      await saveSub(next);
      onClose();
    }, t('proxy.entry.saved'));
  // 只把这一期从记录里去掉：一笔分几期时其余期照旧，金额扣掉这一期分到的
  const remove = () =>
    rec &&
    submit(() =>
      run(async () => {
        const current = getState().subscriptions.find((x) => x.id === s.id) ?? live;
        const periods = proxyLedger(current, today).periods;
        await saveSub({ ...current, proxy: { ...current.proxy!, ...removeRecordPeriod(current.proxy!, rec.id, row, periods) } });
        onClose();
      }, t('receivable.toastRemoved')),
    );

  return (
    <Sheet
      narrow
      title={t('proxy.entry.title', { date: cnDateFull(row.date) })}
      onClose={onClose}
      foot={
        <>
          {rec && (
            <ConfirmButton disabled={busy} hint={t('receivable.toastRemoved')} onConfirm={() => void remove()}>
              {t('common.delete')}
            </ConfirmButton>
          )}
          <span className="grow" />
          <button className="btn" onClick={editing ? () => setEditing(false) : onClose}>
            {t('proxy.entry.cancel')}
          </button>
          {editing ? (
            <button className="btn primary" disabled={busy || !valid || !(chargeDirty || recDirty)} onClick={() => void submit(save)}>
              {t('proxy.entry.save')}
            </button>
          ) : (
            <>
              {(recEditable || !future) && (
                <button className={rec ? 'btn primary' : 'btn'} disabled={busy} onClick={() => setEditing(true)}>
                  {t('detail.action.edit')}
                </button>
              )}
              {!rec && (
                <button className="btn primary" disabled={busy} onClick={() => setRecording(true)}>
                  {t('proxy.table.record')}
                </button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="stack">
        {/* 卡上实扣：已扣的点编辑后可修正；还没到扣款日的只写按原价预计 */}
        <Group
          title={t('proxy.table.charged')}
          foot={future ? undefined : t('proxy.entry.chargedFoot', { amount: flow(-chargedBase, base), list: money(row.list, row.listCurrency) })}
        >
          {future ? (
            <Cell label={t('proxy.entry.amount')}>
              <span className="row">
                <span className="badge">{t('proxy.table.notCharged')}</span>
                <span className="muted">{flow(-row.list, row.listCurrency)}</span>
              </span>
            </Cell>
          ) : editing ? (
            <>
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
            </>
          ) : (
            <Cell label={t('proxy.entry.amount')}>
              <span className="num">{flow(-chargedN, charged === '' ? row.listCurrency : chargedCcy)}</span>
            </Cell>
          )}
        </Group>
        <Group
          title={
            row.waiver
              ? t('receivable.waiverGroup')
              : live.proxy!.forName
                ? t('proxy.entry.paidBack', { name: live.proxy!.forName })
                : t('proxy.entry.paidBackAnon')
          }
          foot={
            editing
              ? recEditable && rec.periods.length > 1
                ? t('proxy.entry.splitEdit')
                : undefined
              : diff == null || row.status === 'waived'
                ? undefined
                : !Number.isFinite(diff)
                  ? t('core.fxIncomplete')
                  : t(Math.abs(diff) < 0.5 ? 'proxy.entry.receivedEven' : diff > 0 ? 'proxy.entry.receivedMore' : 'proxy.entry.receivedLess', {
                      amount: flow(row.receivedBase!, base),
                      diff: money(Math.abs(diff), base),
                    })
          }
        >
          {!rec ? (
            <div className="cell muted">{t('proxy.entry.notReceived')}</div>
          ) : opening ? (
            <div className="cell">{t('receivable.opening')}</div>
          ) : (
            <>
              <Cell label={row.receipt ? t('receivable.receivedOn') : t('receivable.waivedOn')}>
                {editing ? <DatePicker value={date} onChange={(v) => setDate(v ?? rec.date)} /> : cnDateFull(rec.date)}
              </Cell>
              {row.receipt && (
                <Cell label={t('proxy.table.received')}>
                  {editing ? (
                    <NumInput className="num" ccy={row.receipt.currency} value={amount} onValue={setAmount} />
                  ) : (
                    <b className="green num">{flow(row.share ?? 0, row.receipt.currency)}</b>
                  )}
                </Cell>
              )}
              {row.receipt && row.receipt.periods.length > 1 && (
                <Cell label={t('receivable.periods')}>
                  {t('proxy.table.batch', { amount: money(row.receipt.amount, row.receipt.currency), count: row.receipt.periods.length })}
                </Cell>
              )}
              {editing ? (
                <Cell label={t('receivable.note')}>
                  <input value={note} placeholder={t('receivable.notePh')} onChange={(e) => setNote(e.target.value)} />
                </Cell>
              ) : (
                rec.note && <Cell label={t('receivable.note')}>{copyParts(rec.note)}</Cell>
              )}
            </>
          )}
        </Group>
      </div>
      {recording && <ReceiptSheet state={state} s={live} preset={[row.key]} onClose={() => setRecording(false)} />}
    </Sheet>
  );
}
