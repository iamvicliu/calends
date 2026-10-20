import {
  addDays,
  addMonths,
  chargesBetween,
  convert,
  cycleDays,
  diffDays,
  effectiveStatus,
  nextCharge,
  priceAt,
  runwayFor,
  todayIn,
  totals,
} from '../shared/billing.ts';
import { toBaseAt } from '../shared/fx.ts';
import { billLabel, cnDate, esc, money, monthLabel, relDays } from '../shared/format.ts';
import { t } from '../shared/i18n.ts';
import { channelsOf, type AppState } from '../shared/types.ts';
import type { Env } from './env.ts';
import { matchEntries } from '../shared/proxy.ts';
import { sendTo } from './channels.ts';

export interface Row {
  title: string;
  sub?: string;
  amount?: string;
  amountSub?: string;
  tone?: 'warn' | 'ok' | 'muted';
}

export interface Section {
  heading: string;
  rows: Row[];
}

export interface Digest {
  key: string;
  kind: 'daily' | 'monthly' | 'test';
  subject: string;
  /** 邮件大标题；不填时用 subject */
  title?: string;
  intro: string;
  sections: Section[];
}

/** 计算 today 应发出的提醒；不产生副作用，供 cron、预览与测试共用 */
export function buildDaily(state: AppState, today: string): Digest | undefined {
  const { settings, fx } = state;
  const base = settings.baseCurrency;
  const renew: Row[] = [];
  const trials: Row[] = [];
  const ending: Row[] = [];
  const carpool: Row[] = [];
  const proxy: Row[] = [];
  const balance: Row[] = [];
  const headline: string[] = [];

  for (const s of state.subscriptions) {
    const st = effectiveStatus(s, today);
    const remind = s.remindDays ?? settings.remindDays;
    if (remind < 0) continue;
    if (st === 'trial' && s.trialEnd) {
      const d = diffDays(today, s.trialEnd);
      if (d === remind || d === 1 || d === 0) {
        trials.push({
          title: s.name,
          sub: t('notify.trial.sub', { when: relDays(d), date: cnDate(s.trialEnd), price: money(s.price, s.currency) }),
          amount: money(s.price, s.currency),
          tone: 'warn',
        });
        headline.push(t('notify.trial.headline', { name: s.name, when: relDays(d) }));
      }
    }
    if (st === 'active' || st === 'ending') {
      const n = nextCharge(s, today);
      if (n) {
        const d = diffDays(today, n);
        if (d === remind || (remind > 1 && d === 1)) {
          const method = state.methods.find((m) => m.id === s.methodId);
          const price = priceAt(s, n);
          const conv = s.currency !== base ? `≈ ${money(convert(price, s.currency, base, fx), base)}` : undefined;
          const introEnds = !(s.intro && s.intro.until > n) && !!s.intro && diffDays(s.intro.until, n) < 40;
          renew.push({
            title: s.name,
            sub: [relDays(d), cnDate(n, true), method?.name, introEnds ? t('notify.renew.introEnds') : ''].filter(Boolean).join(' · '),
            amount: money(price, s.currency),
            amountSub: conv,
          });
          headline.push(t('notify.renew.headline', { name: s.name, when: relDays(d), price: money(price, s.currency) }));
        }
      }
    }
    if (s.end && st === 'ending') {
      const d = diffDays(today, s.end);
      if (d === 7 || d === 1) {
        ending.push({ title: s.name, sub: t('notify.ending.sub', { when: relDays(d) }), amount: cnDate(s.end), tone: 'muted' });
        headline.push(t('notify.ending.headline', { name: s.name, when: relDays(d) }));
      }
    }
  }

  // 合租：成员的「已付至」快到或已过，提醒去收下一期；到期前 7 天、3 天、当天，逾期后再提醒几次
  const collect = settings.collectCurrency ?? base;
  for (const s of state.subscriptions) {
    if (s.share?.role !== 'owner' || !['active', 'ending'].includes(effectiveStatus(s, today))) continue;
    const months = cycleDays(s.cycle) / 30.4375;
    for (const m of s.share.members) {
      if (m.exempt) continue;
      const due = m.paidUntil ? addDays(m.paidUntil, 1) : s.share.since;
      if (!due) continue;
      const d = diffDays(today, due);
      // 逾期后第 7、14 天提醒，之后每 30 天提醒一次，避免天天打扰
      if (!(d === 7 || d === 3 || d === 0 || d === -7 || d === -14 || (d < 0 && -d % 30 === 0))) continue;
      const every = m.billEvery ?? 1;
      const fee =
        m.fee != null
          ? money(m.fee, m.feeCurrency ?? collect)
          : money(toBaseAt(state, ((m.share || 0) * every) / months, s.currency, undefined, collect), collect);
      const who = (m.contactVia && m.contact ? `${m.contactVia} ${m.contact}` : (m.contact ?? m.tg)) ?? '';
      carpool.push({
        title: `${m.name} · ${s.name}`,
        sub: `${t('notify.carpool.sub', { status: d > 0 ? t('notify.carpool.dueIn', { when: relDays(d), date: cnDate(due) }) : d === 0 ? t('notify.carpool.dueToday') : t('notify.carpool.overdue', { count: -d }), bill: billLabel(every) })}${who ? ` · ${who}` : ''}`,
        amount: fee,
        tone: d < 0 ? 'warn' : undefined,
      });
      if (d <= 0) headline.push(t('notify.carpool.headline', { member: m.name, name: s.name }));
    }
  }

  // 代付：替人扣款当天提醒去收；扣了还没收回的，第 3、7、14、30 天各提醒一次
  for (const s of state.subscriptions) {
    if (!s.proxy) continue;
    const name = s.proxy.forName || t('notify.proxy.someone');
    const contact = s.proxy.contact ? ` · ${s.proxy.contactVia ? `${s.proxy.contactVia} ` : ''}${s.proxy.contact}` : '';
    // 与代付页同样的对账规则（扣款日前后 15 天内的收款也算），改过开始日期也不会重复提醒
    const charges = chargesBetween(s, s.start, today, today);
    const matched = matchEntries(
      s.proxy.entries,
      charges.map((c) => c.date),
    );
    for (const c of charges.filter((x) => x.date >= addDays(today, -45))) {
      const entry = matched.get(c.date);
      if (entry?.received != null) continue;
      const d = diffDays(c.date, today);
      if (![0, 3, 7, 14, 30].includes(d)) continue;
      const charged = entry?.charged ?? c.amount;
      const ccy = entry?.chargedCurrency ?? c.currency;
      proxy.push({
        title: `${name} · ${s.name}`,
        sub: `${t('notify.proxy.sub', { status: d === 0 ? t('notify.proxy.chargedToday') : t('notify.proxy.chargedAgo', { date: cnDate(c.date), count: d }) })}${contact}`,
        amount: money(charged, ccy),
        amountSub: `≈ ${money(toBaseAt(state, charged, ccy, c.date, collect), collect)}`,
        tone: d > 0 ? 'warn' : undefined,
      });
      headline.push(t(d === 0 ? 'notify.proxy.headlineToday' : 'notify.proxy.headlineUnpaid', { name, sub: s.name }));
    }
  }

  for (const m of state.methods) {
    const r = runwayFor(m, state, today);
    if (!r?.shortfall) continue;
    const d = diffDays(today, r.shortfall.date);
    const lead = m.lowRunwayDays ?? 30;
    if (d === lead || d === 14 || d === 7 || d === 3 || d === 1 || d === 0) {
      balance.push({
        title: m.name,
        sub: t('notify.balance.sub', {
          balance: money(r.current, m.currency),
          date: cnDate(r.shortfall.date),
          sub: r.shortfall.sub.name,
          amount: money(r.shortfall.amount, r.shortfall.currency),
        }),
        amount: relDays(d),
        tone: 'warn',
      });
      headline.push(t('notify.balance.headline', { name: m.name }));
    }
  }

  const sections: Section[] = [
    { heading: t('notify.section.renew'), rows: renew },
    { heading: t('notify.section.trials'), rows: trials },
    { heading: t('notify.section.balance'), rows: balance },
    { heading: t('notify.section.carpool'), rows: carpool },
    { heading: t('notify.section.proxy'), rows: proxy },
    { heading: t('notify.section.ending'), rows: ending },
  ].filter((x) => x.rows.length);
  if (!sections.length) return undefined;
  const title =
    headline.length === 1
      ? t('notify.daily.title', { headline: headline[0] })
      : t('notify.daily.titleMore', { headline: headline[0], count: headline.length, more: headline.length - 1 });
  const tot = totals(state, today);
  return {
    key: `daily:${today}`,
    kind: 'daily',
    subject: t('notify.daily.subject', { title }),
    title,
    intro: t('notify.daily.intro', { mrr: money(-tot.mrr, base, { compact: true }), count: tot.activeCount }),
    sections,
  };
}

