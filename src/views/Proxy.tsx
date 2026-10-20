import { useState } from 'preact/hooks';
import { chargesBetween, cycleLabel, effectiveStatus, nextCharge, todayIn } from '../../shared/billing.ts';
import { cnDate, cnDateFull, money } from '../../shared/format.ts';
import { toBaseAt } from '../../shared/fx.ts';
import type { AppState, ProxyEntry, Subscription } from '../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { Amount, Cell, Group, Icon, PayBadge, Sheet, SubIcon, Toolbar } from '../components/ui.tsx';
import { contactText } from './Members.tsx';
import { run, saveSub } from '../store.ts';
import { CurrencySelect } from '../components/Picker.tsx';
import { matchEntries } from '../../shared/proxy.ts';

const STATUS: Record<string, [string, string]> = {
  upcoming: ['未开始', 'blue'],
  active: ['进行中', 'blue'],
  trial: ['试用中', 'blue'],
  paused: ['已暂停', ''],
  ending: ['到期停付', ''],
  ended: ['已结束', ''],
  lifetime: ['买断', ''],
};

interface Row {
  date: string;
  entry?: ProxyEntry;
  /** 订阅原价（订阅币种） */
  list: number;
  listCurrency: string;
  /** 卡上实扣 */
  charged: number;
  currency: string;
  /** 扣款当天汇率折成本位币 */
  chargedBase: number;
  /** 收款当天汇率折成本位币；未收为空 */
  receivedBase?: number;
}

/** 每一期：卡上实扣多少、折合多少，对方还了多少、折合多少 */
function rows(state: AppState, s: Subscription, today: string): Row[] {
  const entries = s.proxy?.entries ?? [];
  const charges = chargesBetween(s, s.start, today, today);
  const matched = matchEntries(entries, charges.map((c) => c.date));
  return charges
    .map((c) => {
      const entry = matched.get(c.date);
      const charged = entry?.charged ?? c.amount;
      const currency = entry?.chargedCurrency ?? c.currency;
      const received = entry?.received;
      return {
        date: c.date,
        entry,
        list: c.amount,
        listCurrency: c.currency,
        charged,
        currency,
        chargedBase: toBaseAt(state, charged, currency, c.date),
        receivedBase: received == null ? undefined : toBaseAt(state, received, entry!.receivedCurrency ?? state.settings.baseCurrency, entry!.receivedOn ?? c.date),
      };
    })
    .reverse();
}

/** 某个代付订阅还有几期没收回 */
export function proxyOwed(state: AppState, s: Subscription, today: string): number {
  return rows(state, s, today).filter((r) => r.receivedBase == null).length;
}

