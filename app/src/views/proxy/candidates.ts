import { effectiveStatus, isStopped } from '../../../../shared/billing.ts';
import type { Subscription } from '../../../../shared/types.ts';

/** 只提示尚未归类、仍在进行中的代付标签订阅 */
export function isProxyCandidate(s: Subscription, today: string): boolean {
  return !s.share && !s.proxy && !isStopped(effectiveStatus(s, today)) && s.tags.some((tag) => /代付|代充|帮.*付|proxy/i.test(tag));
}
