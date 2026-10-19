import { useState } from 'preact/hooks';
import { cycleLabel, diffDays, effectiveStatus, monthlyGross, runwayFor, uid, type Runway } from '../../shared/billing.ts';
import { cnDate, cnDateFull, CURRENCIES, money, relDays } from '../../shared/format.ts';
import { BALANCE_KINDS, type AppState, type MethodKind, type PaymentMethod, type Subscription } from '../../shared/types.ts';
import { Icon, SectionHead, Sheet, SubIcon } from '../components/ui.tsx';
import { KIND_BG, KIND_LABEL, liveSubs, toBase } from '../derive.ts';
import { deleteMethod, run, saveMethod } from '../store.ts';

export function RunwayCard({ r, today, state }: { r: Runway; today: string; state: AppState }) {
  const m = r.method;
  const scaleMonths = 12;
  const months = r.runsOutOn ? diffDays(today, r.runsOutOn) / 30.4375 : r.monthlyDrain > 0 ? Infinity : 0;
  const pct = r.monthlyDrain <= 0 ? 0 : Math.min(100, (Math.min(months, scaleMonths) / scaleMonths) * 100);
  const low = r.runsOutOn ? diffDays(today, r.runsOutOn) <= (m.lowRunwayDays ?? 30) : false;
  const base = state.settings.baseCurrency;
  return (
    <div class="card runway">
      <div class="runway-top">
        <span class="ico" style={{ background: KIND_BG[m.kind], color: '#fff', border: 0, font: '600 12px/1 var(--mono)' }}>
          {m.region ?? m.currency.slice(0, 2)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div class="row-title">{m.name}</div>
          <div class="row-sub">
            {KIND_LABEL[m.kind]} · 每月约扣 {money(r.monthlyDrain, m.currency, { compact: true })}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div class="runway-bal">{money(r.current, m.currency, { compact: true })}</div>
          {m.currency !== base && <div class="soft num" style={{ fontSize: 11.5, marginTop: 4 }}>≈ {money(toBase(state, r.current, m.currency), base, { compact: true })}</div>}
        </div>
      </div>
      <div class={`runway-track ${low ? 'low' : ''}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div class="runway-scale">
        <span>今天</span>
        <span>3 个月</span>
        <span>6 个月</span>
        <span>9 个月</span>
        <span>1 年+</span>
      </div>
      <div class="runway-note">
        {r.monthlyDrain <= 0 ? (
          '没有关联的计费订阅。'
        ) : r.shortfall && r.coveredCharges === 0 ? (
          <>
            余额不够 <b>{cnDateFull(r.shortfall.date)}</b>（{relDays(diffDays(today, r.shortfall.date))}）{r.shortfall.sub.name} 的 {money(r.shortfall.amount, r.shortfall.currency)}。
            撑满一年需再充 <b>{money(r.topUp12m, m.currency, { compact: true })}</b>。
          </>
        ) : r.shortfall ? (
          <>
            还能完整扣 <b>{r.coveredCharges} 期</b>，在 <b>{cnDateFull(r.shortfall.date)}</b>（{relDays(diffDays(today, r.shortfall.date))}）的 {r.shortfall.sub.name} 前用完。撑满一年需再充{' '}
            <b>{money(r.topUp12m, m.currency, { compact: true })}</b>。
          </>
        ) : (
          <>
            未来 3 年内都够用，已覆盖 <b>{r.coveredCharges} 期</b>扣款。
          </>
        )}
        {m.balanceAsOf && <span class="soft"> 余额校准于 {m.balanceAsOf}。</span>}
      </div>
    </div>
  );
}

const NEEDS_LAST4: MethodKind[] = ['debit', 'credit', 'crypto'];

export function Wallet({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const [edit, setEdit] = useState<PaymentMethod | null>(null);
  const [topup, setTopup] = useState<{ m: PaymentMethod; current: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const ro = !!state.readonly;
  const live = liveSubs(state, today);
  const unassigned = live.filter((s) => !s.methodId || !state.methods.some((m) => m.id === s.methodId));
  return (
    <div class="wrap fade-in">
      <SectionHead
        no="■"
        label="Wallet"
        title="支付方式"
        meta="银行卡、支付宝、App Store 礼品卡余额、SMART 话费……余额类账户会逐期推演还能扣多久。"
        right={
          !ro && (
            <button class="btn primary" onClick={() => setEdit({ id: uid(), name: '', kind: 'appstore', currency: 'TRY' })}>
              <Icon name="plus" /> 添加支付方式
            </button>
          )
        }
      />
      <div class="grid-2" style={{ marginTop: 8 }}>
        {state.methods.map((m) => {
          const subs = state.subscriptions.filter((s) => s.methodId === m.id);
          const liveHere = subs.filter((s) => live.includes(s));
          const r = runwayFor(m, state, today);
          const monthly = liveHere.reduce((a, s) => a + toBase(state, monthlyGross(s, today), s.currency), 0);
          const isOpen = open === m.id;
          return (
            <div key={m.id} class="stack" style={{ gap: 10 }}>
              <div
                class="paycard"
                style={{ '--card-bg': m.color || KIND_BG[m.kind] } as never}
                onClick={() => setOpen(isOpen ? null : m.id)}
                onMouseMove={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  const b = el.getBoundingClientRect();
                  el.style.setProperty('--mx', `${e.clientX - b.left}px`);
                  el.style.setProperty('--my', `${e.clientY - b.top}px`);
                }}
              >
                <div class="hstack" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div class="pc-kind">
                      {KIND_LABEL[m.kind]}
                      {m.region ? ` · ${m.region}` : ''}
                      {m.cashback ? ` · 返 ${m.cashback}%` : ''}
                    </div>
                    <div class="pc-name">{m.name}</div>
                  </div>
                  {NEEDS_LAST4.includes(m.kind) ? <div class="pc-chip" /> : <span class="mono" style={{ fontSize: 12, opacity: 0.85 }}>{m.currency}</span>}
                </div>
                <div class="pc-foot">
                  <div>
                    {r ? (
                      <>
                        <div class="pc-bal">{money(r.current, m.currency, { compact: true })}</div>
                        <div style={{ marginTop: 6 }}>{r.shortfall ? `可扣 ${r.coveredCharges} 期 · 至 ${r.shortfall.date.slice(0, 7)}` : r.monthlyDrain > 0 ? '3 年内充足' : '暂无扣款'}</div>
                      </>
                    ) : (
                      <>
                        <div class="pc-bal">
                          {money(monthly, state.settings.baseCurrency, { compact: true })}
                          <span style={{ fontSize: 14, opacity: 0.7, fontFamily: 'var(--mono)' }}> /月</span>
                        </div>
                        <div style={{ marginTop: 6 }}>
                          {liveHere.length} 项计费中{BALANCE_KINDS.includes(m.kind) && !ro ? ' · 点此设置余额' : ''}
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {r ? (
                      <>
                        <div>{money(monthly, state.settings.baseCurrency, { compact: true })}</div>
                        <div style={{ opacity: 0.7 }}>/ 月</div>
                      </>
                    ) : (
                      <>
                        {m.cashback ? <div>返 ≈ {money((monthly * m.cashback) / 100, state.settings.baseCurrency)}/月</div> : null}
                        {m.last4 && <div style={{ letterSpacing: '0.12em' }}>•••• {m.last4}</div>}
                      </>
                    )}
                  </div>
                </div>
              </div>
              {isOpen && (
                <div class="card card-pad fade-in" style={{ padding: 16 }}>
                  {!ro && (
                    <div class="hstack" style={{ marginBottom: 10 }}>
                      {r && (
                        <button class="btn sm primary" onClick={() => setTopup({ m, current: r.current })}>
                          充值 / 校准余额
                        </button>
                      )}
                      {!r && BALANCE_KINDS.includes(m.kind) && (
                        <button class="btn sm primary" onClick={() => setTopup({ m, current: 0 })}>
                          设置余额
                        </button>
                      )}
                      <button class="btn sm" onClick={() => setEdit(m)}>
                        编辑
                      </button>
                    </div>
                  )}
                  {r && r.upcoming.length > 0 && (
                    <>
                      <div class="eyebrow" style={{ margin: '8px 0 6px' }}>
                        扣款推演
                      </div>
                      {r.upcoming.slice(0, 8).map((c) => (
                        <div key={c.sub.id + c.date} class="log-row">
                          <span>
                            {cnDate(c.date)} · {c.sub.name}
                          </span>
                          <span class="num">
                            −{money(c.amountInMethod, m.currency, { compact: true })} → <span class={c.balanceAfter < 0 ? 'warn' : ''}>{money(c.balanceAfter, m.currency, { compact: true })}</span>
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                  <div class="eyebrow" style={{ margin: '14px 0 2px' }}>
                    关联订阅 · {subs.length}
                  </div>
                  {subs.map((s) => (
                    <button key={s.id} class="row" style={{ gridTemplateColumns: '26px 1fr auto', padding: '10px 2px' }} onClick={() => onOpen(s)}>
                      <SubIcon sub={s} size="sm" />
                      <span class="row-title" style={{ fontSize: 14, opacity: effectiveStatus(s, today) === 'ended' ? 0.5 : 1 }}>
                        {s.name}
                      </span>
                      <span class="num" style={{ fontSize: 13 }}>
                        {money(s.price, s.currency)} <span class="soft">{cycleLabel(s.cycle)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {unassigned.length > 0 && (
        <div class="card card-pad" style={{ marginTop: 24 }}>
          <div class="eyebrow" style={{ marginBottom: 8 }}>
            未指定支付方式 · {unassigned.length}
          </div>
          <div class="chips">
            {unassigned.map((s) => (
              <button key={s.id} class="chip" onClick={() => onOpen(s)}>
                <SubIcon sub={s} size="xs" /> {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {state.methods.some((m) => runwayFor(m, state, today)) && (
        <section class="section">
          <SectionHead no="■" label="Runway" title="余额续航" />
          <div class="grid-2">
            {state.methods
              .map((m) => runwayFor(m, state, today))
              .filter((r) => r != null)
              .map((r) => (
                <RunwayCard key={r.method.id} r={r} today={today} state={state} />
              ))}
          </div>
        </section>
      )}

      {edit && <MethodEditor m={edit} state={state} onClose={() => setEdit(null)} />}
      {topup && <TopupSheet m={topup.m} current={topup.current} today={today} onClose={() => setTopup(null)} />}
    </div>
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
        <div class="seg-ctl" style={{ alignSelf: 'flex-start' }}>
          <button class={mode === 'add' ? 'on' : ''} onClick={() => setMode('add')}>
            充值
          </button>
          <button class={mode === 'set' ? 'on' : ''} onClick={() => setMode('set')}>
            校准为实际余额
          </button>
        </div>
        <label class="field">
          <span>{mode === 'add' ? `充值金额（${m.currency}）` : `当前实际余额（${m.currency}）`}</span>
          <input class="input num" inputMode="decimal" autoFocus value={val} onInput={(e) => setVal((e.target as HTMLInputElement).value)} placeholder="0.00" />
        </label>
        <dl class="kv">
          <dt>系统估算余额</dt>
          <dd>{money(current, m.currency)}</dd>
          <dt>保存后</dt>
          <dd>
            <b>{money(next, m.currency)}</b>
          </dd>
        </dl>
        <small class="muted">保存时以今天为校准日，之后的扣款会按订阅周期自动从余额中推演扣除。</small>
      </div>
    </Sheet>
  );
}

export function MethodEditor({ m, state, onClose }: { m: PaymentMethod; state: AppState; onClose: () => void }) {
  const [f, setF] = useState<PaymentMethod>(m);
  const isNew = !state.methods.some((x) => x.id === m.id);
  const up = (p: Partial<PaymentMethod>) => setF({ ...f, ...p });
  const balanceKind = BALANCE_KINDS.includes(f.kind);
  return (
    <Sheet
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
            保存
          </button>
        </>
      }
    >
      <div class="form">
        <label class="field full">
          <span>名称</span>
          <input class="input" value={f.name} placeholder="如：招商银行、App Store 土耳其区、SMART 手机卡" onInput={(e) => up({ name: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="field">
          <span>类型</span>
          <select class="input" value={f.kind} onChange={(e) => up({ kind: (e.target as HTMLSelectElement).value as MethodKind })}>
            {(Object.keys(KIND_LABEL) as MethodKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>账户币种</span>
          <select class="input" value={f.currency} onChange={(e) => up({ currency: (e.target as HTMLSelectElement).value })}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {NEEDS_LAST4.includes(f.kind) && (
          <label class="field">
            <span>卡号尾号</span>
            <input class="input num" maxLength={4} value={f.last4 ?? ''} onInput={(e) => up({ last4: (e.target as HTMLInputElement).value.replace(/\D/g, '') || undefined })} />
          </label>
        )}
        <label class="field">
          <span>地区</span>
          <input class="input" value={f.region ?? ''} placeholder="TR / NG / PH" onInput={(e) => up({ region: (e.target as HTMLInputElement).value.toUpperCase() || undefined })} />
        </label>
        {balanceKind && (
          <>
            <label class="field">
              <span>当前余额</span>
              <input
                class="input num"
                inputMode="decimal"
                value={f.balance ?? ''}
                placeholder="留空则不推演"
                onInput={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  up({ balance: v === '' ? undefined : Number(v), balanceAsOf: f.balanceAsOf ?? new Date().toISOString().slice(0, 10) });
                }}
              />
            </label>
            <label class="field">
              <span>余额校准日</span>
              <input class="input" type="date" value={f.balanceAsOf ?? ''} onInput={(e) => up({ balanceAsOf: (e.target as HTMLInputElement).value || undefined })} />
            </label>
            <label class="field">
              <span>不足预警（天）</span>
              <input class="input num" inputMode="numeric" value={f.lowRunwayDays ?? 30} onInput={(e) => up({ lowRunwayDays: Number((e.target as HTMLInputElement).value) || 30 })} />
            </label>
          </>
        )}
        <label class="field">
          <span>返现 / 积分（%）</span>
          <input class="input num" inputMode="decimal" value={f.cashback ?? ''} placeholder="如 1.5" onInput={(e) => up({ cashback: Number((e.target as HTMLInputElement).value) || undefined })} />
        </label>
        <label class="field full">
          <span>备注</span>
          <textarea class="input" value={f.notes ?? ''} onInput={(e) => up({ notes: (e.target as HTMLTextAreaElement).value || undefined })} />
        </label>
      </div>
    </Sheet>
  );
}

export function confirmDelete(msg: string): boolean {
  return window.confirm(msg);
}