/** 代付总账：待收多少、收回的钱和实扣相比赚了还是亏了 */
export function proxySummary(state: AppState, today: string) {
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
export function ProxyCard({ state, s, onOpen }: { state: AppState; s: Subscription; onOpen: (s: Subscription) => void }) {
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
  const label = open.length && !stopped ? `待收 ${open.length} 期` : stopped ? '已停止' : STATUS[st][0];

  return (
    <>
    {/* 整张卡片点开代付详情 */}
    <div
      class={`card proxy-card ${stopped ? 'stopped' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => setLedger(true)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setLedger(true))}
    >
      {stopped && (
        <span class="stop-stamp" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M5.6 5.6l12.8 12.8" />
          </svg>
        </span>
      )}
      <div class="proxy-top">
        <button
          class="proxy-head"
          title="查看订阅"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(s);
          }}
        >
          <SubIcon sub={s} size={46} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div class="ph-name">{s.name}</div>
            <div class="muted ph-meta">
              {money(s.price, s.currency)} {cycleLabel(s.cycle)}
              {stopped ? (s.end ? ` · ${cnDate(s.end)}停止` : '') : next ? ` · 下次 ${cnDate(next)}` : ''}
            </div>
          </div>
        </button>
        <span class={`ph-status ${tone}`}>
          <i />
          {label}
        </span>
      </div>
      <div class="ph-chips">
        <span class="who-chip" title={s.proxy!.note}>
          <Icon name="users" size={12} />替 {s.proxy!.forName || '未填写'} 付
          {contactText(s.proxy!) && <em>{contactText(s.proxy!)}</em>}
        </span>
        <PayBadge m={method} />
      </div>

      <div class="proxy-facts">
        <div>
          <small>已代付 {list.length} 期</small>
          <b>{money(charged, base, { compact: true })}</b>
        </div>
        <div>
          <small>已收回</small>
          <b>{money(received, base, { compact: true })}</b>
        </div>
        <div>
          <small>{open.length ? `待收 ${open.length} 期` : '待收'}</small>
          <b class={open.length ? 'warn' : 'done'}>{open.length ? `≈ ${money(open.reduce((a, r) => a + r.chargedBase, 0), base, { compact: true })}` : '已结清'}</b>
        </div>
      </div>


    </div>
    {/* 弹窗放在卡片外面：卡片的定位与裁切不会影响弹层，也不会把同一行的卡片撑高 */}
    {ledger && <LedgerSheet state={state} s={s} onClose={() => setLedger(false)} onOpen={onOpen} />}
    </>
  );
}

/** 代付详情：上面是订阅与对象的基本信息和汇总，下面是每一期的扣款与收款列表；点一行记收款或修改 */
function LedgerSheet({ state, s, onClose, onOpen }: { state: AppState; s: Subscription; onClose: () => void; onOpen: (s: Subscription) => void }) {
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
    <Sheet narrow title="代付详情" onClose={onClose}>
      <div class="stack">
        <div class="ld-head">
          <SubIcon sub={live} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div class="ph-name">{live.name}</div>
            <div class="muted ph-meta">
              {money(live.price, live.currency)} {cycleLabel(live.cycle)}
              {cardCcy ? ` · 卡上按 ${cardCcy} 结算` : ''}
            </div>
          </div>
          <span class={`ph-status ${stopped ? 'stop' : open.length ? 'owe' : 'ok'}`}>
            <i />
            {stopped ? '已停止' : open.length ? `待收 ${open.length} 期` : STATUS[st][0]}
          </span>
        </div>

        <Group>
          <Cell label="替谁付">
            <span class="ld-who">
              {px.forName || '未填写'}
              {contactText(px) && <small>{contactText(px)}</small>}
            </span>
          </Cell>
          <Cell label="支付方式">
            <PayBadge m={method} />
          </Cell>
          <Cell
            label="订阅"
            onClick={() => {
              onClose();
              onOpen(live);
            }}
          >
            查看订阅详情
          </Cell>
          <Cell label={stopped ? '停止于' : '下次扣款'}>{stopped ? (live.end ? cnDateFull(live.end) : '—') : next ? cnDateFull(next) : '—'}</Cell>
          {px.note && <Cell label="备注">{px.note}</Cell>}
        </Group>

        <div class="proxy-facts four">
          <div>
            <small>已代付 {list.length} 期</small>
            <b>{money(charged, base, { compact: true })}</b>
          </div>
          <div>
            <small>已收回</small>
            <b>{money(received, base, { compact: true })}</b>
          </div>
          <div>
            <small>待收</small>
            <b class={open.length ? 'warn' : 'done'}>{open.length ? `≈ ${money(open.reduce((a, r) => a + r.chargedBase, 0), base, { compact: true })}` : '已结清'}</b>
          </div>
          <div>
            <small>收回 − 实扣</small>
            <b class={Math.abs(diff) < 0.5 ? '' : diff > 0 ? 'done' : 'loss'}>
              {diff > 0.5 ? '+' : ''}
              {money(diff, base, { compact: true })}
            </b>
          </div>
        </div>

        <div class="ld-table">
          <div class="ld-row ld-th">
            <span>扣款日</span>
            <span>卡上实扣</span>
            <span>收回</span>
            <span>差额</span>
          </div>
          {list.map((r) => {
            const d = r.receivedBase == null ? undefined : r.receivedBase - r.chargedBase;
            return (
              <button key={r.date} class="ld-row" disabled={ro} onClick={() => setEdit(r)}>
                <span class="ld-date">{cnDate(r.date)}</span>
                <span>
                  <b>{money(r.charged, r.currency)}</b>
                  <small>≈ {money(r.chargedBase, base)}</small>
                </span>
                <span>{r.receivedBase == null ? <em class="todo">{ro ? '待收' : '记收款'}</em> : <b>{money(r.entry!.received!, r.entry!.receivedCurrency ?? base)}</b>}</span>
                <span class={d == null ? 'muted' : Math.abs(d) < 0.5 ? 'muted' : d > 0 ? 'gain' : 'loss'}>{d == null ? '—' : Math.abs(d) < 0.5 ? '持平' : `${d > 0 ? '+' : '−'}${money(Math.abs(d), base)}`}</span>
              </button>
            );
          })}
          {list.length === 0 && <div class="muted" style={{ fontSize: 13, padding: '12px 0' }}>还没有扣过款。</div>}
        </div>
      </div>
      {edit && <EntrySheet state={state} s={live} row={edit} onClose={() => setEdit(null)} />}
    </Sheet>
  );
}

function EntrySheet({ state, s, row, onClose }: { state: AppState; s: Subscription; row: Row; onClose: () => void }) {
  const base = state.settings.baseCurrency;
  const e = row.entry;
  const [charged, setCharged] = useState(e?.charged != null ? String(e.charged) : '');
  const [chargedCcy, setChargedCcy] = useState(e?.chargedCurrency ?? row.listCurrency);
  const [received, setReceived] = useState(e?.received != null ? String(e.received) : '');
  const [ccy, setCcy] = useState(e?.receivedCurrency ?? base);
  const [on, setOn] = useState<string | undefined>(e?.receivedOn ?? todayIn(state.settings.timezone));
  const [note, setNote] = useState(e?.note ?? '');
  const val = (ev: Event) => (ev.target as HTMLInputElement).value;

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
    run(async () => {
      await saveSub({ ...s, proxy: { ...s.proxy!, entries: keep ? [...others, next].sort((a, b) => a.charge.localeCompare(b.charge)) : others } });
      onClose();
    }, clearReceipt ? '已改为待收' : '已保存');
  };

  return (
    <Sheet
      narrow
      title={`${cnDateFull(row.date)} 这一期`}
      onClose={onClose}
      foot={
        <>
          {e?.received != null && (
            <button class="btn plain" style={{ color: 'var(--red)' }} onClick={() => save(true)}>
              改为待收
            </button>
          )}
          <span class="grow" />
          <button class="btn" onClick={onClose}>
            取消
          </button>
          <button class="btn primary" disabled={(charged !== '' && !Number.isFinite(Number(charged))) || (recvN != null && !Number.isFinite(recvN))} onClick={() => save()}>
            保存
          </button>
        </>
      }
    >
      <div class="stack">
        <Group title="卡上实扣" foot={`扣款当天汇率折合 ${money(chargedBase, base)}。不填则按订阅原价 ${money(row.list, row.listCurrency)}。`}>
          <Cell label="金额">
            <input class="num" inputMode="decimal" value={charged} placeholder={String(row.list)} onInput={(ev) => setCharged(val(ev))} />
          </Cell>
          <Cell label="币种">
            <CurrencySelect value={chargedCcy} onChange={setChargedCcy} />
          </Cell>
        </Group>
        <Group title={`${s.proxy!.forName || '对方'}还给我`} foot={diff == null ? '留空表示还没收到。' : `按收款当天汇率折合 ${money(recvBase!, base)}，比实扣${Math.abs(diff) < 0.5 ? '持平' : diff > 0 ? `多 ${money(diff, base)}` : `少 ${money(-diff, base)}`}。`}>
          <Cell label="金额">
            <input class="num" inputMode="decimal" autoFocus value={received} placeholder="未收" onInput={(ev) => setReceived(val(ev))} />
          </Cell>
          <Cell label="币种">
            <CurrencySelect value={ccy} onChange={setCcy} />
          </Cell>
          <Cell label="收到日期">
            <DatePicker value={on} onChange={setOn} />
          </Cell>
          <Cell label="备注">
            <input value={note} placeholder="可选，如 微信转账" onInput={(ev) => setNote(val(ev))} />
          </Cell>
        </Group>
      </div>
    </Sheet>
  );
}

/** 代付页：替别人付的订阅，逐期记录实扣与收回 */
export function ProxyPage({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const sum = proxySummary(state, today);
  return (
    <>
      <Toolbar title="代付" />
      <div class="page fade-in stack">
        <div class="grid g-3">
          <div class="card stat">
            <div class="stat-label">待收</div>
            <div class="stat-value" style={{ color: sum.owedCount ? 'var(--orange)' : undefined }}>
              <Amount value={sum.owed} ccy={base} />
            </div>
            <div class="stat-sub">{sum.owedCount ? `${sum.owedCount} 期未收，按扣款当天汇率` : '全部已收回'}</div>
          </div>
          <div class="card stat">
            <div class="stat-label">累计代付</div>
            <div class="stat-value">
              <Amount value={sum.charged} ccy={base} />
            </div>
            <div class="stat-sub">{sum.count} 期 · {sum.subs.length} 个订阅</div>
          </div>
          <div class="card stat">
            <div class="stat-label">收回 − 实扣</div>
            <div class="stat-value" style={{ color: Math.abs(sum.diff) < 0.5 ? undefined : sum.diff > 0 ? 'var(--green)' : 'var(--red)' }}>
              <Amount value={sum.diff} ccy={base} />
            </div>
            <div class="stat-sub">已收的期数里，汇率和手续费带来的差额</div>
          </div>
        </div>
        {sum.subs.length === 0 ? (
          <div class="card empty">
            <b>还没有代付</b>
            新建或编辑订阅，在「合租 / 代付」里选「代付」并填上替谁付。
          </div>
        ) : (
          <div class="grid g-2">
            {sum.subs.map((s) => (
              <ProxyCard key={s.id} state={state} s={s} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
