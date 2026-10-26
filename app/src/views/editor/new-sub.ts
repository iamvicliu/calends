import { uid } from '../../../../shared/billing.ts';
import type { Subscription } from '../../../../shared/types.ts';
import { presetCat } from '../../derive.ts';

export function newSub(today: string, methodId?: string, currency = 'USD'): Subscription {
  return {
    id: uid(),
    name: '',
    category: presetCat('tools'),
    tags: [],
    price: 0,
    currency,
    cycle: { unit: 'month', every: 1 },
    start: today,
    status: 'active',
    methodId,
  };
}
