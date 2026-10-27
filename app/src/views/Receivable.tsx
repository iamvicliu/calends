import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import { addDays, addMonths, diffDays, uid } from '../../../shared/billing.ts';
import { periodsTotal } from '../../../shared/carpool.ts';
import { convertOn } from '../../../shared/fx.ts';
import { cnDate, cnDateFull, currencyDecimals, flow, money } from '../../../shared/format.ts';
import { t } from '../../../shared/i18n.ts';
import { periodCellKind, periodGrid, periodTipData, type PeriodGridMode } from '../../../shared/period-grid.ts';
import { isSettled, putRecord, removeRecord, resolveKey, resolvedPeriods, type LedgerPeriod, type Receivable } from '../../../shared/receivables.ts';
import type { AppState, Receipt, Waiver } from '../../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { CurrencySelect } from '../components/Picker.tsx';
import { Sheet, tipProps, tipSet, TipTable } from '../components/overlays.tsx';
import { Cell, Group } from '../components/ui.tsx';
import { ConfirmButton } from '../components/ConfirmButton.tsx';
import { NumInput, useSubmit } from '../components/inputs.tsx';
import { run } from '../toast.ts';

/** 一期的起止：起始日带年份，同一年内的结束日不重复年份 */
export const periodRange = (p: Pick<LedgerPeriod, 'from' | 'until'>) =>
  p.from === p.until ? cnDateFull(p.from) : `${cnDateFull(p.from)} – ${p.until.slice(0, 4) === p.from.slice(0, 4) ? cnDate(p.until) : cnDateFull(p.until)}`;

/** 一笔收款、免收抵扣的期：一期写起止，多期写期数和首尾 */
export function recordPeriods(r: Receipt | Waiver, periods: LedgerPeriod[]): string {
  const hit = resolvedPeriods(periods, r).map((k) => periods.find((p) => p.key === k)!);
  if (!hit.length) return t('receivable.unmatched', { date: cnDate(r.periods[0]) });
  if (hit.length === 1) return periodRange(hit[0]);
  return t('receivable.periodsSpan', { count: hit.length, from: cnDate(hit[0].from), until: cnDate(hit.at(-1)!.until) });
}

export const isReceipt = (r: Receipt | Waiver | undefined): r is Receipt => !!r && 'amount' in r;

/**
 * 按期记收款、免收（合租成员与代付共用）：勾选抵扣哪几期——可以跳过前面欠着的期，也可以勾还没到期的期（提前收）；
 * 金额默认是勾选各期应收的合计，按各期应收的比例分摊。传 edit 时修改那一笔，可删除
 */
