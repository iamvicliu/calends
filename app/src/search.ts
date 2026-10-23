import { locale } from '../../shared/i18n.ts';

export interface SearchIndex {
  readonly text: string;
  readonly pinyin: ReadonlyArray<{ readonly syllables: readonly string[]; readonly full: string; readonly initials: string }>;
}

let convert: typeof import('pinyin-pro').pinyin | undefined;
let loading: Promise<void> | undefined;
const cache = new Map<string, SearchIndex>();
const isChinese = (language: string) => ['zh-CN', 'zh-TW', 'zh-HK'].includes(language);

/** Only Chinese search surfaces request the separate dictionary chunk. Failed loads can retry. */
export function loadSearch(language = locale()): Promise<void> {
  if (!isChinese(language) || convert) return Promise.resolve();
  return (loading ??= import('pinyin-pro')
    .then((module) => {
      convert = module.pinyin;
    })
    .catch((error) => {
      loading = undefined;
      throw error;
    }));
}

/** Cache by candidate text, not query; bound retained names/notes across ledger edits. */
export function searchIndex(text: string, language = locale()): SearchIndex {
  const normalized = text.toLowerCase();
  if (!isChinese(language) || !convert) return { text: normalized, pinyin: [] };
  const previous = cache.get(normalized);
  if (previous) return previous;
  const pinyin = [...normalized.matchAll(/\p{Script=Han}+/gu)].map(([run]) => {
    const syllables = convert!(run, { type: 'array', toneType: 'none', v: true, traditional: true });
    return { syllables, full: syllables.join(''), initials: syllables.map((s) => s[0]).join('') };
  });
  const index = { text: normalized, pinyin };
  if (cache.size >= 4096) cache.delete(cache.keys().next().value!);
  cache.set(normalized, index);
  return index;
}

/** Match full syllables, initials or a mixture without enumerating every combination. */
function matchPinyin(query: string, { syllables, full, initials }: SearchIndex['pinyin'][number]): boolean {
  if (full.includes(query) || initials.includes(query)) return true;
  let offsets = new Set<number>();
  for (const syllable of syllables) {
    offsets.add(0);
    const next = new Set<number>();
    for (const offset of offsets) {
      const rest = query.slice(offset);
      if (syllable.startsWith(rest)) return true;
      for (const part of [syllable, syllable[0]]) {
        if (rest.startsWith(part)) {
          const end = offset + part.length;
          if (end === query.length) return true;
          next.add(end);
        }
      }
    }
    offsets = next;
  }
  return false;
}

/** Existing literal substring matches always win, including names, symbols and ISO codes. */
export function matchText(query: string, candidate: string | SearchIndex, language = locale()): boolean {
  const index = typeof candidate === 'string' ? searchIndex(candidate, language) : candidate;
  const key = query.trim().toLowerCase();
  if (index.text.includes(key)) return true;
  if (!isChinese(language)) return false;
  const roman = key.replace(/ü/g, 'v').replace(/[\s'-]/g, '');
  return /^[a-z]+$/.test(roman) && index.pinyin.some((syllables) => matchPinyin(roman, syllables));
}
