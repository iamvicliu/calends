import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { flatten, setLocale, t } from './i18n.ts';

const labels = {
  'zh-CN': ['买入', '卖出'],
  'zh-TW': ['買入', '賣出'],
  'zh-HK': ['買入', '賣出'],
  en: ['Bought', 'Sold'],
  de: ['Gekauft', 'Verkauft'],
  es: ['Comprado', 'Vendido'],
  fr: ['Acheté', 'Vendu'],
  id: ['Dibeli', 'Dijual'],
  ja: ['買付', '売却'],
  ko: ['매수', '매도'],
  'pt-BR': ['Comprado', 'Vendido'],
  ru: ['Куплено', 'Продано'],
  tr: ['Satın alındı', 'Satıldı'],
  vi: ['Mua vào', 'Bán ra'],
} as const;
test('all 14 locales use purchase/sale labels through the shared translation keys', () => {
  try {
    for (const [loc, expected] of Object.entries(labels)) {
      const messages = {};
      flatten('detail', JSON.parse(readFileSync(new URL(`./locales/${loc}/detail.json`, import.meta.url), 'utf8')), messages);
      setLocale(loc as keyof typeof labels, [messages]);
      assert.deepEqual([t('detail.transfer.kind.buy'), t('detail.transfer.kind.sell')], expected);
      if (loc === 'zh-CN') assert.equal(t('detail.transfer.title'), '转让收付');
    }
  } finally {
    setLocale('en', []);
  }
});