export function buildMonthly(state: AppState, today: string): Digest | undefined {
  if (!state.settings.monthlyDigest || !today.endsWith('-01')) return undefined;
  const base = state.settings.baseCurrency;
  const end = addMonths(today, 1);
  // 月度账单只列我自己的订阅；代付在「代付待收」里单独提醒
  const charges = state.subscriptions
    .filter((s) => !s.proxy)
    .flatMap((s) => chargesBetween(s, today, end, today).filter((c) => c.date < end))
    .sort((a, b) => a.date.localeCompare(b.date));
  const sum = charges.reduce((acc, c) => acc + (convert(c.amount, c.currency, base, state.fx) || 0), 0);
  const tot = totals(state, today);
  const [y, m] = today.split('-').map(Number);
  const ym = today.slice(0, 7);
  const p = {
    y,
    m,
    month: monthLabel(ym, { year: false, long: true }),
    monthYear: monthLabel(ym, { long: true }),
    count: charges.length,
    sum: money(sum, base, { compact: true }),
    mrr: money(-tot.mrr, base, { compact: true }),
    arr: money(-tot.mrr * 12, base, { compact: true }),
  };
  return {
    key: `monthly:${today.slice(0, 7)}`,
    kind: 'monthly',
    subject: t('notify.monthly.subject', p),
    intro: t('notify.monthly.intro', p),
    sections: [
      {
        heading: t('notify.section.month'),
        rows: charges.map((c) => ({
          title: c.sub.name,
          sub: cnDate(c.date, true),
          amount: money(c.amount, c.currency),
          amountSub: c.currency !== base ? `≈ ${money(convert(c.amount, c.currency, base, state.fx), base)}` : undefined,
        })),
      },
    ],
  };
}

