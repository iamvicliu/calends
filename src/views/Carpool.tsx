import { cycleLabel, effectiveStatus, memberDues, nextCharge } from '../../shared/billing.ts';
import { useState } from 'preact/hooks';
import { cnDate, money } from '../../shared/format.ts';
import { toBaseAt } from '../../shared/fx.ts';
import type { AppState, ShareMember, Subscription } from '../../shared/types.ts';
import { billLabel, carLedger, contactText, MemberSheet, memberFee } from './Members.tsx';
import { Amount, Cell, Group, Icon, Seg, Sheet, SubIcon, Toolbar } from '../components/ui.tsx';
import { toBase } from '../derive.ts';
import { run, saveSub } from '../store.ts';

export function Carpool({ state, today, onOpen, onEdit }: { state: AppState; today: string; onOpen: (s: Subscription) => void; onEdit: (s: Subscription) => void }) {
  const base = state.settings.baseCurrency;
  const live = (s: Subscription) => ['active', 'ending', 'trial', 'paused'].includes(effectiveStatus(s, today));
  const owned = state.subscriptions.filter((s) => s.share?.role === 'owner' && live(s));
  const joined = state.subscriptions.filter((s) => s.share?.role === 'member' && live(s));
  const books = new Map(owned.map((s) => [s.id, carLedger(state, s, today)]));
  const yearNet = [...books.values()].reduce((a, b) => a + b.yearNet, 0);
  const yearIncome = [...books.values()].reduce((a, b) => a + b.yearIncome, 0);
  const owedAll = owned.flatMap((s) => memberDues(s, today)).filter((d) => d.periodsOwed > 0);
  const owedSum = owedAll.reduce((a, d) => a + toBase(state, d.owed, d.sub.currency), 0);
  const ro = !!state.readonly;
  const collect = state.settings.collectCurrency ?? base;
  const [convert, setConvert] = useState<Subscription | null>(null);
  const [member, setMember] = useState<{ s: Subscription; m?: ShareMember; collect?: boolean } | null>(null);
  // 车卡默认收起，只看净成本与座位；展开才看账本与成员明细
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('ledger:car-open') ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
    try {
      localStorage.setItem('ledger:car-open', JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };
  const candidates = state.subscriptions.filter((s) => !s.share && !s.proxy && live(s) && s.tags.some((t) => /合租|拼车|家庭|family/i.test(t)));

  return (
    <>
      <Toolbar title="合租" />
      <div class="page fade-in stack">
        <div class="grid g-3">
          <div class="card stat">
            <div class="stat-label">{yearNet < 0 ? '合租每年净赚' : '合租每年净成本'}</div>
            <div class="stat-value" style={{ color: yearNet < 0 ? 'var(--green)' : undefined }}>
              <Amount value={Math.abs(yearNet)} ccy={base} />
            </div>
            <div class="stat-sub">成员每年应交 {money(yearIncome, base, { compact: true })}</div>
          </div>
          <div class="card stat">
            <div class="stat-label">待收</div>
            <div class="stat-value" style={{ color: owedSum > 0 ? 'var(--orange)' : undefined }}>
              <Amount value={owedSum} ccy={base} />
            </div>
            <div class="stat-sub">{owedAll.length} 位成员未结清</div>
          </div>
          <div class="card stat">
            <div class="stat-label">合租数</div>
            <div class="stat-value">
              <span class="amt">
                {owned.length}
                <small> 发起 · </small>
                {joined.length}
                <small> 加入</small>
              </span>
            </div>
            <div class="stat-sub">我发起的 · 我加入的</div>
          </div>
        </div>

        {owned.length === 0 && (
          <div class="card empty">
            <b>还没有发起合租</b>
            在订阅编辑页把「谁在用」设为「我发起」，添加成员与每期份额。
          </div>
        )}
        {/* 两列各自独立：展开一张卡只撑高它所在的那一列，不影响同一行的另一张 */}
        <div class="car-cols">
          {[0, 1].map((col) => (
          <div class="car-col" key={col}>
          {owned.map((s, idx) => {
            if (idx % 2 !== col) return null;
            const sh = s.share!;
            const dues = memberDues(s, today);
            // 已退出的成员不占座，只在展开的明细里保留
            const onboard = sh.members.filter((m) => !m.left || m.left > today);
            const next = nextCharge(s, today);
            return (
              <div key={s.id} class="card stack" style={{ gap: 14, order: idx }}>
                <button class="row" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => onOpen(s)}>
                  <SubIcon sub={s} size={46} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{s.name}</div>
                    <div class="muted" style={{ fontSize: 13 }}>
                      {money(s.price, s.currency)} {cycleLabel(s.cycle)}
                      {next ? ` · 下次 ${cnDate(next)}` : ''}
                    </div>
                  </div>
                </button>
                <div class="seats-row">
                <div class="seats">
                  <span class="seat me" title="我"><img src="/icons/avatar.png" alt="我" /></span>
                  {onboard.map((m) => {
                    const owe = dues.find((d) => d.member.id === m.id)?.periodsOwed;
                    return (
                      <button key={m.id} type="button" disabled={ro} onClick={() => setMember({ s, m })} class={`seat ${m.exempt ? 'free' : owe ? 'owe' : 'on'}`} title={m.exempt ? `${m.name}（不分摊）` : m.name}>
                        {[...(m.name || '?')][0]}
                      </button>
                    );
                  })}
                  {Array.from({ length: Math.max(0, sh.seats - 1 - onboard.length) }, (_, i) => (
                    <button key={i} type="button" class="seat add" disabled={ro} onClick={() => setMember({ s })} aria-label="添加成员" title="添加成员">
                      +
                    </button>
                  ))}
                </div>
                {s.manageUrl && (
                  <a class="car-toggle" href={s.manageUrl} target="_blank" rel="noreferrer" title="打开家庭组管理页">
                    <Icon name="gear" size={14} /> 管理
                  </a>
                )}
                <button class={`car-toggle ${expanded.has(s.id) ? 'open' : ''}`} onClick={() => toggle(s.id)} aria-expanded={expanded.has(s.id)}>
                  {(() => {
                    const n = dues.filter((d) => d.periodsOwed > 0).length;
                    return n ? <span class="owe">{n} 人待收</span> : sh.members.length ? '已结清' : '还没有成员';
                  })()}
                  <Icon name="down" size={14} />
                </button>
                </div>
                <CarFacts book={books.get(s.id)!} base={base} />
                {expanded.has(s.id) && (
                <>
                {!ro && onboard.length < sh.seats - 1 && (
                  <button class="btn tinted" style={{ alignSelf: 'flex-start' }} onClick={() => setMember({ s })}>
                    <Icon name="plus" /> 添加成员（{sh.seats - 1 - onboard.length} 个空位）
                  </button>
                )}
                <div>
                  {dues.map((d) => (
                    <div key={d.member.id} class="member">
                      <button class="member-info" disabled={ro} onClick={() => setMember({ s, m: d.member })}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>
                          {d.member.name || '未命名'}
                          {d.member.left && d.member.left <= today && <span class="badge" style={{ marginLeft: 6 }}>{cnDate(d.member.left)} 已退出</span>}
                          {contactText(d.member) && <span class="muted" style={{ fontWeight: 400 }}> · {contactText(d.member)}</span>}
                        </div>
                        <div class="muted" style={{ fontSize: 12 }}>
                          {d.member.exempt ? (d.member.note ?? '占位不交钱') : `${billLabel(d.member.billEvery)} · ${d.member.paidUntil ? `已付至 ${d.member.paidUntil}` : '尚未收款'}`}
                          {d.member.payments?.length ? ` · ${d.member.payments.length} 笔收款` : ''}
                          {d.member.source ? ` · 来自 ${d.member.source}` : ''}
                        </div>
                      </button>
                      <div style={{ textAlign: 'right', fontSize: 13.5 }}>
                        {d.member.exempt ? <span class="muted" style={{ fontWeight: 600 }}>不分摊</span> : d.periodsOwed > 0 ? <b style={{ color: 'var(--orange)' }}>待收 {money(toBaseAt(state, d.owed, s.currency, undefined, collect), collect)}</b> : <span style={{ color: 'var(--green)', fontWeight: 600 }}>已结清</span>}
                        {!d.member.exempt && (
                          <div class="muted" style={{ fontSize: 12 }}>
                            每{billLabel(d.member.billEvery).slice(1)}收 {money(memberFee(state, s, d.member).amount, memberFee(state, s, d.member).currency)}
                          </div>
                        )}
                      </div>
                      {!ro && !d.member.exempt && (
                        <button class={`btn ${d.periodsOwed > 0 ? 'primary' : ''}`} onClick={() => setMember({ s, m: d.member, collect: true })}>
                          <Icon name="check" /> 收款
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                </>
                )}
              </div>
            );
          })}
          </div>
          ))}
        </div>

        {joined.length > 0 && (
          <Group title="我加入的合租">
            {joined.map((s) => (
              <Cell key={s.id} label={<span class="row"><SubIcon sub={s} size={30} />{s.name}</span>} sub={undefined} onClick={() => onOpen(s)}>
                付给 {s.share?.ownerName ?? '发起人'} · {money(s.price, s.currency)}
              </Cell>
            ))}
          </Group>
        )}

        {candidates.length > 0 && !ro && (
          <Group title="可能在合租">
            {candidates.map((s) => (
              <div key={s.id} class="cell">
                <span class="cell-l">
                  <span class="row">
                    <SubIcon sub={s} size={30} />
                    {s.name}
                  </span>
                </span>
                <span class="cell-r">
                  {money(s.price, s.currency)}
                  <button class="btn tinted" onClick={() => setConvert(s)}>
                    转为合租
                  </button>
                </span>
              </div>
            ))}
          </Group>
        )}
        {convert && <ConvertSheet s={convert} today={today} onClose={() => setConvert(null)} />}
        {member && <MemberSheet state={state} s={state.subscriptions.find((x) => x.id === member.s.id) ?? member.s} member={member.m} collect={member.collect} onClose={() => setMember(null)} />}
      </div>
    </>
  );
}

/** 常见家庭方案的席位数（含自己） */
function defaultSeats(name: string): number {
  if (/1password/i.test(name)) return 5;
  if (/spotify|youtube|apple one|icloud|netflix/i.test(name)) return 6;
  return 6;
}

/** 一步转为合租：选身份与席位，保存后在上面补成员 */
function ConvertSheet({ s, today, onClose }: { s: Subscription; today: string; onClose: () => void }) {
  const [role, setRole] = useState<'owner' | 'member'>('owner');
  const [seats, setSeats] = useState(defaultSeats(s.name));
  const [ownerName, setOwnerName] = useState('');
  const perHead = seats > 0 ? s.price / seats : s.price;
  return (
    <Sheet
      narrow
      title={`「${s.name}」转为合租`}
      onClose={onClose}
      foot={
        <>
          <span class="grow" />
          <button class="btn" onClick={onClose}>
            取消
          </button>
          <button
            class="btn primary"
            onClick={() =>
              run(async () => {
                await saveSub({ ...s, share: role === 'owner' ? { role, seats, members: [], since: today } : { role, seats, members: [], ownerName: ownerName.trim() || undefined, since: today } });
                onClose();
              }, role === 'owner' ? '已转为合租，接着添加成员吧' : '已记为加入合租')
            }
          >
            转为合租
          </button>
        </>
      }
    >
      <div class="stack">
        <Seg
          value={role}
          onChange={setRole}
          options={[
            ['owner', '我发起'],
            ['member', '我加入'],
          ]}
        />
        <Group foot={role === 'owner' ? `按 ${seats} 人均摊，每人每期约 ${money(perHead, s.currency)}；加了成员后，我的份额自动扣掉成员那份。` : '加入后，订阅金额记你每期付给发起人的那一份。'}>
          <Cell label="总席位（含自己）">
            <input class="num" inputMode="numeric" value={seats} onInput={(e) => setSeats(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))} />
          </Cell>
          {role === 'member' && (
            <Cell label="发起人">
              <input value={ownerName} placeholder="付给谁" onInput={(e) => setOwnerName((e.target as HTMLInputElement).value)} />
            </Cell>
          )}
        </Group>
      </div>
    </Sheet>
  );
}

/**
 * 合租账本，像一张小利润表：订阅一年花多少（成本）、成员一年交多少（收入）、两者之差（利润）。
 * 利润为负就是我自己用的那部分；下面一行是发起以来实际付出和收回的钱。
 */
function CarFacts({ book, base }: { book: ReturnType<typeof carLedger>; base: string }) {
  const fmt = (v: number) => money(v, base, { compact: true });
  const profit = -book.yearNet;
  const actual = -book.net;
  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v))}`;
  return (
    <div class="car-book">
      <div class="proxy-facts">
        <div>
          <small>成本 / 年</small>
          <b>{fmt(book.yearCost)}</b>
        </div>
        <div>
          <small>收入 / 年</small>
          <b>{fmt(book.yearIncome)}</b>
        </div>
        <div>
          <small>{profit < 0 ? '没赚钱 / 年' : '利润 / 年'}</small>
          <b class={profit >= 0 ? 'gain' : 'loss'}>{signed(profit)}</b>
        </div>
      </div>
      {/* 实际收支这一行始终占位，卡片高度才一致 */}
      <div class="car-actual">
        {book.since ? (
          <>
            <span>{book.since.slice(0, 4)}年{Number(book.since.slice(5, 7))}月发起至今</span>
            <span>
              付出 {fmt(book.paid)} · 收回 {fmt(book.received)} · <b class={actual >= 0 ? 'gain' : 'loss'}>{actual >= 0 ? `赚 ${fmt(actual)}` : `亏 ${fmt(-actual)}`}</b>
            </span>
          </>
        ) : (
          <>
            <span>发起至今</span>
            <span>还没有收款记录</span>
          </>
        )}
      </div>
    </div>
  );
}
