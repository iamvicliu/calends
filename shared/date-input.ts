const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
const SLASH = /^(\d{4})\/(\d{2})\/(\d{2})$/;
const CHINESE = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/;

/** Parse the supported manual date formats without normalizing invalid calendar dates. */
export function parseDateInput(raw: string): string | undefined {
  const input = raw.trim();
  const match = ISO.exec(input) ?? COMPACT.exec(input) ?? SLASH.exec(input) ?? CHINESE.exec(input);
  if (!match) return undefined;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  return date.toISOString().slice(0, 10);
}