export function ReceivableSheet({
  state,
  title,
  head,
  ledger,
  record,
  edit,
  preset,
  today,
  save,
  onDone,
  defaultCurrency,
}: {
  state: AppState;
  title: ReactNode;
  /** 表单顶部：是谁、哪辆车、收费标准 */
  head?: ReactNode;
  /** 这笔账的各期，至少算到 through；往后要提前收时传更晚的日子再算 */
  ledger: (through: string) => LedgerPeriod[];
  record: Receivable;
  edit?: Receipt | Waiver;
  /** 新记一笔时默认勾选的期；缺省为最早没结清的一期 */
  preset?: string[];
  today: string;
  save: (next: Receivable) => Promise<void>;
  onDone: () => void;
  /** 收款默认币种；缺省同应收 */
  defaultCurrency?: string;
}) {
  // 往后算到哪天：先算两年，点「更多」时按需往后延，没有尽头
  const [horizon, setHorizon] = useState(() => addMonths(today, 24));
  const periods = ledger(horizon);
  // 改一笔时沿用它的类型；新记一笔默认是收款，底部「免收」把勾的期记成免收
  const mode = edit && !isReceipt(edit) ? 'waiver' : 'receipt';
  // 修改旧记录时，期按现在的切法对上；对不上的单独列出
  const [keys, setKeys] = useState<string[]>(() =>
    edit
      ? [...resolvedPeriods(periods, edit), ...edit.periods.filter((k) => !resolveKey(periods, k))]
      : (preset ??
        periods
          .filter((p) => !isSettled(p))
          .slice(0, 1)
          .map((p) => p.key)),
  );
  const picked = keys.map((k) => periods.find((p) => p.key === k)).filter((p): p is LedgerPeriod => !!p);
  const total = periodsTotal(state, picked);
  const [date, setDate] = useState(edit?.date ?? today);
  // 金额没手改时跟着勾选的期走；换了币种按收款日汇率折算
  const [picked_, setCurrency] = useState<string | undefined>(isReceipt(edit) ? edit.currency : defaultCurrency);
  const [typed, setAmount] = useState<number | undefined>(isReceipt(edit) ? edit.amount : undefined);
  const currency = picked_ ?? total.currency;
  const due = currency === total.currency ? total.amount : convertOn(total.amount, total.currency, currency, date, state.fxHistory, state.fx);
  const amount = typed ?? Math.round(due * 10 ** currencyDecimals(currency)) / 10 ** currencyDecimals(currency);
  const [note, setNote] = useState(edit?.note ?? '');
  // 可选的期：没结清的，加上这一笔自己抵扣的；还没到期的默认只列下一期，提前收多期时再展开
  const own = new Set(edit ? resolvedPeriods(periods, edit) : []);
  const open = periods.filter((p) => !isSettled(p) || own.has(p.key));
  const [ahead, setAhead] = useState(() => Math.max(1, open.filter((p) => p.from > today && keys.includes(p.key)).length));
  const upcoming = open.filter((p) => p.from > today);
  const shown = open.filter((p) => p.from <= today || keys.includes(p.key) || upcoming.indexOf(p) < ahead);
  // 每点一次「更多」多列三期
  const step = 3;
  // 订阅结束或成员退出后没有新的期；否则可以一直往后
  const last = periods.at(-1);
  const more = upcoming.length > ahead || (!!last && last.until >= horizon);
  const showMore = () => {
    setAhead((n) => n + step);
    if (upcoming.length < ahead + step && last) setHorizon(addDays(last.until, Math.max(366, (diffDays(last.from, last.until) + 1) * step)));
  };
  // 指向已不存在的期（改过加入日、收费周期）的旧记录：列出来，取消勾选后才能保存
  const lost = keys.filter((k) => !periods.some((p) => p.key === k));
  const [saving, guard] = useSubmit();
  const blocked = saving || !keys.length || lost.length > 0 || !date;
  const invalid = blocked || (mode === 'receipt' && (!Number.isFinite(amount) || amount < 0));
  // 改了勾选就按新勾的期重新给出金额，再手改
  const toggle = (k: string) => {
    setKeys((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k].sort()));
    setAmount(undefined);
  };

  // 失败时 run 提示错误，表单保留，可直接重试
  const write = (next: () => Receivable, msg: string) =>
    guard(() =>
      run(async () => {
        await save(next());
        onDone();
      }, msg),
    );
  const submit = (kind: 'receipt' | 'waiver' = mode) => {
    if (kind === 'receipt' ? invalid : blocked) return;
    const id = edit?.id ?? uid();
    const base = { id, date, periods: keys, ...(note.trim() ? { note: note.trim() } : {}) };
    return write(
      () => (kind === 'receipt' ? putRecord(record, 'receipt', { ...base, amount, currency }, periods) : putRecord(record, 'waiver', base, periods)),
      kind === 'receipt' ? t('receivable.toastReceived', { amount: flow(amount, currency) }) : t('receivable.toastWaived', { count: keys.length }),
    );
  };

  return (
    <Sheet
      narrow
      title={title}
      onClose={onDone}
      foot={
        <>
          {edit && (
            <ConfirmButton
              disabled={saving}
              hint={t('receivable.toastRemoved')}
              onConfirm={() => write(() => removeRecord(record, edit.id), t('receivable.toastRemoved'))}
            >
              {t('common.delete')}
            </ConfirmButton>
          )}
          {!edit && (
            <button className="btn danger-soft" disabled={blocked} title={t('receivable.waiverFoot')} onClick={() => submit('waiver')}>
              {t('receivable.modeWaiver')}
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={onDone}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={invalid} onClick={() => submit()}>
            {edit ? t('common.save') : mode === 'receipt' ? t('receivable.record') : t('receivable.waive')}
          </button>
        </>
      }
    >
      <div className="stack">
        {head}
        {/* 金额放在期列表之前：提前收多期时列表很长，放后面会被挤出视野 */}
        <Group
          title={mode === 'receipt' ? t('receivable.actual') : t('receivable.waiverGroup')}
          foot={
            mode === 'receipt' && picked.length > 0 && typed != null && Math.abs(amount - total.amount) > 0.004 && currency === total.currency
              ? t('receivable.dueFoot', { amount: money(total.amount, total.currency) })
              : undefined
          }
        >
          <Cell label={mode === 'receipt' ? t('receivable.receivedOn') : t('receivable.waivedOn')}>
            <DatePicker value={date} onChange={(v) => setDate(v ?? today)} />
          </Cell>
          {mode === 'receipt' && (
            <Cell label={t('receivable.amount')}>
              <span className="contact-field">
                <NumInput className="num" ccy={currency} value={Number.isFinite(amount) ? amount : undefined} onValue={(n) => setAmount(n ?? 0)} />
                <CurrencySelect value={currency} onChange={setCurrency} ariaLabel={t('receivable.currency')} />
              </span>
            </Cell>
          )}
          <Cell label={t('receivable.note')}>
            <input value={note} placeholder={t('receivable.notePh')} onChange={(e) => setNote(e.target.value)} />
          </Cell>
        </Group>
        <Group title={t('receivable.periods')} foot={mode === 'waiver' ? t('receivable.waiverFoot') : keys.length > 1 ? t('receivable.splitFoot') : undefined}>
          {open.length === 0 && !lost.length && <div className="cell muted">{t('receivable.allSettled')}</div>}
          {lost.map((k) => (
            <label key={k} className="cell rv-period lost">
              <input type="checkbox" checked onChange={() => toggle(k)} />
              <span className="rv-period-l">
                <span>{t('receivable.unmatched', { date: cnDate(k) })}</span>
                <small>{t('receivable.unmatchedHint')}</small>
              </span>
            </label>
          ))}
          {shown.map((p) => (
            <label key={p.key} className={`cell rv-period ${keys.includes(p.key) ? 'on' : ''}`}>
              <input type="checkbox" checked={keys.includes(p.key)} onChange={() => toggle(p.key)} />
              <span className="rv-period-l">
                <span>{periodRange(p)}</span>
                <small className={p.status === 'due' ? 'due' : undefined}>
                  {t(own.has(p.key) && isSettled(p) ? 'receivable.status.this' : `receivable.status.${p.status}`)}
                </small>
              </span>
              <span className="num rv-period-r">{money(p.due, p.currency)}</span>
            </label>
          ))}
          {more && (
            <button type="button" className="cell tap rv-more" onClick={showMore}>
              {t('receivable.more')}
            </button>
          )}
        </Group>
      </div>
    </Sheet>
  );
}

/** A period can occupy several months and several rows; all segments share one highlight. */
/**
 * 改一期的收款（或免收）：日期、这一期分到的金额、备注。查看和编辑是同一组字段，点「编辑」后原地变成输入框；
 * 一笔分几期时保存会把这一期拆出来（editRecordPeriod）。期初结清金额不详，只能删
 */
export function usePeriodEdit(p: LedgerPeriod) {
  const r = p.receipt ?? p.waiver;
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(r?.date ?? '');
  const [amount, setAmount] = useState(p.share);
  const [note, setNote] = useState(r?.note ?? '');
  const editable = !!r && !p.receipt?.opening;
  const cancel = () => {
    setEditing(false);
    setDate(r?.date ?? '');
    setAmount(p.share);
    setNote(r?.note ?? '');
  };
  return {
    editing,
    start: () => setEditing(true),
    cancel,
    editable,
    dirty: editable && (date !== r.date || note.trim() !== (r.note ?? '') || (!!p.receipt && amount !== p.share)),
    valid: !p.receipt || (amount != null && amount >= 0),
    /** 一笔分几期：保存时这一期会单独拆出 */
    splits: editable && r.periods.length > 1,
    patch: { date, amount, note: note.trim() },
    setDate,
    setAmount,
    setNote,
  };
}
export type PeriodEdit = ReturnType<typeof usePeriodEdit>;

/**
 * 一期的明细字段：应收、收款/免收日期、这一期实收、一笔分几期、备注。悬停提示、成员表里点开的一格、代付每期弹窗都用这一份，
 * 编辑态只是把可改的几项换成输入框，不多不少。onBatch 给了时「一笔分几期」可点，去改整笔（调整抵扣哪几期）
 */
export function periodFields(p: LedgerPeriod, { due = true, edit, onBatch }: { due?: boolean; edit?: PeriodEdit; onBatch?: () => void } = {}) {
  const data = periodTipData(p);
  const e = edit?.editing ? edit : undefined;
  const r = data.receipt;
  const rec = p.receipt ?? p.waiver;
  const batch = r && r.count > 1 ? t('receivable.batch', { amount: money(r.amount, r.currency), count: r.count }) : undefined;
  return [
    ...(due ? [{ key: 'due', label: t('receivable.grid.due'), value: `${money(data.due, data.currency)} ${data.currency}` }] : []),
    ...(r?.opening
      ? [{ key: 'opening', label: t('receivable.opening'), value: '' }]
      : rec
        ? [
            {
              key: 'date',
              label: r ? t('receivable.receivedOn') : t('receivable.waivedOn'),
              value: e ? <DatePicker value={e.patch.date} onChange={(v) => e.setDate(v ?? rec.date)} /> : cnDateFull(rec.date),
            },
            ...(r
              ? [
                  {
                    key: 'received',
                    label: t('receivable.actual'),
                    value: e ? (
                      <NumInput className="num" ccy={r.currency} value={e.patch.amount} onValue={e.setAmount} aria-label={t('receivable.actual')} />
                    ) : (
                      `${money(r.share ?? 0, r.currency)} ${r.currency}`
                    ),
                  },
                ]
              : []),
            ...(batch
              ? [
                  {
                    key: 'batch',
                    label: t('receivable.periods'),
                    value:
                      onBatch && !e ? (
                        <button type="button" className="btn plain" onClick={onBatch}>
                          {batch}
                        </button>
                      ) : (
                        batch
                      ),
                  },
                ]
              : []),
            ...(e
              ? [
                  {
                    key: 'note',
                    label: t('receivable.note'),
                    value: <input value={e.patch.note} placeholder={t('receivable.notePh')} onChange={(ev) => e.setNote(ev.currentTarget.value)} />,
                  },
                ]
              : data.note
                ? [{ key: 'note', label: t('receivable.note'), value: data.note }]
                : []),
          ]
        : []),
  ];
}

/** 一期的明细表：悬停提示和点开的小弹窗共用；传 edit 时可原地编辑 */
export function PeriodTip({ p, edit, onBatch }: { p: LedgerPeriod; edit?: PeriodEdit; onBatch?: () => void }) {
  return <TipTable head={[periodRange(p), t(`receivable.status.${p.status}`)]} rows={periodFields(p, { edit, onBatch })} />;
}

export function PeriodStrip({
  periods,
  today,
  onPick,
  mode,
}: {
  periods: LedgerPeriod[];
  today: string;
  onPick: (p: LedgerPeriod, el: HTMLElement) => void;
  mode?: PeriodGridMode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const grid = periodGrid(periods, today, mode);
  useEffect(() => {
    const hide = () => setActive(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('keydown', key);
      tipSet?.(null);
    };
  }, []);
  if (!grid.rows.length) return null;
  return (
    <div className="rv-strip" style={{ '--rv-columns': grid.mode === 'months' ? grid.columns * 2 : grid.columns } as CSSProperties} role="list">
      {grid.rows.map((row) => (
        <div key={row.key}>
          {row.year != null && (
            <small className="muted">
              {t(row.quarter ? 'receivable.grid.quarter' : 'receivable.grid.year', { year: row.year, quarter: row.quarter ?? 0 })}
            </small>
          )}
          <div>
            {row.segments.map((seg) => {
              const p = seg.period;
              const tips = tipProps(() => <PeriodTip p={p} />);
              return (
                <button
                  key={p.key}
                  type="button"
                  role="listitem"
                  className={`rv-cell ${periodCellKind(p, today)} ${active === p.key ? 'active' : ''}`}
                  data-start={seg.start}
                  data-end={seg.end}
                  style={{ gridColumn: seg.tracks ? `${seg.track! + 1} / span ${seg.tracks}` : `${seg.column + 1} / span ${seg.span}` }}
                  aria-label={`${periodRange(p)}, ${money(p.due, p.currency)} ${p.currency}, ${t(`receivable.status.${p.status}`)}`}
                  data-period={p.key}
                  {...tips}
                  onMouseEnter={(e) => {
                    setActive(p.key);
                    tips.onMouseEnter(e);
                  }}
                  onMouseLeave={() => {
                    setActive(null);
                    tips.onMouseLeave();
                  }}
                  onFocus={(e) => {
                    setActive(p.key);
                    tips.onFocus(e);
                  }}
                  onBlur={() => {
                    setActive(null);
                    tips.onBlur();
                  }}
                  onPointerDown={(e) => {
                    if (e.pointerType === 'touch') {
                      setActive(p.key);
                      tips.onFocus(e);
                    }
                  }}
                  onClick={(e) => {
                    tipSet?.(null);
                    onPick(p, e.currentTarget);
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
