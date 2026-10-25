import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { test } from 'node:test';
import { createFront, isCdnCgi } from '../docker/front.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

/** 发一个原始请求：可以伪造 Host、写绝对形式的请求目标 */
function send(port, { path, headers = {}, method = 'GET', body }) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('Docker 前置转发：伪造 Host 也进不了 /cdn-cgi/，访客 IP 不能自报', async (t) => {
  const seen = [];
  const upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body, method: req.method });
      res.writeHead(201, { 'x-up': '1', 'set-cookie': ['a=1', 'b=2'] }).end('ok');
    });
  });
  const upPort = await listen(upstream);
  const front = createFront({ targetPort: upPort });
  const port = await listen(front);
  t.after(() => {
    front.close();
    upstream.close();
  });

  for (const path of [
    '/cdn-cgi/local/scheduled?cron=*',
    '/cdn-cgi/local/explorer',
    '/CDN-CGI/local/email',
    '//cdn-cgi/local/scheduled',
    '/%63dn-cgi/local/scheduled',
    '/./cdn-cgi/local/scheduled',
    'http://localhost/cdn-cgi/local/scheduled',
  ]) {
    const r = await send(port, { path, headers: { host: 'localhost' } });
    assert.equal(r.status, 404, path);
  }
  assert.equal(seen.length, 0);

  const r = await send(port, {
    path: '/api/login',
    method: 'POST',
    body: '{"password":"x"}',
    headers: { host: 'calends.example.test', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'mf-cf-blob': '{}', 'x-forwarded-for': '198.51.100.7' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body, 'ok');
  assert.deepEqual(r.headers['set-cookie'], ['a=1', 'b=2']);
  assert.equal(seen[0].url, '/api/login');
  assert.equal(seen[0].body, '{"password":"x"}');
  assert.equal(seen[0].headers.host, 'calends.example.test');
  assert.equal(seen[0].headers['cf-connecting-ip'], '127.0.0.1');
  assert.equal(seen[0].headers['mf-cf-blob'], undefined);

  // 反向代理后面（TRUST_PROXY=1）取 X-Forwarded-For 第一项
  const trusted = createFront({ targetPort: upPort, trustProxy: true });
  const tp = await listen(trusted);
  t.after(() => trusted.close());
  await send(tp, { path: '/api/auth/status', headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1', 'cf-connecting-ip': '203.0.113.9' } });
  assert.equal(seen[1].headers['cf-connecting-ip'], '198.51.100.7');
});

test('isCdnCgi 不误伤普通路径', () => {
  for (const p of ['/', '/api/state', '/cdn-cgi-like', '/assets/cdn-cgi/x.js', '/mcp']) assert.equal(isCdnCgi(p), false, p);
});

test('容器入口：wrangler 只听回环并关闭本地 explorer，对外端口走前置转发', () => {
  const src = readFileSync(new URL('../docker/entrypoint.mjs', import.meta.url), 'utf8');
  assert.match(src, /X_LOCAL_EXPLORER: 'false'/);
  assert.match(src, /'--ip',\s*'127\.0\.0\.1'/);
  assert.match(src, /createFront\(/);
  assert.match(readFileSync(new URL('../docker/Dockerfile', import.meta.url), 'utf8'), /docker\/front\.mjs/);
});
