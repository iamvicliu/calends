import type { PaymentMethod } from './types.ts';

/** Payment identity owns a group; duplicate display names gain the wallet's tail suffix. */
export function paymentMethodGroups<T>(methods: PaymentMethod[], rows: Array<{ methodId?: string; value: number; item: T }>, unassigned: string) {
  const groups = new Map<string, { id: string; name: string; sum: number; items: T[] }>();
  for (const row of rows) {
    const id = row.methodId ?? '';
    const method = methods.find((m) => m.id === id);
    const name = method
      ? method.last4 && methods.some((m) => m.id !== id && m.name === method.name) ? `${method.name} · ${method.last4}` : method.name
      : unassigned;
    const group = groups.get(id) ?? { id, name, sum: 0, items: [] };
    group.sum += row.value;
    group.items.push(row.item);
    groups.set(id, group);
  }
  return [...groups.values()];
}
