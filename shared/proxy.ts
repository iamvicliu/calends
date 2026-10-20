// 代付：把每一期扣款和对方的收款记录对上。页面和提醒邮件共用，保证两边说法一致
import { diffDays } from './billing.ts';
import type { ProxyEntry } from './types.ts';

/** 先按扣款日精确对上；改过开始日期等原因对不上的，再找前后 15 天内还没用过的那条 */
export function matchEntries(entries: ProxyEntry[], dates: string[]): Map<string, ProxyEntry> {
  const out = new Map<string, ProxyEntry>();
  const used = new Set<ProxyEntry>();
  for (const d of dates) {
    const e = entries.find((x) => x.charge === d);
    if (e) {
      out.set(d, e);
      used.add(e);
    }
  }
  for (const d of dates) {
    if (out.has(d)) continue;
    const e = entries.filter((x) => !used.has(x)).sort((p, q) => Math.abs(diffDays(p.charge, d)) - Math.abs(diffDays(q.charge, d)))[0];
    if (!e || Math.abs(diffDays(e.charge, d)) > 15) continue;
    out.set(d, e);
    used.add(e);
  }
  return out;
}
