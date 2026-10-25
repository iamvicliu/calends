// 只允许服务端去抓公网 https 地址：拦掉回环、私网、链路本地和云元数据地址，
// 避免 /api/img 这类按用户给的地址去取东西的接口变成探测内网的跳板（Docker 自托管时尤其要紧）。
// 地址检查改编自 PR #5（@iamvicliu）；域名解析到内网的情况由运行时网络层兜底，这里挡住的是直接写 IP、写 localhost 这类写法。

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.internal|.*\.local|metadata\.google\.internal)$/i;

/** IPv4 是否属于私有 / 保留网段 */
function privateV4(a: number, b: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true; // 本网、私网、回环
  if (a === 169 && b === 254) return true; // 链路本地（含云元数据 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 基准测试网段
  return a >= 224; // 组播与保留段
}

/**
 * 主机名是否是私有地址的字面量。URL 解析时已经把 0x7f.1、2130706433 这类写法规范成点分十进制，
 * 把 [::ffff:127.0.0.1] 规范成 [::ffff:7f00:1]，这里按规范后的形式判断
 */
function privateIp(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7 唯一本地
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true; // fe80::/10 链路本地
    // IPv4 映射地址：::ffff:7f00:1 或 ::ffff:127.0.0.1，按 IPv4 再判一次
    const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) return privateV4(parseInt(hex[1], 16) >> 8, parseInt(hex[1], 16) & 255);
    const dotted = h.match(/^::ffff:(\d+)\.(\d+)\.\d+\.\d+$/);
    if (dotted) return privateV4(Number(dotted[1]), Number(dotted[2]));
    return false;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  return !!m && privateV4(Number(m[1]), Number(m[2]));
}

export function isPublicHttpsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || !u.hostname) return false;
  return !PRIVATE_HOST.test(u.hostname) && !privateIp(u.hostname);
}

/**
 * 抓一个公网 https 地址：自己跟随跳转，每一跳都重新检查，跳到内网或非 https 的地址直接拒绝。
 * 返回 undefined 表示地址不允许
 */
export async function fetchPublic(url: string, init: RequestInit = {}, hops = 3): Promise<Response | undefined> {
  let current = url;
  for (let i = 0; i <= hops; i++) {
    if (!isPublicHttpsUrl(current)) return undefined;
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;
    current = new URL(location, current).href;
  }
  return undefined;
}
