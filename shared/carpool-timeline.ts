import { addDays, addMonths, diffDays, memberCollection, memberUnpaidFrom } from './billing.ts';
import type { Subscription } from './types.ts';

/** 详情的成员展示不改变收款账本；不分摊成员同样占一个位置。 */
export function carpoolRoster(s: Subscription, today: string) {
  const members = s.share?.members ?? [];
  const active = members.filter((m) => !m.left || m.left > today);
  const departed = members.filter((m) => m.left && m.left <= today);
  // 席位数包含车主自己（与 MCP 的 seats 约定一致）：我发起的车，我占一个座
  const taken = active.length + (s.share?.role === 'owner' ? 1 : 0);
  return { active, departed, taken, vacancies: Math.max(0, (s.share?.seats ?? 0) - taken) };
}

/** 时间范围覆盖全部加入历史，到在车成员第一段未来应收的期末再留两周。 */
export function carpoolTimeline(s: Subscription, today: string, ruleMonths: number) {
  const { active } = carpoolRoster(s, today);
  const start = [
    addMonths(today, -3),
    s.share?.collectFrom ?? s.share?.since ?? s.start,
    ...(s.share?.members ?? []).flatMap((m) => (m.joined ? [m.joined] : [])),
  ].sort()[0];
  const ends = active
    .filter((m) => !m.exempt)
    .map((m) => {
      let period = memberCollection(s, m, memberUnpaidFrom(s, m));
      // 每次推进真实收费期，保留首期对齐、已付至和未来调价后的周期。
      while (period.from <= today) {
        const next = memberCollection(s, m, period.next);
        if (next.from <= period.from) break;
        period = next;
      }
      return period.until;
    });
  const end = [addDays(ends.sort().at(-1) ?? addMonths(today, ruleMonths), 14), addMonths(today, 1)].sort().at(-1)!;
  const desiredStart = [addMonths(end, -15), addMonths(today, -3)].sort()[0];
  const viewStart = [start, desiredStart].sort().at(-1)!;
  const totalDays = Math.max(1, diffDays(start, end));
  const viewDays = Math.max(1, diffDays(viewStart, end));
  return { start, end, totalDays, viewDays, maxOffset: Math.max(0, totalDays - viewDays) };
}
