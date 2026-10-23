import { copyParts } from '../components/copy.tsx';
import { base } from '../base.ts';
import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { useId, useRef, useState } from 'react';
import { activePhases, currentPhase, cycleLabel, diffDays, effectiveStatus, monthlyMine, runwayFor, uid, type Runway } from '../../../shared/billing.ts';
import { flow, cnDate, cnDateFull, money, relDays } from '../../../shared/format.ts';
import { toBaseAt } from '../../../shared/fx.ts';
import { BALANCE_KINDS, type AppState, type CardNetwork, type MethodKind, type PaymentMethod, type Subscription, type TopUp } from '../../../shared/types.ts';
import { DatePicker } from '../components/DatePicker.tsx';
import {
  IconButton,
  Amount,
  ask,
  Cell,
  FlagImg,
  Group,
  Icon,
  MethodMark,
  NetworkMark,
  NumInput,
  MoneyInput,
  Seg,
  Sheet,
  SubIcon,
  Toggle,
  Toolbar,
} from '../components/ui.tsx';
import { bankOf, brandOf, domainOf, methodLogo, KIND_BG, KIND_LABEL, liveSubs, methodName, methodRegion, NETWORKS } from '../derive.ts';
import { deleteMethod, getState, mergeEdits, reorderMethods, run, saveMethod, today } from '../store.ts';
import { go } from '../router.ts';
import { BANKS } from '../banks.ts';
import { CurrencySelect, Picker, RegionSelect } from '../components/Picker.tsx';
import { t } from '../../../shared/i18n.ts';
import { tx } from '../i18n.ts';
import { useMoneyPair } from '../components/MoneyPair.tsx';

