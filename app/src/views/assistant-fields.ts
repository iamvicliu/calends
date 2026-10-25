import { cnDateFull } from '../../../shared/format.ts';

/**
 * 草稿卡片里按日期显示的参数：键名本身或以 _ 分隔的最后一段（camelCase 的最后一词）是日期词。
 * 只看词尾，category、status、create_category 这类中间含「at」的键不算日期。
 */
const DATE_WORD = /(?:^|_)(?:date|end|due|until|from|at|expires)$|(?:Date|End|Due|Until|From|At|Expires)$/;
export const isDateField = (key: string) => DATE_WORD.test(key);

/** 合法的 YYYY-MM-DD 按当前语言显示；其他值（模型给的自由文本）原样返回，空值为 undefined */
export function proposalDay(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? cnDateFull(s) : s;
}