export function renderEmail(d: Digest, siteUrl: string): { html: string; text: string } {
  const text = [
    d.intro,
    '',
    ...d.sections.flatMap((s) => [
      t('notify.text.heading', { heading: s.heading }),
      ...s.rows.map((r) => `· ${r.title}  ${r.amount ?? ''}  ${r.sub ?? ''}`),
      '',
    ]),
    `${siteUrl}/admin`,
  ].join('\n');
  const toneColor = { warn: '#c2593b', ok: '#3c8a52', muted: '#7b858b' } as const;
  const rows = (s: Section) =>
    s.rows
      .map(
        (r) => `<tr>
<td style="padding:12px 0;border-bottom:1px solid #e3e9ed;vertical-align:top">
<div style="font:600 15px/1.4 -apple-system,'PingFang SC',sans-serif;color:#1d2328">${esc(r.title)}</div>
${r.sub ? `<div style="font:13px/1.5 -apple-system,'PingFang SC',sans-serif;color:#718087;margin-top:2px">${esc(r.sub)}</div>` : ''}
</td>
<td style="padding:12px 0 12px 16px;border-bottom:1px solid #e3e9ed;text-align:right;vertical-align:top;white-space:nowrap">
<div style="font:600 15px/1.4 'SF Mono',Menlo,monospace;color:${r.tone ? toneColor[r.tone] : '#1d2328'}">${esc(r.amount ?? '')}</div>
${r.amountSub ? `<div style="font:12px/1.5 'SF Mono',Menlo,monospace;color:#93a0a6">${esc(r.amountSub)}</div>` : ''}
</td></tr>`,
      )
      .join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6f8;padding:32px 12px">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fbfcfd;border:1px solid #e3e9ed;border-radius:16px" cellpadding="0" cellspacing="0"><tr><td style="padding:28px 28px 8px">
<div style="font:500 11px/1 'SF Mono',Menlo,monospace;letter-spacing:.14em;color:#7b858b;text-transform:uppercase">■ ${esc(t('notify.appName'))}</div>
<h1 style="font:600 26px/1.25 Georgia,'Songti SC',serif;color:#1d2328;margin:14px 0 8px">${esc(d.title ?? d.subject)}</h1>
<p style="font:14px/1.7 -apple-system,'PingFang SC',sans-serif;color:#4c5a61;margin:0 0 8px">${esc(d.intro)}</p>
</td></tr>
${d.sections
  .map(
    (s) => `<tr><td style="padding:16px 28px 0">
<div style="font:500 11px/1 'SF Mono',Menlo,monospace;letter-spacing:.12em;color:#4b79c5;margin-bottom:4px">${esc(s.heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows(s)}</table></td></tr>`,
  )
  .join('')}
<tr><td style="padding:24px 28px 28px">
<a href="${esc(siteUrl)}/admin" style="display:inline-block;background:#1d2328;color:#fff;text-decoration:none;font:600 14px/1 -apple-system,'PingFang SC',sans-serif;padding:12px 18px;border-radius:999px">${esc(t('notify.email.open'))}</a>
<p style="font:12px/1.6 -apple-system,'PingFang SC',sans-serif;color:#93a0a6;margin:16px 0 0">${esc(t('notify.email.footer'))}</p>
</td></tr></table></body></html>`;
  return { html, text };
}

/**
 * 把一份提醒发到所有开着的渠道（或只发 only 指定的那一个）。
 * 任一渠道成功就算发出；全部失败则撤掉占位，下一小时重试。
 */
export async function sendDigest(
  env: Env,
  state: AppState,
  d: Digest,
  opts: { force?: boolean; only?: string } = {},
): Promise<{ sent: boolean; reason?: string; results?: Array<{ channel: string; ok: boolean; error?: string }> }> {
  const targets = channelsOf(state.settings).filter((c) => (opts.only ? c.id === opts.only : c.enabled));
  if (!targets.length) return { sent: false, reason: opts.only ? t('notify.send.noChannel') : t('notify.send.noneEnabled') };
  if (!opts.force) {
    // 先占位后发送：重叠触发时只有一个能占到
    const claim = await env.DB.prepare(
      "INSERT INTO notify_log (dedupe_key, kind, subject, status) VALUES (?1, ?2, ?3, 'sending') ON CONFLICT(dedupe_key) DO NOTHING",
    )
      .bind(d.key, d.kind, d.subject)
      .run();
    if (!claim.meta.changes) return { sent: false, reason: t('notify.send.alreadySent') };
  }
  const results = await Promise.all(
    targets.map(async (c) => {
      try {
        await sendTo(env, c, d);
        return { channel: c.name, ok: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        console.error('[notify]', c.kind, error);
        return { channel: c.name, ok: false, error };
      }
    }),
  );
  const okCount = results.filter((r) => r.ok).length;
  const status = okCount === results.length ? 'sent' : okCount ? `partial ${okCount}/${results.length}` : 'failed';
  if (!okCount) {
    if (!opts.force) await env.DB.prepare('DELETE FROM notify_log WHERE dedupe_key = ?1').bind(d.key).run();
    return {
      sent: false,
      reason: results.map((r) => t('notify.send.failure', { channel: r.channel, error: r.error })).join(t('notify.send.failureSep')),
      results,
    };
  }
  await env.DB.prepare(
    "INSERT INTO notify_log (dedupe_key, kind, subject, status) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(dedupe_key) DO UPDATE SET status = excluded.status, sent_at = datetime('now')",
  )
    .bind(opts.force ? `${d.key}:${Date.now()}` : d.key, d.kind, d.subject, status)
    .run();
  return { sent: true, results };
}

function localHour(tz: string): number {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  } catch {
    return new Date().getUTCHours();
  }
}

export async function runScheduled(env: Env, state: AppState): Promise<string[]> {
  const log: string[] = [];
  const today = todayIn(state.settings.timezone);
  if (localHour(state.settings.timezone) !== state.settings.notifyHour) return log;
  for (const d of [buildMonthly(state, today), buildDaily(state, today)]) {
    if (!d) continue;
    const r = await sendDigest(env, state, d);
    log.push(`${d.key}: ${r.sent ? 'sent' : r.reason}`);
  }
  return log;
}
