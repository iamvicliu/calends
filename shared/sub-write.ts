// 整条订阅写入（网页端 PUT /api/subscriptions/:id 与 MCP save_subscription 共用）：同一套归一化与校验
import { reconcileRenewalRules, subError } from './billing.ts';
import { updateMemberLeave } from './carpool.ts';
import { t } from './i18n.ts';
import { statusChangeError } from './phases.ts';
import type { Subscription } from './types.ts';

export function validSub(s: Subscription): string | undefined {
  if (!s || typeof s.id !== 'string' || !s.id) return t('server.missingId');
  return subError(s);
}

/**
 * 以 previous（库里现有记录，新建时为空）为基准准备一条完整替换的订阅：
 * 续费规则改动按生效日记入历史；成员的退出日被清掉时一并清掉退款；最后做完整校验和状态迁移约束。
 */
export function prepareSubWrite(
  previous: Subscription | undefined,
  next: Subscription,
  today: string,
): { sub: Subscription; error?: undefined } | { error: string } {
  let sub = reconcileRenewalRules(previous, next, today);
  // Clearing an existing exit also clears its settlement. New orphan refunds fail validation.
  if (sub.share)
    sub = {
      ...sub,
      share: {
        ...sub.share,
        members: sub.share.members.map((m) => (previous?.share?.members.some((old) => old.id === m.id && old.left) && !m.left ? updateMemberLeave(m, {}) : m)),
      },
    };
  const error = validSub(sub) ?? statusChangeError(previous, sub, today);
  return error ? { error } : { sub };
}
