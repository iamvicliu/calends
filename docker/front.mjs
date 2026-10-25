// 容器对外端口上的前置转发：wrangler（workerd）只听容器内回环地址，外部请求经这里进入。
// - /cdn-cgi/ 是 Miniflare 的本地管理入口（触发定时任务、邮件、数据浏览器等），它只凭 Host 头判断「是不是本机」，
//   而 Host 可以伪造，所以对外一律拒绝；容器自己触发定时任务时直连内部端口。
// - 访客 IP 由这里按真实连接（TRUST_PROXY=1 时取 X-Forwarded-For 第一项）写进 CF-Connecting-IP，
//   丢掉客户端自带的同名头和 Miniflare 内部头（MF-*），避免伪造 IP 绕过登录限速或改写请求元数据。
import { request as httpRequest, createServer } from 'node:http';

/** 请求目标（/path?q 或绝对形式 http://host/path）；以 // 开头的仍当作路径，而不是另一个主机 */
const targetOf = (raw) => new URL(String(raw || '/').startsWith('/') ? `http://front.invalid${raw}` : raw);

/** 解码后的路径是否指向 /cdn-cgi/（含大小写、百分号编码、重复斜杠、绝对形式的请求目标） */
export function isCdnCgi(rawUrl) {
  let path;
  try {
    path = targetOf(rawUrl).pathname;
  } catch {
    return true;
  }
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true;
  }
  return /^\/+cdn-cgi(\/|$)/i.test(decoded) || /^\/+cdn-cgi(\/|$)/i.test(path);
}

/** 写给 Worker 的访客 IP */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const first = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')[0]
      .trim();
    if (first) return first;
  }
  return (req.socket.remoteAddress ?? '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
}

export function createFront({ targetPort, targetHost = '127.0.0.1', trustProxy = false }) {
  return createServer((req, res) => {
    if (isCdnCgi(req.url)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    const u = targetOf(req.url);
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (key === 'cf-connecting-ip' || key.startsWith('mf-')) continue;
      headers[k] = v;
    }
    const ip = clientIp(req, trustProxy);
    if (ip) headers['cf-connecting-ip'] = ip;
    const upstream = httpRequest({ host: targetHost, port: targetPort, method: req.method, path: u.pathname + u.search, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.rawHeaders);
      r.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad gateway');
    });
    req.pipe(upstream);
  });
}
