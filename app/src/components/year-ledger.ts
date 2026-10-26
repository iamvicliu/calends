/** Group the whole table only when at least one calendar year has multiple rows. */
export function shouldGroupYears<T>(items: readonly T[], dateOf: (item: T) => string): boolean {
  const years = new Set<string>();
  for (const item of items) {
    const year = dateOf(item).slice(0, 4);
    if (years.has(year)) return true;
    years.add(year);
  }
  return false;
}
