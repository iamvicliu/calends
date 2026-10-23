import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSearch, matchText, searchIndex } from '../app/src/search.ts';
import { LOCALES } from '../shared/i18n.ts';

test('Chinese search loads lazily and refreshes indexes prepared before loading', async () => {
  await loadSearch('en');
  assert.equal(matchText('tuerqi', '土耳其', 'zh-CN'), false);
  await Promise.all([loadSearch('zh-CN'), loadSearch('zh-TW')]);
  assert.equal(matchText('tuerqi', '土耳其', 'zh-CN'), true);
});

test('regions and currencies accept full pinyin, initials, mixed syllables and case', async () => {
  await loadSearch('zh-CN');
  for (const [text, queries] of [
    ['土耳其 TR', ['tuerqi', 'teq', 'TuErQi', 'tuEQ', 'tu er qi', '土耳其', 'tr', 'TR']],
    ['菲律宾 PH', ['feilvbin', 'flb', 'FeiLB', 'feilüb', '菲', 'PH']],
    ['人民币 CNY', ['rmb', 'renminbi', 'renmb', '人民币', 'cny']],
    ['土耳其里拉 TRY', ['tuerqilila', 'teqll', 'try', 'TRY']],
  ]) {
    for (const query of queries) assert.equal(matchText(query, text, 'zh-CN'), true, `${query} → ${text}`);
  }
  assert.equal(matchText('feilvbin', '土耳其 TR', 'zh-CN'), false);
  assert.equal(matchText('teq', '菲律宾 PH', 'zh-CN'), false);
});

test('all three Chinese locales transliterate simplified and traditional candidates', async () => {
  await loadSearch('zh-TW');
  for (const language of ['zh-CN', 'zh-TW', 'zh-HK']) {
    for (const [query, text] of [
      ['taiwan', '臺灣'],
      ['tw', '臺灣'],
      ['flb', '菲律賓'],
      ['rmb', '人民幣'],
    ]) {
      assert.equal(matchText(query, text, language), true, `${language}: ${query} → ${text}`);
    }
  }
});

test('non-Chinese locales never gain pinyin matches, even after dictionary loading', async () => {
  await loadSearch('zh-CN');
  const chineseIndex = searchIndex('土耳其 TR', 'zh-CN');
  for (const { code } of LOCALES.filter(({ code }) => !code.startsWith('zh-'))) {
    await loadSearch(code);
    assert.equal(matchText('teq', '土耳其 TR', code), false, code);
    assert.equal(matchText('teq', chineseIndex, code), false, code);
    assert.equal(matchText('TR', '土耳其 TR', code), true, code);
    assert.equal(matchText('turkey', 'Turkey TR', code), true, code);
    assert.equal(matchText('人民币', '人民币 CNY', code), true, code);
  }
});

test('candidate indexes are reused across queries and edited names get fresh indexes', async () => {
  await loadSearch('zh-CN');
  const index = searchIndex('菲律宾 PH', 'zh-CN');
  for (const query of ['f', 'fl', 'flb', 'feilvbin']) assert.equal(matchText(query, index, 'zh-CN'), true);
  assert.equal(searchIndex('菲律宾 PH', 'zh-HK'), index);
  assert.notEqual(searchIndex('土耳其 TR', 'zh-CN'), index);
});

test('literal names, symbols, empty queries and code substrings preserve existing search', async () => {
  await loadSearch('zh-CN');
  for (const language of ['en', 'zh-CN']) {
    for (const [query, text] of [
      ['', 'anything'],
      ['  ', ''],
      ['USD', 'US Dollar USD'],
      ['¥', '人民币 CNY ¥'],
      ['try', '土耳其里拉 TRY'],
      ['Notes', 'Orbit Notes'],
    ]) {
      assert.equal(matchText(query, text, language), true);
    }
  }
});

test('wallet/category/person/subscription candidate names share pinyin semantics', async () => {
  await loadSearch('zh-CN');
  for (const [query, text] of [
    ['zfb', '支付宝'],
    ['xuexi', '学习'],
    ['xm', '小明'],
    ['wyyyy', '网易云音乐'],
    ['cx', '出行'],
  ]) {
    assert.equal(matchText(query, text, 'zh-CN'), true, `${query} → ${text}`);
  }
  const subscription = '网易云音乐 娱乐 张三 TR';
  assert.equal(
    ['wyyy', 'yl', 'zs', 'tr'].every((word) => matchText(word, subscription, 'zh-CN')),
    true,
  );
  assert.equal(
    ['wyyy', 'missing'].every((word) => matchText(word, subscription, 'zh-CN')),
    false,
  );
});
