import { cycleLabel, effectiveStatus, memberDues, nextCharge } from '../../shared/billing.ts';
import { useState } from 'react';
import { billLabel, cnDate, cnDateAuto, money, monthLabel } from '../../shared/format.ts';
import { t } from '../../shared/i18n.ts';
import { tx } from '../i18n.ts';
import { toBaseAt } from '../../shared/fx.ts';
import type { AppState, ShareMember, Subscription } from '../../shared/types.ts';
import { carLedger, contactText, MemberSheet, memberFee, perBill } from './Members.tsx';
import { Amount, Cell, Group, Icon, Seg, Sheet, SubIcon, Toolbar } from '../components/ui.tsx';
import { toBase } from '../derive.ts';
import { run, saveSub } from '../store.ts';
import { FamilyTabs } from './People.tsx';

export function Carpool({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
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
  const candidates = state.subscriptions.filter((s) => !s.share && !s.proxy && live(s) && s.tags.some((tag) => /合租|拼车|家庭|family|shared/i.test(tag)));

  return (
    <>
      <Toolbar title={t('family.pool.title')}>{!ro && <FamilyTabs tab="plans" />}</Toolbar>
      <div className="page fade-in stack">
        <div className="grid g-3">
          <div className="card stat">
            <div className="stat-label">{yearNet < 0 ? t('family.pool.netGain') : t('family.pool.netCost')}</div>
            <div className="stat-value" style={{ color: yearNet < 0 ? 'var(--green)' : undefined }}>
              <Amount value={Math.abs(yearNet)} ccy={base} />
            </div>
            <div className="stat-sub">{t('family.pool.yearIncome', { amount: money(yearIncome, base, { compact: true }) })}</div>
          </div>
          <div className="card stat">
            <div className="stat-label">{t('family.pool.owed')}</div>
            <div className="stat-value" style={{ color: owedSum > 0 ? 'var(--orange)' : undefined }}>
              <Amount value={owedSum} ccy={base} />
            </div>
            <div className="stat-sub">{t('family.pool.owedSub', { count: owedAll.length })}</div>
          </div>
          <div className="card stat">
            <div className="stat-label">{t('family.pool.count')}</div>
            <div className="stat-value">
              <span className="amt">
                {owned.length}
                <small>{t('family.pool.countStarted')}</small>
                {joined.length}
                <small>{t('family.pool.countJoined')}</small>
              </span>
            </div>
            <div className="stat-sub">{t('family.pool.countSub')}</div>
          </div>
        </div>

        {owned.length === 0 && (
          <div className="card empty">
            <b>{t('family.pool.emptyTitle')}</b>
            {t('family.pool.emptyBody')}
          </div>
        )}
        {/* 两列各自独立：展开一张卡只撑高它所在的那一列，不影响同一行的另一张 */}
        <div className="car-cols">
          {[0, 1].map((col) => (
            <div className="car-col" key={col}>
              {owned.map((s, idx) => {
                if (idx % 2 !== col) return null;
                const sh = s.share!;
                const dues = memberDues(s, today);
                // 已退出的成员不占座，只在展开的明细里保留
                const onboard = sh.members.filter((m) => !m.left || m.left > today);
                const next = nextCharge(s, today);
                return (
                  <div key={s.id} className="card stack" style={{ gap: 14, order: idx }}>
                    <button className="row" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => onOpen(s)}>
                      <SubIcon sub={s} size={46} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{s.name}</div>
                        <div className="muted" style={{ fontSize: 13 }}>
                          {money(s.price, s.currency)} {cycleLabel(s.cycle)}
                          {next ? ` · ${t('family.pool.next', { date: cnDate(next) })}` : ''}
                        </div>
                      </div>
                    </button>
                    <div className="seats-row">
                      <div className="seats">
                        <span className="seat me" title={t('family.pool.me')}>
                          <img src="/icons/avatar.png" alt={t('family.pool.me')} />
                        </span>
                        {onboard.map((m) => {
                          const owe = dues.find((d) => d.member.id === m.id)?.periodsOwed;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              disabled={ro}
                              onClick={() => setMember({ s, m })}
                              className={`seat ${m.exempt ? 'free' : owe ? 'owe' : 'on'}`}
                              title={m.exempt ? t('family.pool.exemptTitle', { name: m.name }) : m.name}
                            >
                              {[...(m.name || '?')][0]}
                            </button>
                          );
                        })}
                        {Array.from({ length: Math.max(0, sh.seats - 1 - onboard.length) }, (_, i) => (
                          <button
                            key={i}
                            type="button"
                            className="seat add"
                            disabled={ro}
                            onClick={() => setMember({ s })}
                            aria-label={t('family.pool.addMember')}
                            title={t('family.pool.addMember')}
                          >
                            +
                          </button>
                        ))}
                      </div>
                      {s.manageUrl && (
                        <a className="car-toggle" href={s.manageUrl} target="_blank" rel="noreferrer" title={t('family.pool.manageTitle')}>
                          <Icon name="gear" size={14} /> {t('family.pool.manage')}
                        </a>
                      )}
                      <button className={`car-toggle ${expanded.has(s.id) ? 'open' : ''}`} onClick={() => toggle(s.id)} aria-expanded={expanded.has(s.id)}>
                        {(() => {
                          const n = dues.filter((d) => d.periodsOwed > 0).length;
                          return n ? (
                            <span className="owe">{t('family.pool.owedN', { count: n })}</span>
                          ) : sh.members.length ? (
                            t('family.pool.settled')
                          ) : (
                            t('family.pool.noMembers')
                          );
                        })()}
                        <Icon name="down" size={14} />
                      </button>
                    </div>
                    <CarFacts book={books.get(s.id)!} base={base} />
                    {expanded.has(s.id) && (
                      <>
                        {!ro && onboard.length < sh.seats - 1 && (
                          <button className="btn tinted" style={{ alignSelf: 'flex-start' }} onClick={() => setMember({ s })}>
                            <Icon name="plus" /> {t('family.pool.addMemberSeats', { count: sh.seats - 1 - onboard.length })}
                          </button>
                        )}
                        <div>
                          {dues.map((d) => (
                            <div key={d.member.id} className="member">
                              <button className="member-info" disabled={ro} onClick={() => setMember({ s, m: d.member })}>
                                <div style={{ fontWeight: 600, fontSize: 14 }}>
                                  {d.member.name || t('family.pool.unnamed')}
                                  {d.member.left && d.member.left <= today && (
                                    <span className="badge" style={{ marginLeft: 6 }}>
                                      {t('family.pool.leftOn', { date: cnDate(d.member.left) })}
                                    </span>
                                  )}
                                  {contactText(d.member) && (
                                    <span className="muted" style={{ fontWeight: 400 }}>
                                      {' '}
                                      · {contactText(d.member)}
                                    </span>
                                  )}
                                </div>
                                <div className="muted" style={{ fontSize: 12 }}>
                                  {d.member.exempt
                                    ? (d.member.note ?? t('family.pool.exemptNote'))
                                    : `${billLabel(d.member.billEvery)} · ${d.member.paidUntil ? t('family.pool.paidUntil', { date: cnDateAuto(d.member.paidUntil, today) }) : t('family.pool.noPay')}`}
                                  {d.member.payments?.length ? ` · ${t('family.pool.paymentsN', { count: d.member.payments.length })}` : ''}
                                  {d.member.source ? ` · ${t('family.pool.from', { source: d.member.source })}` : ''}
                                </div>
                              </button>
                              <div style={{ textAlign: 'right', fontSize: 13.5 }}>
                                {d.member.exempt ? (
                                  <span className="muted" style={{ fontWeight: 600 }}>
                                    {t('family.pool.exempt')}
                                  </span>
                                ) : d.periodsOwed > 0 ? (
                                  <b style={{ color: 'var(--orange)' }}>
                                    {t('family.pool.owedAmount', { amount: money(toBaseAt(state, d.owed, s.currency, undefined, collect), collect) })}
                                  </b>
                                ) : (
                                  <span style={{ color: 'var(--green)', fontWeight: 600 }}>{t('family.pool.settled')}</span>
                                )}
                                {!d.member.exempt && (
                                  <div className="muted" style={{ fontSize: 12 }}>
                                    {perBill('family.pool.perFee', d.member.billEvery ?? 1, {
                                      fee: money(memberFee(state, s, d.member).amount, memberFee(state, s, d.member).currency),
                                    })}
                                  </div>
                                )}
                              </div>
                              {!ro && !d.member.exempt && (
                                <button className={`btn ${d.periodsOwed > 0 ? 'primary' : ''}`} onClick={() => setMember({ s, m: d.member, collect: true })}>
                                  <Icon name="check" /> {t('family.pool.collect')}
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
          <Group title={t('family.pool.joinedGroup')}>
            {joined.map((s) => (
              <Cell
                key={s.id}
                label={
                  <span className="row">
                    <SubIcon sub={s} size={30} />
                    {s.name}
                  </span>
                }
                sub={undefined}
                onClick={() => onOpen(s)}
              >
                {t('family.pool.payTo', { name: s.share?.ownerName ?? t('family.pool.ownerDefault'), amount: money(s.price, s.currency) })}
              </Cell>
            ))}
          </Group>
        )}

        {candidates.length > 0 && !ro && (
          <Group title={t('family.pool.maybeGroup')}>
            {candidates.map((s) => (
              <div key={s.id} className="cell">
                <span className="cell-l">
                  <span className="row">
                    <SubIcon sub={s} size={30} />
                    {s.name}
                  </span>
                </span>
                <span className="cell-r">
                  {money(s.price, s.currency)}
                  <button className="btn tinted" onClick={() => setConvert(s)}>
                    {t('family.pool.convert')}
                  </button>
                </span>
              </div>
            ))}
          </Group>
        )}
        {convert && <ConvertSheet s={convert} today={today} onClose={() => setConvert(null)} />}
        {member && (
          <MemberSheet
            state={state}
            s={state.subscriptions.find((x) => x.id === member.s.id) ?? member.s}
            member={member.m}
            collect={member.collect}
            onClose={() => setMember(null)}
          />
        )}
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
      title={t('family.convert.title', { name: s.name })}
      onClose={onClose}
      foot={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('family.convert.cancel')}
          </button>
          <button
            className="btn primary"
            onClick={() =>
              run(
                async () => {
                  await saveSub({
                    ...s,
                    share:
                      role === 'owner'
                        ? { role, seats, members: [], since: today }
                        : { role, seats, members: [], ownerName: ownerName.trim() || undefined, since: today },
                  });
                  onClose();
                },
                role === 'owner' ? t('family.convert.toastOwner') : t('family.convert.toastMember'),
              )
            }
          >
            {t('family.convert.submit')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Seg
          value={role}
          onChange={setRole}
          options={[
            ['owner', t('family.convert.roleOwner')],
            ['member', t('family.convert.roleMember')],
          ]}
        />
        <Group foot={role === 'owner' ? t('family.convert.footOwner', { count: seats, amount: money(perHead, s.currency) }) : t('family.convert.footMember')}>
          <Cell label={t('family.convert.seats')}>
            <input
              className="num"
              inputMode="numeric"
              value={seats}
              onChange={(e) => setSeats(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))}
            />
          </Cell>
          {role === 'member' && (
            <Cell label={t('family.convert.owner')}>
              <input value={ownerName} placeholder={t('family.convert.ownerPh')} onChange={(e) => setOwnerName((e.target as HTMLInputElement).value)} />
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
    <div className="car-book">
      <div className="proxy-facts">
        <div>
          <small>{t('family.facts.cost')}</small>
          <b>{fmt(book.yearCost)}</b>
        </div>
        <div>
          <small>{t('family.facts.income')}</small>
          <b>{fmt(book.yearIncome)}</b>
        </div>
        <div>
          <small>{profit < 0 ? t('family.facts.loss') : t('family.facts.profit')}</small>
          <b className={profit >= 0 ? 'gain' : 'loss'}>{signed(profit)}</b>
        </div>
      </div>
      {/* 实际收支这一行始终占位，卡片高度才一致 */}
      <div className="car-actual">
        {book.since ? (
          <>
            <span>{t('family.facts.since', { month: monthLabel(book.since.slice(0, 7)) })}</span>
            <span>
              {tx('family.facts.actual', {
                paid: fmt(book.paid),
                received: fmt(book.received),
                result: (
                  <b className={actual >= 0 ? 'gain' : 'loss'}>
                    {actual >= 0 ? t('family.facts.gain', { amount: fmt(actual) }) : t('family.facts.lost', { amount: fmt(-actual) })}
                  </b>
                ),
              })}
            </span>
          </>
        ) : (
          <>
            <span>{t('family.facts.sinceNone')}</span>
            <span>{t('family.facts.noRecords')}</span>
          </>
        )}
      </div>
    </div>
  );
}
