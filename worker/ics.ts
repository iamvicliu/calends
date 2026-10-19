import { addDays, addMonths, chargesBetween, todayIn } from '../shared/billing.ts';
import { money } from '../shared/format.ts';
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
    'PRODID:-//example.com//Subscription Ledger//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:订阅扣款',
    'X-WR-TIMEZONE:' + state.settings.timezone,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const s of state.subscriptions) {
    const remind = s.remindDays ?? state.settings.remindDays;
    for (const c of chargesBetween(s, from, to, today)) {
      const d = c.date.replace(/-/g, '');
      const method = state.methods.find((m) => m.id === s.methodId);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${s.id}-${d}@calends.example.com`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${d}`,
        `DTEND;VALUE=DATE:${addDays(c.date, 1).replace(/-/g, '')}`,
        fold(`SUMMARY:${icsText(`${s.icon && !s.icon.startsWith('http') ? s.icon + ' ' : ''}${s.name} ${money(c.amount, c.currency)}`)}`),
        fold(`DESCRIPTION:${icsText([method ? `支付：${method.name}` : '', s.category, siteUrl].filter(Boolean).join('\n'))}`),
        'TRANSP:TRANSPARENT',
      );
      if (remind >= 0 && c.projected) {
        // 全天事件从当天 0 点算起：提前 N 天的上午 9 点
        const trigger = remind === 0 ? 'PT9H' : `-P${remind - 1}DT15H`;
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${icsText(`${s.name} 即将扣款`)}`), `TRIGGER:${trigger}`, 'END:VALARM');
      }
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
