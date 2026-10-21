// 前端脚本化演示：只读取传入账本；不请求模型，也不保存服务端聊天。
import { addDays, addMonths, chargesBetween, monthlyGross, phaseSubs } from './billing.ts';
import { chargeValue } from './fx.ts';
import { cnDate, money } from './format.ts';
import { t } from './i18n.ts';
import { PROJECT_URL } from './brand.ts';
import type { AppState, Subscription } from './types.ts';

export type DemoScenario = 'receipt' | 'month' | 'hikes' | 'downgrade';
export const isAiDemo = (state: AppState) => state.subscriptions.some((s) => s.tags.includes('Claude'));
export const demoScenarios = (state: AppState): DemoScenario[] => ['receipt', 'month', 'hikes', ...(isAiDemo(state) ? ['downgrade' as const] : [])];

export function demoReceipt(state: AppState, today: string): Subscription {
  const ai = isAiDemo(state);
  return {
    id: ai ? 's-demo-receipt-claude' : 's-demo-receipt-linear',
    name: ai ? 'Claude Max 5x · Taylor' : 'Linear Standard',
    category: state.settings.categories?.find((c) => c.preset === (ai ? 'ai' : 'developer'))?.name ?? (ai ? 'AI' : 'Developer'),
    account: ai ? 'taylor-new@example.com' : 'alex-linear@example.com',
    price: ai ? 100 : 8,
    currency: 'USD',
    cycle: { unit: 'month', every: 1 },
    start: today,
    status: 'active',
    methodId: state.methods.find((m) => m.currency === 'USD')?.id,
    tags: ['demo-receipt'],
    createdAt: today,
    url: ai ? 'https://claude.ai' : 'https://linear.app',
    ...(ai ? { icon: '/ai/claude.svg' } : {}),
  };
}

export function demoPrompt(state: AppState, today: string, scenario: DemoScenario): string {
  if (scenario !== 'receipt') return scenario === 'downgrade' ? t('assistant.demo.downgrade') : t(`assistant.suggest.${scenario}.text`);
  const s = demoReceipt(state, today);
  return t('assistant.demo.receipt', { name: s.name, amount: money(s.price, s.currency), account: s.account, date: cnDate(today) });
}

/** 与概览同样使用计费和汇率函数，统计整月账本扣款（不含替他人代付）。 */
export function demoMonth(state: AppState, today: string) {
  const from = today.slice(0, 8) + '01';
  const to = addDays(addMonths(from, 1), -1);
  const charges = state.subscriptions.filter((s) => !s.proxy).flatMap((s) => chargesBetween(s, from, to, today));
  const values = charges.map((c) => ({ name: c.sub.name, value: chargeValue(state, c) }));
  return {
    total: values.reduce((n, c) => n + c.value, 0),
    count: values.length,
    largest: values.reduce<{ name: string; value: number } | null>((a, b) => (!a || b.value > a.value ? b : a), null),
    currency: state.settings.baseCurrency,
  };
}

/** 最近一年同币种的月均价格上涨；换区的币种变化不伪装成涨价。 */
export function demoHikes(state: AppState, today: string) {
  const since = addMonths(today, -12);
  return state.subscriptions
    .flatMap((s) => {
      const phases = phaseSubs(s);
      return phases.flatMap((ph, i) => {
        const changes: Array<{ date: string; before: number; after: number; currency: string; name: string }> = [];
        const previous = phases[i - 1];
        if (previous && ph.currency === previous.currency)
          changes.push({
            date: ph.start,
            before: monthlyGross(previous, addDays(ph.start, -1)),
            after: monthlyGross(ph, ph.start),
            currency: ph.currency,
            name: s.name,
          });
        const history = [...(ph.priceHistory ?? [])].sort((a, b) => a.from.localeCompare(b.from));
        for (let j = 1; j < history.length; j++)
          changes.push({
            date: history[j].from,
            before: monthlyGross({ ...ph, priceHistory: undefined, price: history[j - 1].amount }, history[j].from),
            after: monthlyGross({ ...ph, priceHistory: undefined, price: history[j].amount }, history[j].from),
            currency: ph.currency,
            name: s.name,
          });
        return changes.filter((c) => c.date >= since && c.date <= today && (!ph.end || c.date < ph.end) && c.after > c.before);
      });
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function demoReply(state: AppState, today: string, scenario?: DemoScenario) {
  if (scenario === 'receipt') {
    const subscription = demoReceipt(state, today);
    const duplicate = state.subscriptions.some((s) => s.id === subscription.id || s.account === subscription.account);
    return {
      tool: 'list_subscriptions',
      args: { query: subscription.account },
      result: { duplicate },
      text: t(duplicate ? 'assistant.demo.duplicate' : 'assistant.demo.draft'),
      subscription: duplicate ? undefined : subscription,
    };
  }
  if (scenario === 'month') {
    const result = demoMonth(state, today);
    return {
      tool: 'get_overview',
      args: {},
      result,
      text: t('assistant.demo.month', {
        amount: money(result.total, result.currency),
        count: result.count,
        name: result.largest?.name ?? '—',
        largest: money(result.largest?.value ?? 0, result.currency),
      }),
    };
  }
  if (scenario === 'hikes') {
    const result = demoHikes(state, today);
    return {
      tool: 'list_subscriptions',
      args: {},
      result,
      text: result.length
        ? t('assistant.demo.hikes') +
          '\n\n' +
          result
            .slice(0, 12)
            .map((c) => `- ${c.name} · ${cnDate(c.date)} · ${money(c.before, c.currency)} → ${money(c.after, c.currency)}`)
            .join('\n')
        : t('assistant.demo.noHikes'),
    };
  }
  if (scenario === 'downgrade') {
    const result = state.subscriptions.filter(
      (s) => s.name.startsWith('Claude Max 20x') && (s.status === 'paused' || (s.status === 'active' && s.end && s.end >= today)),
    );
    return {
      tool: 'list_subscriptions',
      args: { query: 'Claude Max 20x' },
      result: result.map((s) => ({ name: s.name, status: s.status, end: s.end })),
      text:
        t('assistant.demo.downgradeReply') +
        '\n\n' +
        result.map((s) => `- ${s.name} · ${s.account} · ${t(s.status === 'paused' ? 'list.status.paused' : 'list.status.ending')}`).join('\n'),
    };
  }
  return { tool: undefined, args: {}, result: undefined, text: t('assistant.demo.freeform') + `\n\n[${t('app.demo.cta')}](${PROJECT_URL})` };
}

/** 发送消息的唯一分流点；demo 分支不执行真实传输函数。 */
export async function assistantTransport(demo: boolean, play: () => Promise<void>, live: () => Promise<void>): Promise<void> {
  if (demo) await play();
  else await live();
}