function RunwayCard({ r, today, state, flat, detailsOnly }: { r: Runway; today: string; state: AppState; flat?: boolean; detailsOnly?: boolean }) {
  // 大字 / 小字金额跟随显示货币设置
  const pair = useMoneyPair(state);
  const m = r.method;
  const daysLeft = r.runsOutOn ? diffDays(today, r.runsOutOn) : Infinity;
  const pct = r.monthlyDrain <= 0 ? 0 : Math.min(100, (Math.min(daysLeft, 365) / 365) * 100);
  const tone = daysLeft <= 7 ? 'out' : daysLeft <= (m.lowRunwayDays ?? 30) ? 'low' : '';
  const bal = pair(r.current, m.currency, { plain: true });
  const body = (
    <div className="runway">
      <div className="rw-top">
        <MethodMark m={m} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{m.name}</div>
          {!detailsOnly && (
            <div className="muted" style={{ fontSize: 'var(--fs-1)' }}>
              {t('wallet.runway.drain', { amount: flow(-r.monthlyDrain, m.currency, { compact: true }) })}
            </div>
          )}
        </div>
        {!detailsOnly && (
          <div style={{ textAlign: 'right' }}>
            <div className="rw-bal">{bal.main}</div>
            {bal.alt && (
              <div className="soft" style={{ fontSize: 'var(--fs-1)' }}>
                {bal.alt}
              </div>
            )}
          </div>
        )}
      </div>
      <div className={`rw-track ${tone}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="rw-scale">
        <span>{t('wallet.runway.scale.today')}</span>
        <span>{t('wallet.runway.scale.m3')}</span>
        <span>{t('wallet.runway.scale.m6')}</span>
        <span>{t('wallet.runway.scale.m9')}</span>
        <span>{t('wallet.runway.scale.y1')}</span>
      </div>
      <div className="rw-note">
        {r.monthlyDrain <= 0 ? (
          t('wallet.runway.noSubs')
        ) : r.shortfall && r.coveredCharges === 0 ? (
          <>
            {tx('wallet.runway.shortNow', {
              date: <b>{cnDate(r.shortfall.date)}</b>,
              rel: relDays(daysLeft),
              name: r.shortfall.sub.name,
              amount: money(r.shortfall.amount, r.shortfall.currency),
              topup: <b>{money(r.topUp12m, m.currency, { compact: true })}</b>,
            })}
          </>
        ) : r.shortfall && r.topUp12m > 0 ? (
          <>
            {tx('wallet.runway.shortLater', {
              periods: <b>{t('wallet.runway.periods', { count: r.coveredCharges })}</b>,
              date: <b>{cnDateFull(r.shortfall.date)}</b>,
              rel: relDays(daysLeft),
              name: r.shortfall.sub.name,
              topup: <b>{money(r.topUp12m, m.currency, { compact: true })}</b>,
            })}
          </>
        ) : (
          <>{tx('wallet.runway.ok', { periods: <b>{t('wallet.runway.periods', { count: r.coveredCharges })}</b> })}</>
        )}
      </div>
    </div>
  );
  return flat ? body : <div className="card">{body}</div>;
}

const CARD_KINDS: MethodKind[] = ['debit', 'credit', 'crypto'];

/** 手机号分组显示：+63 917 123 4567 */
function fmtPhone(p: string): string {
  const d = p.replace(/[^\d+]/g, '');
  const m = d.match(/^\+(\d{1,3})(\d{3})(\d{3})(\d{3,4})$/);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p;
}

const isSim = (m: PaymentMethod) => m.kind === 'phone';

/** 卡面样式：手机话费做成 SIM 卡，App Store 余额做成钛金属卡（参照 Apple Card），Google Play 是白底深字 */
const faceClass = (m: PaymentMethod) => (isSim(m) ? 'sim' : brandOf(m) === 'appstore' ? 'apple' : m.kind === 'googleplay' ? 'light' : '');

/** 卡面：品牌标旋转放大做水印并渐隐，角上放清晰的小 logo；手机话费做成 SIM 卡 */
function CardFace({ m, label, value, right, rightSub }: { m: PaymentMethod; label: string; value: React.ReactNode; right: string; rightSub: string }) {
  const brand = brandOf(m);
  if (isSim(m)) {
    // 卡托细槽分段留出连接桥；芯片与银行卡共用组件和尺寸，不随槽线 SVG 缩放。
    return (
      <>
        <div className="sim-punch" aria-hidden="true">
          <svg className="sim-cutouts" viewBox="0 0 120 72">
            <path className="sim-slot" d="M2 32V6Q2 2 6 2H48M53 2H100L118 20V45M118 50V66Q118 70 114 70H75M70 70H6Q2 70 2 66V37" />
            <path className="sim-slot" d="M18 33V16Q18 12 22 12H49M54 12H84L102 30V44M102 49V56Q102 60 98 60H66M61 60H22Q18 60 18 56V38" />
          </svg>
          <CardChip />
        </div>
        <div className="sim-top">
          {/* 只有认出是哪家运营商（如 SMART）才放它的 logo，否则写名字，不默认套某一家 */}
          {methodLogo(m) ? (
            <img className={`sim-logo ${m.logoWide ? 'wide' : ''}`} src={base(methodLogo(m) || '')} alt="" />
          ) : (
            <b className="sim-carrier">{m.name.split(/\s/)[0]}</b>
          )}
        </div>
        <div className="sim-name">
          {m.name}
          <small>
            <FlagImg cc={methodRegion(m)} /> {copyParts(m.phone ? fmtPhone(m.phone) : `${KIND_LABEL[m.kind]}\n${m.currency}`)}
          </small>
        </div>
        <div className="pc-foot">
          <div>
            {label && <div className="o">{label}</div>}
            <div className="pc-bal">{value}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="o">{right}</div>
            <div style={{ fontWeight: 600 }}>{rightSub}</div>
          </div>
        </div>
      </>
    );
  }
  if (brand === 'appstore') {
    // 白色钛金属卡面：左上激光蚀刻的 App Store 标与地区名，右上国旗；余额与其他卡一样放左下
    return (
      <>
        <div className="pc-top">
          <div className="pc-id">
            <span className="ac-logo" aria-hidden="true" />
            <div className="ac-name">{m.name}</div>
          </div>
          <span className="ac-flag">
            <FlagImg cc={methodRegion(m)} />
          </span>
        </div>
        <div className="pc-foot">
          <div>
            {label && <div className="ac-o">{label}</div>}
            <div className="pc-bal">{value}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="ac-o">{right}</div>
            <div style={{ fontWeight: 600 }}>{rightSub}</div>
          </div>
        </div>
      </>
    );
  }
  // 自定义 logo 优先（可以放适配卡面的白色版本），其余银行卡用银行图标集
  const bank = bankOf(m);
  const logo = methodLogo(m);
  const cls = m.logoWide ? 'wide' : (brand ?? '');
  return (
    <>
      {logo && <img className={`pc-mark ${cls}`} src={base(logo)} alt="" aria-hidden="true" />}
      <div className="pc-top">
        <div className="pc-id">
          {logo ? (
            <img className={`pc-logo ${cls}`} src={base(logo)} alt="" />
          ) : bank ? (
            <img className="pc-logo bank" src={base(`/banks/${bank}-rect.svg`)} alt="" />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <div className="pc-name text-ellipsis">{m.name}</div>
            <div className="pc-kind">
              {KIND_LABEL[m.kind]}
              {copyParts(m.network ? `\n${m.currency}` : '')}
              {copyParts(m.region ? `\n${m.region}` : '')}
              {copyParts(m.cashback ? `\n${t('wallet.card.cashback', { pct: m.cashback })}` : '')}
            </div>
          </div>
        </div>
        {m.network ? <NetworkMark network={m.network} height={26} /> : <span className="pc-ccy">{m.currency}</span>}
      </div>
      {CARD_KINDS.includes(m.kind) && <CardChip />}
      <div className="pc-foot">
        <div>
          {label && <div className="o">{label}</div>}
          <div className="pc-bal">{value}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="o">{right}</div>
          <div style={{ fontWeight: 600 }}>{rightSub}</div>
        </div>
      </div>
    </>
  );
}

/** 扣款推演只列到余额第一次变成负数的那一期，之后都不够扣，没必要再列 */
function projRows(r: Runway) {
  const first = r.upcoming.findIndex((c) => c.balanceAfter < 0);
  return first < 0 ? r.upcoming.slice(0, 10) : r.upcoming.slice(0, Math.min(first + 1, 10));
}
function projFoot(r: Runway, m: PaymentMethod): string | undefined {
  if (!r.shortfall) return undefined;
  return t('wallet.runway.projFoot', { amount: money(r.topUp12m, m.currency, { compact: true }) });
}

/** 卡面右下角的小字：设了余额的说还够扣几期，没设的显示卡号尾号 */
function cardHint(m: PaymentMethod, r: Runway | undefined): string {
  if (r) {
    if (r.monthlyDrain <= 0) return t('wallet.card.noCharges');
    if (!r.shortfall) return t('wallet.card.enough');
    return r.coveredCharges ? t('wallet.card.periodsLeft', { count: r.coveredCharges }) : t('wallet.card.low');
  }
  if (m.last4) return `•••• ${m.last4}`;
  return BALANCE_KINDS.includes(m.kind) ? t('wallet.card.noBalance') : '';
}

/** 可拖动排序的卡片：拖起时放大、加深阴影，其余卡片让位 */
function SortableCard({ m, onOpen, children }: { m: PaymentMethod; onOpen: () => void; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.id });
  return (
    <button
      ref={setNodeRef as (el: HTMLButtonElement | null) => void}
      {...(attributes as unknown as Record<string, unknown>)}
      {...(listeners as Record<string, unknown>)}
      className={`paycard ${faceClass(m)} ${isDragging ? 'lifted' : ''}`}
      // 拖动排序使用独立的 translate 属性
      style={
        {
          '--card-bg': m.color || KIND_BG[m.kind],
          translate: transform ? `${transform.x}px ${transform.y}px` : undefined,
          '--sort-t': transition ? transition.replace('transform', 'translate') : 'translate 0s',
        } as Record<string, string>
      }
      onClick={onOpen}
      onMouseMove={(e) => {
        // 光泽跟着鼠标走，卡片朝鼠标方向轻微倾斜（最多 4°），像拿在手里转一下
        if (isDragging) return;
        const el = e.currentTarget;
        const b = el.getBoundingClientRect();
        const px = Math.max(-0.5, Math.min(0.5, (e.clientX - b.left) / b.width - 0.5));
        const py = Math.max(-0.5, Math.min(0.5, (e.clientY - b.top) / b.height - 0.5));
        el.style.setProperty('--mx', `${e.clientX - b.left}px`);
        el.style.setProperty('--my', `${e.clientY - b.top}px`);
        el.style.setProperty('--ry', `${(px * 8).toFixed(2)}deg`);
        el.style.setProperty('--rx', `${(-py * 8).toFixed(2)}deg`);
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      }}
    >
      {children}
    </button>
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
  const [dragging, setDragging] = useState(false);
  // 鼠标拖 6px 才算拖动，单击仍是打开；触屏长按 250ms 再拖，不影响滚动
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <>
      <Toolbar title={t('wallet.title')} sub={t('wallet.sub', { count: state.methods.length })}>
        {!ro && (
          <button className="btn primary" onClick={() => setEdit({ id: uid(), name: '', kind: 'appstore', currency: 'TRY' })}>
            <Icon name="plus" /> {t('wallet.add')}
          </button>
        )}
      </Toolbar>
      <div className="page fade-in stack">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={() => setDragging(true)}
          onDragCancel={() => setDragging(false)}
          onDragEnd={(e: DragEndEvent) => {
            setDragging(false);
            const ids = state.methods.map((m) => m.id);
            const from = ids.indexOf(String(e.active.id));
            const to = e.over ? ids.indexOf(String(e.over.id)) : -1;
            if (from < 0 || to < 0 || from === to) return;
            run(() => reorderMethods(arrayMove(ids, from, to)), t('wallet.orderSaved'));
          }}
        >
          <SortableContext items={state.methods.map((m) => m.id)} strategy={rectSortingStrategy} disabled={ro}>
            <div className={`wallet-grid ${dragging ? 'dragging' : ''}`}>
              {state.methods.map((m) => {
                // 按当前阶段归属支付方式（换区后新旧两段并行时，两张卡各算各的）；代付的钱不算我的支出
                const liveHere = live.filter((s) => !s.proxy && [currentPhase(s, today), ...activePhases(s, today)].some((v) => v.methodId === m.id));
                const r = runwayFor(m, state, today);
                const monthly = liveHere.reduce((a, s) => a + monthlyMine(state, s, today, m.id), 0);
                return (
                  <SortableCard key={m.id} m={m} onOpen={() => setOpen(m.id)}>
                    <CardFace
                      m={m}
                      // 设了余额的账户主数字是余额，右下是每月扣多少、还能扣几期；没有余额的卡主数字是每月支出
                      label={r ? t('wallet.card.balance') : t('wallet.card.monthlySpend')}
                      value={r ? <Amount plain value={r.current} ccy={m.currency} /> : <Amount value={-monthly} ccy={base} />}
                      right={
                        r && r.monthlyDrain > 0
                          ? t('wallet.runway.drain', { amount: flow(-r.monthlyDrain, m.currency, { compact: true }) })
                          : t('wallet.card.subs', { count: liveHere.length })
                      }
                      rightSub={r && r.monthlyDrain > 0 ? t('wallet.card.subs', { count: liveHere.length }) : cardHint(m, r)}
                    />
                  </SortableCard>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        {/* 只列有关联计费订阅的余额；空着的账户（比如还没用上的美国区）不占位置 */}
        {state.methods.some((m) => (runwayFor(m, state, today)?.monthlyDrain ?? 0) > 0) && (
          <Group title={t('wallet.runwayGroup')}>
            {state.methods
              .map((m) => runwayFor(m, state, today))
              .filter((r): r is NonNullable<typeof r> => r != null && r.monthlyDrain > 0)
              .map((r) => (
                <div key={r.method.id} className="cell" style={{ display: 'block', padding: '14px 16px' }}>
                  <RunwayCard r={r} today={today} state={state} flat detailsOnly />
                </div>
              ))}
          </Group>
        )}

        <Group>
          <Cell
            label={
              <span className="row">
                <Icon name="car" />
                {t('wallet.family')}
              </span>
            }
            onClick={() => go('family')}
          >
            {t('wallet.familyCount', { count: state.subscriptions.filter((s) => s.share).length })}
          </Cell>
        </Group>

        {unassigned.length > 0 && (
          <Group title={t('wallet.unassigned', { count: unassigned.length })}>
            {unassigned.map((s) => (
              <Cell
                key={s.id}
                label={
                  <span className="row">
                    <SubIcon sub={s} size={28} />
                    {s.name}
                  </span>
                }
                onClick={() => onOpen(s)}
              >
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

function MethodSheet({
  m,
  state,
  today,
  onClose,
  onEdit,
  onTopup,
  onOpen,
}: {
  m: PaymentMethod;
  state: AppState;
  today: string;
  onClose: () => void;
  onEdit: () => void;
  onTopup: (current: number) => void;
  onOpen: (s: Subscription) => void;
}) {
  const r = runwayFor(m, state, today);
  const subs = state.subscriptions.filter((s) => s.methodId === m.id);
  const ro = !!state.readonly;
  return (
    <Sheet narrow title={methodName(m)} onClose={onClose}>
      <div className="stack" style={{ gap: 18 }}>
        {!ro && (
          <div className="sheet-actions">
            <button className="btn" onClick={onEdit}>
              <Icon name="edit" /> {t('wallet.sheet.edit')}
            </button>
            {m.url && (
              <a className="btn" href={m.url} target="_blank" rel="noreferrer">
                <Icon name="link" /> {BALANCE_KINDS.includes(m.kind) ? t('wallet.sheet.goTopup') : t('wallet.sheet.site')}
              </a>
            )}
            {(r || BALANCE_KINDS.includes(m.kind)) && (
              <button className="btn primary" onClick={() => onTopup(r?.current ?? 0)}>
                {r ? t('wallet.sheet.topup') : t('wallet.sheet.setBalance')}
              </button>
            )}
          </div>
        )}
        {r && (
          <div className="card">
            <RunwayCard r={r} today={today} state={state} flat />
          </div>
        )}
        {r && r.upcoming.length > 0 && (
          <Group title={t('wallet.sheet.projection')} foot={projFoot(r, m)}>
            {projRows(r).map((c, i) => (
              <Cell
                key={c.sub.id + c.date + i}
                label={
                  <span className="row">
                    <SubIcon sub={c.sub} size={28} />
                    <span className="proj-name">
                      {c.sub.name}
                      <small>{cnDate(c.date)}</small>
                    </span>
                  </span>
                }
                onClick={() => onOpen(state.subscriptions.find((x) => x.id === c.sub.id) ?? c.sub)}
              >
                <span className={c.amountInMethod < 0 ? 'green' : undefined}>{flow(-c.amountInMethod, m.currency, { compact: true })}</span>
                <b style={{ color: c.balanceAfter < 0 ? 'var(--red)' : 'var(--label)', fontWeight: 600, minWidth: 80 }}>
                  {money(c.balanceAfter, m.currency, { compact: true })}
                </b>
              </Cell>
            ))}
          </Group>
        )}
        <Group title={t('wallet.sheet.linked', { count: subs.length })}>
          {subs.length === 0 && <div className="cell muted">{t('wallet.sheet.none')}</div>}
          {subs.map((s) => (
            <Cell
              key={s.id}
              label={
                <span className="row" style={{ opacity: ['ended', 'terminated'].includes(effectiveStatus(s, today)) ? 0.45 : 1 }}>
                  <SubIcon sub={s} size={28} />
                  {s.name}
                </span>
              }
              onClick={() => onOpen(s)}
            >
              {money(s.price, s.currency)} <span className="copy-gap" aria-hidden="true" /> {cycleLabel(s.cycle)}
            </Cell>
          ))}
        </Group>
        {m.notes && (
          <Group title={t('wallet.sheet.notes')}>
            <div className="cell" style={{ fontSize: 'var(--fs-2)' }}>
              {m.notes}
            </div>
          </Group>
        )}
      </div>
    </Sheet>
  );
}

/**
 * 充值 / 校准余额。充值时可以顺便记下实际花了多少（比如买土耳其区礼品卡花的人民币），
 * 下面列出历次充值和实际汇率，对比市价看溢价多少。
 */
function TopupSheet({ m, current, today, onClose }: { m: PaymentMethod; current: number; today: string; onClose: () => void }) {
  const state = getState();
  const [mode, setMode] = useState<'add' | 'set'>(m.balance == null ? 'set' : 'add');
  const [val, setVal] = useState('');
  const [date, setDate] = useState(today);
  const [cost, setCost] = useState('');
  const [costCcy, setCostCcy] = useState(state.settings.baseCurrency);
  const [note, setNote] = useState('');
  const n = Number(val);
  const next = mode === 'add' ? current + (n || 0) : n || 0;
  const tops = (m.topUps ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
  // 实际成本折算：每 1 单位账户币种花了多少（成本币种），对比当天市价
  const rateOf = (tp: TopUp) => (tp.cost != null && tp.amount ? tp.cost / tp.amount : undefined);
  const market = (tp: TopUp) => toBaseAt(state, 1, m.currency, tp.date, tp.costCurrency ?? state.settings.baseCurrency);
  const save = () =>
    run(
      async () => {
        const top: TopUp | undefined =
          mode === 'add' && n > 0
            ? { date, amount: n, cost: cost === '' ? undefined : Number(cost), costCurrency: cost === '' ? undefined : costCcy, note: note.trim() || undefined }
            : undefined;
        await saveMethod({ ...m, balance: Math.round(next * 100) / 100, balanceAsOf: today, topUps: top ? [...(m.topUps ?? []), top] : m.topUps });
        onClose();
      },
      mode === 'add' ? t('wallet.topup.toastAdd') : t('wallet.topup.toastSet'),
    );
  const removeTop = (tp: TopUp) => run(() => saveMethod({ ...m, topUps: (m.topUps ?? []).filter((x) => x !== tp) }), t('wallet.topup.removed'));
  return (
    <Sheet
      narrow
      title={m.name}
      onClose={onClose}
      foot={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('wallet.topup.cancel')}
          </button>
          <button className="btn primary" disabled={!val || !Number.isFinite(n)} onClick={save}>
            {t('wallet.topup.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            ['add', t('wallet.topup.modeAdd')],
            ['set', t('wallet.topup.modeSet')],
          ]}
        />
        <Group>
          <Cell label={mode === 'add' ? t('wallet.topup.amount', { ccy: m.currency }) : t('wallet.topup.actual')}>
            <MoneyInput
              ccy={m.currency}
              className="num"
              autoFocus
              value={val}
              onChange={(e) => setVal((e.target as HTMLInputElement).value)}
              placeholder={`${m.currency} 0.00`}
            />
          </Cell>
          <Cell label={t('wallet.topup.estimate')}>{money(current, m.currency)}</Cell>
          <Cell label={t('wallet.topup.after')}>
            <b style={{ color: 'var(--label)' }}>{money(next, m.currency)}</b>
          </Cell>
        </Group>
        {mode === 'add' && (
          <Group title={t('wallet.topup.optional')}>
            <Cell label={t('wallet.topup.date')}>
              <DatePicker value={date} onChange={(v) => setDate(v ?? today)} />
            </Cell>
            <Cell label={t('wallet.topup.costCcy')}>
              <CurrencySelect value={costCcy} onChange={setCostCcy} />
            </Cell>
            <Cell label={t('wallet.topup.cost')}>
              <MoneyInput
                ccy={costCcy}
                className="num"
                value={cost}
                placeholder={t('wallet.topup.costPh')}
                onChange={(e) => setCost((e.target as HTMLInputElement).value)}
              />
            </Cell>
            <Cell label={t('wallet.topup.note')}>
              <input value={note} placeholder={t('wallet.topup.notePh')} onChange={(e) => setNote((e.target as HTMLInputElement).value)} />
            </Cell>
          </Group>
        )}
        {tops.length > 0 && (
          <Group title={t('wallet.topup.history', { count: tops.length })}>
            {tops.map((tp, i) => {
              const r = rateOf(tp);
              const mk = market(tp);
              const premium = r && mk ? r / mk - 1 : undefined;
              return (
                <div key={i} className="cell topup-row">
                  <span className="cell-l">
                    <span className="green">{flow(tp.amount, m.currency)}</span>
                    <small>
                      {tp.date}
                      {copyParts(
                        tp.cost != null ? `\n${t('wallet.topup.spent', { amount: flow(-tp.cost, tp.costCurrency ?? state.settings.baseCurrency) })}` : '',
                      )}
                      {copyParts(tp.note ? `\n${tp.note}` : '')}
                    </small>
                  </span>
                  <span className="cell-r">
                    {r != null && (
                      <span className="topup-rate">
                        1 {m.currency} = {r.toFixed(r < 0.1 ? 4 : 3)} {tp.costCurrency}
                        {premium != null && Math.abs(premium) >= 0.005 && (
                          <em className={premium > 0 ? 'up' : 'down'}>
                            {premium > 0
                              ? t('wallet.topup.premium', { pct: Math.round(premium * 100) })
                              : t('wallet.topup.below', { pct: Math.round(-premium * 100) })}
                          </em>
                        )}
                      </span>
                    )}
                    <IconButton aria-label={t('wallet.topup.removeAria')} onClick={() => removeTop(tp)}>
                      <Icon name="x" />
                    </IconButton>
                  </span>
                </div>
              );
            })}
          </Group>
        )}
      </div>
    </Sheet>
  );
}

function MethodEditor({ m, state, onClose }: { m: PaymentMethod; state: AppState; onClose: () => void }) {
  const [f, setF] = useState<PaymentMethod>(m);
  const isNew = !state.methods.some((x) => x.id === m.id);
  const up = (p: Partial<PaymentMethod>) => setF({ ...f, ...p });
  const balanceKind = BALANCE_KINDS.includes(f.kind);
  const val = (e: { target: EventTarget | null }) => (e.target as HTMLInputElement).value;
  return (
    <Sheet
      narrow
      title={isNew ? t('wallet.editor.titleNew') : t('wallet.editor.titleEdit')}
      onClose={onClose}
      foot={
        <>
          {!isNew && (
            <button
              className="btn danger"
              onClick={async () =>
                (await ask(t('wallet.editor.confirmDelete', { name: m.name }))) &&
                run(async () => {
                  await deleteMethod(m.id);
                  onClose();
                }, t('wallet.editor.deleted'))
              }
            >
              {t('wallet.editor.delete')}
            </button>
          )}
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('wallet.editor.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={!f.name.trim()}
            onClick={() =>
              run(async () => {
                const edited = { ...f, name: f.name.trim() };
                await saveMethod(
                  isNew
                    ? edited
                    : mergeEdits(
                        m,
                        edited,
                        getState().methods.find((x) => x.id === m.id),
                      ),
                );
                onClose();
              }, t('wallet.editor.saved'))
            }
          >
            {t('wallet.editor.done')}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className={`paycard ${faceClass(f)}`} style={{ '--card-bg': f.color || KIND_BG[f.kind], cursor: 'default' } as Record<string, string>}>
          <CardFace
            m={{ ...f, name: f.name || t('wallet.editor.newName') }}
            label=""
            value=""
            right={f.region ?? ''}
            rightSub={f.last4 ? `•••• ${f.last4}` : ''}
          />
        </div>
        <Group>
          <Cell label={t('wallet.editor.name')}>
            <input value={f.name} placeholder={t('wallet.editor.namePh')} onChange={(e) => up({ name: val(e) })} />
          </Cell>
          <Cell label={t('wallet.editor.url')}>
            <input value={f.url ?? ''} placeholder={t('wallet.editor.urlPh')} onChange={(e) => up({ url: val(e).trim() || undefined })} />
          </Cell>
          <Cell label={t('wallet.editor.kind')}>
            <Picker
              value={f.kind}
              onChange={(k) => up({ kind: k })}
              options={(Object.keys(KIND_LABEL) as MethodKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              ariaLabel={t('wallet.editor.kind')}
            />
          </Cell>
          {(f.kind === 'debit' || f.kind === 'credit') && (
            <Cell label={t('wallet.editor.bank')} sub={f.bank ? undefined : bankOf({ ...f, bank: undefined }) ? t('wallet.editor.bankDetected') : undefined}>
              <Picker
                value={f.bank ?? ''}
                onChange={(v) => up({ bank: v || undefined })}
                search
                options={[
                  { value: '', label: t('wallet.editor.bankAuto') },
                  ...[...BANKS]
                    .sort((x, y) => x[0].localeCompare(y[0], 'zh'))
                    .map(([name, code]) => ({ value: code, label: name, icon: <img className="pk-brand" src={base(`/banks/${code}-rect.svg`)} alt="" /> })),
                ]}
                ariaLabel={t('wallet.editor.bank')}
              />
            </Cell>
          )}
          {brandOf(f) ? (
            <Cell label="Logo" sub={t('wallet.editor.logoBuiltIn', { kind: KIND_LABEL[f.kind] })}>
              <MethodMark m={f} size={28} />
            </Cell>
          ) : (
            <LogoField f={f} up={up} />
          )}
          <Cell label={t('wallet.editor.currency')}>
            <CurrencySelect value={f.currency} onChange={(c) => up({ currency: c })} />
          </Cell>
          {CARD_KINDS.includes(f.kind) && (
            <Cell label={t('wallet.editor.network')}>
              <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <NetworkMark network={f.network} height={20} />
                <Picker
                  value={f.network ?? ''}
                  onChange={(n) => up({ network: (n || undefined) as CardNetwork | undefined })}
                  options={[
                    { value: '', label: t('wallet.editor.networkNone') },
                    ...(Object.keys(NETWORKS) as CardNetwork[]).map((n) => ({
                      value: n,
                      label: NETWORKS[n],
                      icon: <img className="pk-net" src={base(`/networks/${n}.svg`)} alt="" />,
                    })),
                  ]}
                  ariaLabel={t('wallet.editor.network')}
                />
              </span>
            </Cell>
          )}
          {(f.kind === 'debit' || f.kind === 'credit') && (
            <Cell label={t('wallet.editor.bankIcon')}>
              <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                {bankOf(f) ? <MethodMark m={f} size={22} /> : null}
                <span className="muted">{bankOf(f) ? (f.bank ? t('wallet.editor.bankSet') : t('wallet.editor.bankAuto')) : t('wallet.editor.bankHint')}</span>
              </span>
            </Cell>
          )}
          {CARD_KINDS.includes(f.kind) && (
            <Cell label={t('wallet.editor.last4')}>
              <input className="num" maxLength={4} value={f.last4 ?? ''} onChange={(e) => up({ last4: val(e).replace(/\D/g, '') || undefined })} />
            </Cell>
          )}
          <Cell label={t('wallet.editor.region')}>
            <RegionSelect
              value={f.region}
              onChange={(r) => up({ region: r })}
              common={
                getState()
                  .methods.map((m) => m.region)
                  .filter(Boolean) as string[]
              }
            />
          </Cell>
          {f.kind === 'phone' && (
            <Cell label={t('wallet.editor.phone')}>
              <input inputMode="tel" value={f.phone ?? ''} placeholder="+63 9xx xxx xxxx" onChange={(e) => up({ phone: val(e).trim() || undefined })} />
            </Cell>
          )}
          <Cell label={t('wallet.editor.cashback')}>
            <NumInput className="num" value={f.cashback} placeholder={t('wallet.editor.cashbackPh')} onValue={(n) => up({ cashback: n || undefined })} />
          </Cell>
        </Group>
        {balanceKind && (
          <Group title={t('wallet.editor.balanceGroup')}>
            <Cell label={t('wallet.editor.balance')}>
              <NumInput
                className="num"
                ccy={f.currency}
                value={f.balance}
                placeholder={t('wallet.editor.optional')}
                onValue={(n) => up({ balance: n, balanceAsOf: f.balanceAsOf ?? today() })}
              />
            </Cell>
            <Cell label={t('wallet.editor.asOf')}>
              <DatePicker value={f.balanceAsOf} onChange={(v) => up({ balanceAsOf: v })} />
            </Cell>
            <Cell label={t('wallet.editor.lowAlert')}>
              <Picker
                value={f.lowRunwayDays ?? 30}
                onChange={(d) => up({ lowRunwayDays: d })}
                options={[7, 14, 30, 60].map((d) => ({ value: d, label: t('wallet.editor.lowAlertOpt', { count: d }) }))}
                ariaLabel={t('wallet.editor.lowAlertAria')}
              />
            </Cell>
          </Group>
        )}
        <Group title={t('wallet.editor.notes')}>
          <div className="cell">
            <span className="cell-r">
              <textarea value={f.notes ?? ''} onChange={(e) => up({ notes: (e.target as HTMLTextAreaElement).value || undefined })} />
            </span>
          </div>
        </Group>
      </div>
    </Sheet>
  );
}

/**
 * 自定义 logo：上传图片（缩到 160px 存进数据里）、粘贴图片链接，或直接用官网图标。
 * 横向字标（如 BYBIT）勾上「横向字标」，卡面上会按宽版显示。
 */
function LogoField({ f, up }: { f: PaymentMethod; up: (p: Partial<PaymentMethod>) => void }) {
  const [link, setLink] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target as HTMLInputElement;
    const fl = input.files?.[0];
    input.value = '';
    if (!fl) return;
    const img = new Image();
    img.onload = () => {
      const max = 160;
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      up({ logo: c.toDataURL('image/png') });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(fl);
  };
  const favicon = domainOf(f.url);
  let source = t('wallet.logo.none');
  if (f.logo) source = f.logo.startsWith('data:') ? t('wallet.logo.uploaded') : t('wallet.logo.link');
  else if (favicon) source = t('wallet.logo.favicon');
  else if (bankOf(f)) source = t('wallet.logo.bank');
  return (
    <>
      <div className="cell logo-field">
        <span className="cell-l">
          Logo
          <small>{source}</small>
        </span>
        <span className="cell-r">
          <MethodMark m={f} size={32} />
          <button type="button" className="chip-btn" onClick={() => file.current?.click()}>
            {t('wallet.logo.upload')}
          </button>
          <button type="button" className={`chip-btn ${link ? 'on' : ''}`} onClick={() => setLink(!link)}>
            {t('wallet.logo.linkBtn')}
          </button>
          {f.logo && (
            <button type="button" className="chip-btn" onClick={() => up({ logo: undefined })}>
              {t('wallet.logo.clear')}
            </button>
          )}
          <input ref={file} type="file" accept="image/*" hidden onChange={onFile} />
        </span>
      </div>
      {link && (
        <Cell label={t('wallet.logo.link')}>
          <input
            value={f.logo?.startsWith('data:') ? '' : (f.logo ?? '')}
            placeholder="https://…/logo.png"
            onChange={(e) => up({ logo: (e.target as HTMLInputElement).value.trim() || undefined })}
          />
        </Cell>
      )}
      {(f.logo || favicon) && (
        <Cell label={t('wallet.logo.wide')}>
          <Toggle label={t('wallet.logo.wide')} checked={!!f.logoWide} onChange={(v) => up({ logoWide: v || undefined })} />
        </Cell>
      )}
    </>
  );
}

/**
 * 银行卡芯片：金属金色底 + 触点分区（中间焊盘、左右各三格、上下引线）+ 一道斜向高光，
 * 线条用深金色细线，尺寸由 .pc-chip 决定、随卡片缩放
 */
function CardChip() {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="pc-chip" viewBox="0 0 36 27" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6e7b8" />
          <stop offset="0.45" stopColor="#dcbf78" />
          <stop offset="0.7" stopColor="#c9a65a" />
          <stop offset="1" stopColor="#e9d39a" />
        </linearGradient>
        <linearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0.25" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0.4" y="0.4" width="35.2" height="26.2" rx="5" fill={`url(#${id}g)`} stroke="rgba(120,90,20,0.5)" strokeWidth="0.6" />
      <g fill="none" stroke="rgba(110,80,20,0.55)" strokeWidth="0.6" strokeLinecap="round">
        <rect x="12" y="8" width="12" height="11" rx="2.2" />
        <path d="M18 0.6V8M18 19v7.4M0.6 9.5H12M0.6 17.5H12M24 9.5h11.4M24 17.5h11.4M12 13.5H0.6M24 13.5h11.4" />
      </g>
      <rect x="0.4" y="0.4" width="35.2" height="26.2" rx="5" fill={`url(#${id}h)`} />
    </svg>
  );
}
