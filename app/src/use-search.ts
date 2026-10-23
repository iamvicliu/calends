import { useEffect, useMemo, useState } from 'react';
import { locale } from '../../shared/i18n.ts';
import { loadSearch, matchText, searchIndex } from './search.ts';

/** Pre-index every candidate and refresh an already typed query when the lazy chunk arrives. */
export function useTextSearch(texts: string[], enabled = true): (query: string, text: string) => boolean {
  const language = locale();
  const [ready, setReady] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void loadSearch(language).then(
      () => active && setReady((revision) => revision + 1),
      () => {}, // Keep literal search available if the optional dictionary cannot load.
    );
    return () => {
      active = false;
    };
  }, [language, enabled]);
  return useMemo(() => {
    // Read readiness in the calculation: React Compiler may remove an unused memo dependency.
    const indexes = new Map(texts.map((text) => [text, searchIndex(text, ready ? language : 'en')]));
    return (query: string, text: string) => matchText(query, indexes.get(text) ?? text, language);
  }, [texts, language, ready]);
}
