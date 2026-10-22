import { addDays, addMonths, chargesBetween, renewalRuleAt, todayIn } from '../shared/billing.ts';
import { money } from '../shared/format.ts';
import { t } from '../shared/i18n.ts';
import type { AppState } from '../shared/types.ts';

function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** RFC 5545 要求每行不超过 75 字节，超出折行 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const l = new TextEncoder().encode(ch).length;
    if (len + l > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      len = 0;
    }
    cur += ch;
    len += l;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function buildIcs(state: AppState, siteUrl: string): string {
  const today = todayIn(state.settings.timezone);
  const from = addMonths(today, -3);
  const to = addMonths(today, 13);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calends//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${icsText(t('server.ics.calName'))}`),
    'X-WR-TIMEZONE:' + state.settings.timezone,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const s of state.subscriptions) {
    const remind = s.remindDays ?? state.settings.remindDays;
    const seen = new Map<string, number>();
    for (const c of chargesBetween(s, from, to, today)) {
      const d = c.date.replace(/-/g, '');
      // 同一天可能有两笔（如补扣），UID 要各不相同
      const n = (seen.get(d) ?? 0) + 1;
      seen.set(d, n);
      const method = state.methods.find((m) => m.id === c.sub.methodId);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${s.id}-${d}${n > 1 ? `-${n}` : ''}@${new URL(siteUrl).host}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${d}`,
        `DTEND;VALUE=DATE:${addDays(c.date, 1).replace(/-/g, '')}`,
        fold(`SUMMARY:${icsText(`${s.icon && !s.icon.startsWith('http') ? s.icon + ' ' : ''}${s.name} ${money(c.amount, c.currency)}`)}`),
        fold(`DESCRIPTION:${icsText([method ? t('server.ics.method', { name: method.name }) : '', s.category, `${siteUrl}/`].filter(Boolean).join('\n'))}`),
        'TRANSP:TRANSPARENT',
      );
      if (remind >= 0 && c.projected) {
        // 相对全天事件起点提前 N 天再加 9 小时；实际提醒时刻由日历客户端解释。
        const trigger = remind === 0 ? 'PT9H' : `-P${remind - 1}DT15H`;
        lines.push(
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          fold(`DESCRIPTION:${icsText(t('server.ics.alarm', { name: s.name }))}`),
          `TRIGGER:${trigger}`,
          'END:VALARM',
        );
      }
      const cancelLead = renewalRuleAt(c.sub, c.date).cancelLeadDays;
      if (remind >= 0 && c.projected && cancelLead > 0) {
        const deadline = addDays(c.date, -cancelLead);
        if (deadline >= today)
          lines.push(
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            fold(`DESCRIPTION:${icsText(t('core.renewal.cancelReminder', { date: deadline }))}`),
            `TRIGGER:-P${cancelLead + remind - 1}DT15H`,
            'END:VALARM',
          );
      }
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
