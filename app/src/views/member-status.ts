import type { AppState, ShareMember, Subscription } from '../../../shared/types.ts';
import { memberStatus as statusOf } from '../../../shared/carpool.ts';
import { money } from '../../../shared/format.ts';

export function memberStatus(state: AppState, s: Subscription, m: ShareMember, today: string) {
  const status = statusOf(state, s, m, today);
  const { currency, ...rest } = status;
  return { ...rest, owed: status.owe ? money(status.owed!, currency) : '' };
}
