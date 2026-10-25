import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchPublic, isPublicHttpsUrl } from '../worker/url-guard.ts';

test('图片中转只允许公网 https 地址：回环、私网、链路本地、云元数据和各种 IP 写法都拦住', () => {
  for (const ok of [
    'https://example.com/a.png',
    'https://8.8.8.8/x.png',
    'https://[2606:4700::1111]/x.png',
    'https://172.32.0.1/x.png',
    'https://[64:ff9b::808:808]/x.png',
    'https://[2002:808:808::1]/x.png',
  ])
    assert.equal(isPublicHttpsUrl(ok), true, ok);
  for (const bad of [
    'http://example.com/a.png',
    'ftp://example.com/a.png',
    'not a url',
    'https://localhost/a.png',
    'https://foo.localhost/a.png',
    'https://printer.local/a.png',
    'https://db.internal/a.png',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://127.0.0.1/a.png',
    'https://0x7f.1/a.png',
    'https://2130706433/a.png',
    'https://10.1.2.3/a.png',
    'https://172.16.0.1/a.png',
    'https://192.168.1.1/a.png',
    'https://169.254.169.254/latest/meta-data/',
    'https://100.64.0.1/a.png',
    'https://0.0.0.0/a.png',
    'https://224.0.0.1/a.png',
    'https://[::1]/a.png',
    'https://[fd00::1]/a.png',
    'https://[fe80::1]/a.png',
    'https://[::ffff:127.0.0.1]/a.png',
    'https://[::ffff:a9fe:a9fe]/a.png',
    'https://[::127.0.0.1]/a.png',
    'https://[::7f00:1]/a.png',
    'https://[::a9fe:a9fe]/a.png',
    'https://[64:ff9b::7f00:1]/a.png',
    'https://[64:ff9b::10.0.0.1]/a.png',
    'https://[64:ff9b:1::c0a8:101]/a.png',
    'https://[2002:7f00:1::]/a.png',
    'https://[2002:a9fe:a9fe::1]/a.png',
    'https://[ff02::1]/a.png',
    'https://[0:0:0:0:0:0:0:1]/a.png',
  ])
    assert.equal(isPublicHttpsUrl(bad), false, bad);
});

test('跟随跳转时每一跳都重新检查：跳到内网或 http 地址直接拒绝，正常跳转照常取到', async (t) => {
  const hops: Record<string, Response> = {
    'https://a.example/1': new Response(null, { status: 302, headers: { location: '/2' } }),
    'https://a.example/2': new Response('img', { headers: { 'content-type': 'image/png' } }),
    'https://b.example/1': new Response(null, { status: 301, headers: { location: 'https://169.254.169.254/latest' } }),
    'https://c.example/1': new Response(null, { status: 302, headers: { location: 'http://c.example/2' } }),
  };
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(init.redirect, 'manual');
    calls.push(url);
    return hops[url].clone();
  });
  assert.equal(await (await fetchPublic('https://a.example/1'))!.text(), 'img');
  assert.equal(await fetchPublic('https://b.example/1'), undefined);
  assert.equal(await fetchPublic('https://c.example/1'), undefined);
  assert.equal(await fetchPublic('https://127.0.0.1/x'), undefined);
  // 内网地址一次都没真正请求
  assert.ok(!calls.some((u) => u.includes('169.254') || u.includes('127.0.0.1')));
});
