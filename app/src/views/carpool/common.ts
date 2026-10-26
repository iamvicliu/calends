export const CAR_FILTERS = ['all', 'live', 'owe', 'settled', 'ended'] as const;

export type CarFilter = (typeof CAR_FILTERS)[number];

/** 展开了哪些车卡（JSON 数组），解析失败当作都收起 */
export function parseIds(raw: string): Set<string> {
  try {
    const v = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export type CarSort = 'owed' | 'net' | 'next' | 'name' | 'price' | 'paid' | 'received' | 'profit';

export type CarView = 'grid' | 'list';

export const isCarView = (v: string): v is CarView => v === 'grid' || v === 'list';

export const isCarSort = (v: string): v is CarSort => ['owed', 'net', 'next', 'name', 'price', 'paid', 'received', 'profit'].includes(v);

/** 默认方向：待收多的在前、亏得多的在前、扣款近的在前、名称 A→Z；金额类大的在前，盈亏亏得多的在前 */
export const CAR_SORT_DIR: Record<CarSort, 'asc' | 'desc'> = {
  owed: 'desc',
  net: 'asc',
  next: 'asc',
  name: 'asc',
  price: 'desc',
  paid: 'desc',
  received: 'desc',
  profit: 'asc',
};
