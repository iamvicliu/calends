import { addMonths, chargesBetween, convert, diffDays, effectiveStatus, memberDues, nextCharge, priceAt, runwayFor, todayIn, totals } from '../shared/billing.ts';
import { cnDate, esc, money, relDays } from '../shared/format.ts';
import type { AppState } from '../shared/types.ts';
import type { Env } from './env.ts';

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
  const balance: Row[] = [];
  const headline: string[] = [];

  for (const s of state.subscriptions) {
    const st = effectiveStatus(s, today);
    const remind = s.remindDays ?? settings.remindDays;
    if (remind < 0) continue;
    if (st === 'trial' && s.trialEnd) {
      const d = diffDays(today, s.trialEnd);
      if (d === remind || d === 1 || d === 0) {
        trials.push({ title: s.name, sub: `试用 ${relDays(d)}结束（${cnDate(s.trialEnd)}），之后按 ${money(s.price, s.currency)} 扣费`, amount: money(s.price, s.currency), tone: 'warn' });
        headline.push(`${s.name} 试用${relDays(d)}结束`);
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
          const introEnds = s.intro && s.intro.until > n ? '' : s.intro && diffDays(s.intro.until, n) < 40 ? ' · 优惠结束，恢复原价' : '';
          renew.push({ title: s.name, sub: `${relDays(d)} · ${cnDate(n, true)}${method ? ` · ${method.name}` : ''}${introEnds}`, amount: money(price, s.currency), amountSub: conv });
          headline.push(`${s.name} ${relDays(d)}扣款 ${money(price, s.currency)}`);
          for (const due of memberDues(s, today)) {
            if (due.periodsOwed > 0) carpool.push({ title: `${due.member.name} · ${s.name}`, sub: `应付 ${due.periodsOwed} 期${due.member.contact ? ` · ${due.member.contact}` : ''}`, amount: money(due.owed, s.currency), tone: 'warn' });
          }
        }
      }
    }
    if (s.end && st === 'ending') {
      const d = diffDays(today, s.end);
      if (d === 7 || d === 1) {
        ending.push({ title: s.name, sub: `${relDays(d)}到期，不会自动续费`, amount: cnDate(s.end), tone: 'muted' });
        headline.push(`${s.name} ${relDays(d)}到期`);
      }
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
        sub: `余额 ${money(r.current, m.currency)}，不足以支付 ${cnDate(r.shortfall.date)} 的 ${r.shortfall.sub.name}（${money(r.shortfall.amount, r.shortfall.currency)}）`,
        amount: relDays(d),
        tone: 'warn',
      });
      headline.push(`${m.name} 余额将不足`);
    }
  }

  const sections: Section[] = [
    { heading: '即将扣款', rows: renew },
    { heading: '试用到期', rows: trials },
    { heading: '余额预警', rows: balance },
    { heading: '拼车待收', rows: carpool },
    { heading: '即将到期', rows: ending },
  ].filter((x) => x.rows.length);
  if (!sections.length) return undefined;
  const subject = headline.length === 1 ? `订阅提醒｜${headline[0]}` : `订阅提醒｜${headline[0]} 等 ${headline.length} 项`;
  const t = totals(state, today);
  return {
    key: `daily:${today}`,
    kind: 'daily',
    subject,
    intro: `当前每月订阅支出 ${money(-t.mrr, base, { compact: true })}，${t.activeCount} 项正在计费。`,
    sections,
  };
}

export function buildMonthly(state: AppState, today: string): Digest | undefined {
  if (!state.settings.monthlyDigest || !today.endsWith('-01')) return undefined;
  const base = state.settings.baseCurrency;
  const end = addMonths(today, 1);
  const charges = state.subscriptions
    .flatMap((s) => chargesBetween(s, today, end, today).filter((c) => c.date < end))
    .sort((a, b) => a.date.localeCompare(b.date));
  const sum = charges.reduce((t, c) => t + (convert(c.amount, c.currency, base, state.fx) || 0), 0);
  const t = totals(state, today);
  const [y, m] = today.split('-').map(Number);
  return {
    key: `monthly:${today.slice(0, 7)}`,
    kind: 'monthly',
    subject: `${m} 月订阅账单｜预计 ${money(sum, base, { compact: true })}，共 ${charges.length} 笔`,
    intro: `${y} 年 ${m} 月预计扣款 ${charges.length} 笔，合计约 ${money(sum, base, { compact: true })}。负 MRR ${money(-t.mrr, base, { compact: true })}，年化 ${money(-t.mrr * 12, base, { compact: true })}。`,
    sections: [
      {
        heading: '本月扣款',
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
  const text = [d.intro, '', ...d.sections.flatMap((s) => [`【${s.heading}】`, ...s.rows.map((r) => `· ${r.title}  ${r.amount ?? ''}  ${r.sub ?? ''}`), '']), `${siteUrl}/admin`].join('\n');
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
<div style="font:500 11px/1 'SF Mono',Menlo,monospace;letter-spacing:.14em;color:#7b858b;text-transform:uppercase">■ Subscription Ledger</div>
<h1 style="font:600 26px/1.25 Georgia,'Songti SC',serif;color:#1d2328;margin:14px 0 8px">${esc(d.subject.replace(/^订阅提醒｜/, ''))}</h1>
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
<a href="${esc(siteUrl)}/admin" style="display:inline-block;background:#1d2328;color:#fff;text-decoration:none;font:600 14px/1 -apple-system,'PingFang SC',sans-serif;padding:12px 18px;border-radius:999px">打开订阅账本</a>
<p style="font:12px/1.6 -apple-system,'PingFang SC',sans-serif;color:#93a0a6;margin:16px 0 0">提醒时间与提前天数可在「设置」中调整。</p>
</td></tr></table></body></html>`;
  return { html, text };
}

export async function sendDigest(env: Env, state: AppState, d: Digest, opts: { force?: boolean } = {}): Promise<{ sent: boolean; reason?: string }> {
  const to = state.settings.notifyEmail;
  if (!to) return { sent: false, reason: '未设置通知邮箱' };
  if (!opts.force) {
    // 先占位后发信：重叠触发时只有一个能占到
    const claim = await env.DB.prepare("INSERT INTO notify_log (dedupe_key, kind, subject, status) VALUES (?1, ?2, ?3, 'sending') ON CONFLICT(dedupe_key) DO NOTHING")
      .bind(d.key, d.kind, d.subject)
      .run();
    if (!claim.meta.changes) return { sent: false, reason: '今日已发送' };
  }
  const { html, text } = renderEmail(d, env.SITE_URL);
  try {
    await env.EMAIL.send({ from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME }, to, subject: d.subject, text, html });
    await env.DB.prepare(
      "INSERT INTO notify_log (dedupe_key, kind, subject, status) VALUES (?1, ?2, ?3, 'sent') ON CONFLICT(dedupe_key) DO UPDATE SET status = 'sent', sent_at = datetime('now')",
    )
      .bind(opts.force ? `${d.key}:${Date.now()}` : d.key, d.kind, d.subject)
      .run();
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[notify] send failed', msg);
    // 失败则删除占位，下一小时重试
    if (!opts.force) await env.DB.prepare('DELETE FROM notify_log WHERE dedupe_key = ?1').bind(d.key).run();
    return { sent: false, reason: msg };
  }
}

export function localHour(tz: string): number {
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
