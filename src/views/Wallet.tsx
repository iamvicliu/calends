import { useState } from 'preact/hooks';
import { cycleLabel, diffDays, effectiveStatus, monthlyGross, runwayFor, uid, type Runway } from '../../shared/billing.ts';
import { cnDate, cnDateFull, CURRENCIES, money, relDays } from '../../shared/format.ts';
import { BALANCE_KINDS, type AppState, type MethodKind, type PaymentMethod, type Subscription } from '../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import { Amount, Cell, Group, Icon, Seg, Sheet, SubIcon, Toolbar } from '../components/ui.tsx';
import { KIND_BG, KIND_LABEL, liveSubs, toBase } from '../derive.ts';
import { deleteMethod, run, saveMethod } from '../store.ts';
import { confirmDelete } from './Editor.tsx';

export function RunwayCard({ r, today, state, flat }: { r: Runway; today: string; state: AppState; flat?: boolean }) {
  const m = r.method;
  const daysLeft = r.runsOutOn ? diffDays(today, r.runsOutOn) : Infinity;
  const pct = r.monthlyDrain <= 0 ? 0 : Math.min(100, (Math.min(daysLeft, 365) / 365) * 100);
  const tone = daysLeft <= 7 ? 'out' : daysLeft <= (m.lowRunwayDays ?? 30) ? 'low' : '';
  const base = state.settings.baseCurrency;
  const body = (
    <div class="runway">
      <div class="rw-top">
        <span class="ico mono" style={{ '--s': '36px', background: m.color || KIND_BG[m.kind], fontSize: '12px' } as Record<string, string>}>
          {m.region ?? m.currency.slice(0, 2)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{m.name}</div>
          <div class="muted" style={{ fontSize: 12.5 }}>
            每月约扣 {money(r.monthlyDrain, m.currency, { compact: true })}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div class="rw-bal">
            <Amount value={r.current} ccy={m.currency} />
          </div>
          {m.currency !== base && <div class="soft" style={{ fontSize: 11.5 }}>≈ {money(toBase(state, r.current, m.currency), base, { compact: true })}</div>}
        </div>
      </div>
      <div class={`rw-track ${tone}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div class="rw-scale">
        <span>今天</span>
        <span>3 个月</span>
        <span>半年</span>
        <span>9 个月</span>
        <span>1 年</span>
      </div>
      <div class="rw-note">
        {r.monthlyDrain <= 0 ? (
          '没有关联的计费订阅。'
        ) : r.shortfall && r.coveredCharges === 0 ? (
          <>
            余额不够 <b>{cnDate(r.shortfall.date)}</b>（{relDays(daysLeft)}）{r.shortfall.sub.name} 的 {money(r.shortfall.amount, r.shortfall.currency)}。撑满一年需再充{' '}
            <b>{money(r.topUp12m, m.currency, { compact: true })}</b>。
          </>
        ) : r.shortfall ? (
          <>
            还能扣 <b>{r.coveredCharges} 期</b>，在 <b>{cnDateFull(r.shortfall.date)}</b>（{relDays(daysLeft)}）的 {r.shortfall.sub.name} 前用完。撑满一年需再充{' '}
            <b>{money(r.topUp12m, m.currency, { compact: true })}</b>。
          </>
        ) : (
          <>
            未来 3 年都够用，覆盖 <b>{r.coveredCharges} 期</b>扣款。
          </>
        )}
      </div>
    </div>
  );
  return flat ? body : <div class="card">{body}</div>;
}

const CARD_KINDS: MethodKind[] = ['debit', 'credit', 'crypto'];

const BRAND_LOGO: Record<string, string> = { cmb: '/brands/cmb.svg', plasma: '/brands/plasma.svg', appstore: '/brands/appstore.svg' };

export function brandOf(m: PaymentMethod): string | undefined {
  if (m.brand) return m.brand;
  if (m.kind === 'appstore') return 'appstore';
  if (m.kind === 'phone') return 'smart';
  if (/招商/.test(m.name)) return 'cmb';
  if (/plasma/i.test(m.name)) return 'plasma';
  return undefined;
}

export const isSim = (m: PaymentMethod) => brandOf(m) === 'smart' || m.kind === 'phone';

/** 卡面：品牌标旋转放大做水印并渐隐，角上放清晰的小 logo；手机话费做成 SIM 卡 */
function CardFace({ m, label, value, right, rightSub }: { m: PaymentMethod; label: string; value: preact.ComponentChildren; right: string; rightSub: string }) {
  const brand = brandOf(m);
  if (isSim(m)) {
    return (
      <>
        <div class="sim-top">
          <img class="sim-logo" src="/brands/smart.png" alt="SMART" />
          <span class="sim-tag">SIM · {m.region ?? 'PH'}</span>
        </div>
        <div class="sim-mid">
          <div class="sim-chip" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <i key={i} />
            ))}
          </div>
          <div class="sim-name">
            {m.name}
            <small>
              {KIND_LABEL[m.kind]} · {m.currency}
            </small>
          </div>
        </div>
        <div class="pc-foot">
          <div>
            {label && <div class="o">{label}</div>}
            <div class="pc-bal">{value}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div class="o">{right}</div>
            <div style={{ fontWeight: 600 }}>{rightSub}</div>
          </div>
        </div>
      </>
    );
  }
  const logo = brand ? BRAND_LOGO[brand] : undefined;
  return (
    <>
      {logo && <img class={`pc-mark ${brand}`} src={logo} alt="" aria-hidden="true" />}
      <div class="pc-top">
        <div class="pc-id">
          {logo && <img class={`pc-logo ${brand}`} src={logo} alt="" />}
          <div style={{ minWidth: 0 }}>
            <div class="pc-name">{m.name}</div>
            <div class="pc-kind">
              {KIND_LABEL[m.kind]}
              {m.region ? ` · ${m.region}` : ''}
              {m.cashback ? ` · 返 ${m.cashback}%` : ''}
            </div>
          </div>
        </div>
        <span class="pc-ccy">{m.currency}</span>
      </div>
      {CARD_KINDS.includes(m.kind) && <div class="pc-chip" />}
      <div class="pc-foot">
        <div>
          {label && <div class="o">{label}</div>}
          <div class="pc-bal">{value}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div class="o">{right}</div>
          <div style={{ fontWeight: 600 }}>{rightSub}</div>
        </div>
      </div>
    </>
  );
}

export function Wallet({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const [edit, setEdit] = useState<PaymentMethod | null>(null);
  const [topup, setTopup] = useState<{ m: PaymentMethod; current: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const ro = !!state.readonly;
  const live = liveSubs(state, today);
  const base = state.settings.baseCurrency;
  const unassigned = live.filter((s) => !s.methodId || !state.methods.some((m) => m.id === s.methodId));
  const opened = state.methods.find((m) => m.id === open);

  return (
    <>
      <Toolbar title="钱包" sub={`${state.methods.length} 种支付方式`}>
        {!ro && (
          <button class="btn primary" onClick={() => setEdit({ id: uid(), name: '', kind: 'appstore', currency: 'TRY' })}>
            <Icon name="plus" /> 添加
          </button>
        )}
      </Toolbar>
      <div class="page fade-in stack">
        <div class="wallet-grid">
          {state.methods.map((m) => {
            const subs = state.subscriptions.filter((s) => s.methodId === m.id);
            const liveHere = subs.filter((s) => live.includes(s));
            const r = runwayFor(m, state, today);
            const monthly = liveHere.reduce((a, s) => a + toBase(state, monthlyGross(s, today), s.currency), 0);
            return (
              <button
                key={m.id}
                class={`paycard ${isSim(m) ? 'sim' : ''}`}
                style={{ '--card-bg': m.color || KIND_BG[m.kind] } as Record<string, string>}
                onClick={() => setOpen(m.id)}
                onMouseMove={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  const b = el.getBoundingClientRect();
                  el.style.setProperty('--mx', `${e.clientX - b.left}px`);
                  el.style.setProperty('--my', `${e.clientY - b.top}px`);
                }}
              >
                <CardFace
                  m={m}
                  label={r ? '余额' : '每月支出'}
                  value={r ? <Amount value={r.current} ccy={m.currency} /> : <Amount value={monthly} ccy={base} />}
                  right={`${liveHere.length} 个订阅`}
                  rightSub={r ? (r.shortfall ? (r.coveredCharges ? `可扣 ${r.coveredCharges} 期` : '余额不足') : r.monthlyDrain > 0 ? '余额充足' : '—') : m.last4 ? `•••• ${m.last4}` : BALANCE_KINDS.includes(m.kind) ? '未设余额' : ''}
                />
              </button>
            );
          })}
        </div>

        {state.methods.some((m) => runwayFor(m, state, today)) && (
          <Group title="余额续航">
            {state.methods
              .map((m) => runwayFor(m, state, today))
              .filter((r) => r != null)
              .map((r) => (
                <div key={r.method.id} class="cell" style={{ display: 'block', padding: '14px 16px' }}>
                  <RunwayCard r={r} today={today} state={state} flat />
                </div>
              ))}
          </Group>
        )}

        <Group>
          <Cell label={<span class="row"><Icon name="car" />拼车与分摊</span>} onClick={() => (location.hash = '#/carpool')}>
            {state.subscriptions.filter((s) => s.share).length} 个
          </Cell>
        </Group>

        {unassigned.length > 0 && (
          <Group title={`未指定支付方式 · ${unassigned.length}`}>
            {unassigned.map((s) => (
              <Cell key={s.id} label={<span class="row"><SubIcon sub={s} size={28} />{s.name}</span>} onClick={() => onOpen(s)}>
                {money(s.price, s.currency)}
              </Cell>
            ))}
          </Group>
        )}
      </div>

      {opened && (
        <MethodSheet
          m={opened}
          state={state}
          today={today}
          onClose={() => setOpen(null)}
          onEdit={() => setEdit(opened)}
          onTopup={(current) => setTopup({ m: opened, current })}
          onOpen={(s) => {
            setOpen(null);
            onOpen(s);
          }}
        />
      )}
      {edit && <MethodEditor m={edit} state={state} onClose={() => setEdit(null)} />}
      {topup && <TopupSheet m={topup.m} current={topup.current} today={today} onClose={() => setTopup(null)} />}
    </>
  );
}

function MethodSheet({ m, state, today, onClose, onEdit, onTopup, onOpen }: { m: PaymentMethod; state: AppState; today: string; onClose: () => void; onEdit: () => void; onTopup: (current: number) => void; onOpen: (s: Subscription) => void }) {
  const r = runwayFor(m, state, today);
  const subs = state.subscriptions.filter((s) => s.methodId === m.id);
  const ro = !!state.readonly;
  return (
    <Sheet narrow title={m.name} onClose={onClose}>
      <div class="stack" style={{ gap: 18 }}>
        {!ro && (
          <div class="row">
            {(r || BALANCE_KINDS.includes(m.kind)) && (
              <button class="btn primary" onClick={() => onTopup(r?.current ?? 0)}>
                {r ? '充值 / 校准余额' : '设置余额'}
              </button>
            )}
            <button class="btn" onClick={onEdit}>
              <Icon name="edit" /> 编辑
            </button>
          </div>
        )}
        {r && (
          <div class="card">
            <RunwayCard r={r} today={today} state={state} flat />
          </div>
        )}
        {r && r.upcoming.length > 0 && (
          <Group title="扣款推演">
            {r.upcoming.slice(0, 10).map((c) => (
              <Cell key={c.sub.id + c.date} label={c.sub.name} sub={cnDate(c.date)}>
                <span>−{money(c.amountInMethod, m.currency, { compact: true })}</span>
                <b style={{ color: c.balanceAfter < 0 ? 'var(--red)' : 'var(--label)', fontWeight: 600, minWidth: 80 }}>{money(c.balanceAfter, m.currency, { compact: true })}</b>
              </Cell>
            ))}
          </Group>
        )}
        <Group title={`关联订阅 · ${subs.length}`}>
          {subs.length === 0 && <div class="cell muted">暂无</div>}
          {subs.map((s) => (
            <Cell
              key={s.id}
              label={
                <span class="row" style={{ opacity: effectiveStatus(s, today) === 'ended' ? 0.45 : 1 }}>
                  <SubIcon sub={s} size={28} />
                  {s.name}
                </span>
              }
              onClick={() => onOpen(s)}
            >
              {money(s.price, s.currency)} · {cycleLabel(s.cycle)}
            </Cell>
          ))}
        </Group>
        {m.notes && (
          <Group title="备注">
            <div class="cell" style={{ fontSize: 14 }}>
              {m.notes}
            </div>
          </Group>
        )}
      </div>
    </Sheet>
  );
}

function TopupSheet({ m, current, today, onClose }: { m: PaymentMethod; current: number; today: string; onClose: () => void }) {
  const [mode, setMode] = useState<'add' | 'set'>(m.balance == null ? 'set' : 'add');
  const [val, setVal] = useState('');
  const n = Number(val);
  const next = mode === 'add' ? current + (n || 0) : n || 0;
  return (
    <Sheet
      narrow
      title={m.name}
      onClose={onClose}
      foot={
        <>
          <span class="grow" />
          <button class="btn" onClick={onClose}>
            取消
          </button>
          <button
            class="btn primary"
            disabled={!val || !Number.isFinite(n)}
            onClick={() =>
              run(async () => {
                await saveMethod({ ...m, balance: Math.round(next * 100) / 100, balanceAsOf: today });
                onClose();
              }, '余额已更新')
            }
          >
            保存
          </button>
        </>
      }
    >
      <div class="stack">
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            ['add', '充值'],
            ['set', '校准为实际余额'],
          ]}
        />
        <Group foot="以今天为校准日，之后的扣款按订阅周期自动从余额里推算。">
          <Cell label={mode === 'add' ? '充值金额' : '实际余额'}>
            <input class="num" inputMode="decimal" autoFocus value={val} onInput={(e) => setVal((e.target as HTMLInputElement).value)} placeholder={`${m.currency} 0.00`} />
          </Cell>
          <Cell label="当前估算">{money(current, m.currency)}</Cell>
          <Cell label="保存后">
            <b style={{ color: 'var(--label)' }}>{money(next, m.currency)}</b>
          </Cell>
        </Group>
      </div>
    </Sheet>
  );
}

export function MethodEditor({ m, state, onClose }: { m: PaymentMethod; state: AppState; onClose: () => void }) {
  const [f, setF] = useState<PaymentMethod>(m);
  const isNew = !state.methods.some((x) => x.id === m.id);
  const up = (p: Partial<PaymentMethod>) => setF({ ...f, ...p });
  const balanceKind = BALANCE_KINDS.includes(f.kind);
  const val = (e: Event) => (e.target as HTMLInputElement).value;
  return (
    <Sheet
      narrow
      title={isNew ? '添加支付方式' : '编辑支付方式'}
      onClose={onClose}
      foot={
        <>
          {!isNew && (
            <button
              class="btn danger"
              onClick={() =>
                confirmDelete(`删除「${m.name}」？关联订阅会变为未指定。`) &&
                run(async () => {
                  await deleteMethod(m.id);
                  onClose();
                }, '已删除')
              }
            >
              删除
            </button>
          )}
          <span class="grow" />
          <button class="btn" onClick={onClose}>
            取消
          </button>
          <button
            class="btn primary"
            disabled={!f.name.trim()}
            onClick={() =>
              run(async () => {
                await saveMethod({ ...f, name: f.name.trim() });
                onClose();
              }, '已保存')
            }
          >
            完成
          </button>
        </>
      }
    >
      <div class="stack">
        <div class={`paycard ${isSim(f) ? 'sim' : ''}`} style={{ '--card-bg': f.color || KIND_BG[f.kind], cursor: 'default' } as Record<string, string>}>
          <CardFace m={{ ...f, name: f.name || '新的支付方式' }} label="" value="" right={f.region ?? ''} rightSub={f.last4 ? `•••• ${f.last4}` : ''} />
        </div>
        <Group>
          <Cell label="名称">
            <input value={f.name} placeholder="招商银行、App Store 土耳其区…" onInput={(e) => up({ name: val(e) })} />
          </Cell>
          <Cell label="类型">
            <select value={f.kind} onChange={(e) => up({ kind: val(e) as MethodKind })}>
              {(Object.keys(KIND_LABEL) as MethodKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Cell>
          <Cell label="币种">
            <select value={f.currency} onChange={(e) => up({ currency: val(e) })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Cell>
          {CARD_KINDS.includes(f.kind) && (
            <Cell label="卡号尾号">
              <input class="num" maxLength={4} value={f.last4 ?? ''} onInput={(e) => up({ last4: val(e).replace(/\D/g, '') || undefined })} />
            </Cell>
          )}
          <Cell label="地区">
            <input value={f.region ?? ''} placeholder="TR / NG / PH" onInput={(e) => up({ region: val(e).toUpperCase() || undefined })} />
          </Cell>
          <Cell label="返现 / 积分">
            <input class="num" inputMode="decimal" value={f.cashback ?? ''} placeholder="% 可选" onInput={(e) => up({ cashback: Number(val(e)) || undefined })} />
          </Cell>
        </Group>
        {balanceKind && (
          <Group title="余额" foot="留空则不推算续航。">
            <Cell label="当前余额">
              <input
                class="num"
                inputMode="decimal"
                value={f.balance ?? ''}
                placeholder="可选"
                onInput={(e) => up({ balance: val(e) === '' ? undefined : Number(val(e)), balanceAsOf: f.balanceAsOf ?? new Date().toISOString().slice(0, 10) })}
              />
            </Cell>
            <Cell label="校准日">
              <DatePicker value={f.balanceAsOf} onChange={(v) => up({ balanceAsOf: v })} />
            </Cell>
            <Cell label="不足提醒">
              <select value={f.lowRunwayDays ?? 30} onChange={(e) => up({ lowRunwayDays: Number(val(e)) })}>
                {[7, 14, 30, 60].map((d) => (
                  <option key={d} value={d}>
                    提前 {d} 天
                  </option>
                ))}
              </select>
            </Cell>
          </Group>
        )}
        <Group title="备注">
          <div class="cell">
            <span class="cell-r">
              <textarea value={f.notes ?? ''} onInput={(e) => up({ notes: (e.target as HTMLTextAreaElement).value || undefined })} />
            </span>
          </div>
        </Group>
      </div>
    </Sheet>
  );
}
