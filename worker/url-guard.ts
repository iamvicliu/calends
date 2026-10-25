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

/** IPv6 字面量展开成 8 组 16 位数；末尾写成点分 IPv4 的也认；不是合法写法时返回 undefined */
function expandV6(h: string): number[] | undefined {
  let s = h;
  const v4 = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const b = v4.slice(1).map(Number);
    if (b.some((x) => x > 255)) return undefined;
    s = s.slice(0, -v4[0].length) + `${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return undefined;
  const part = (x: string) => (x ? x.split(':') : []);
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return undefined;
  const words = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  if (words.some((w) => !/^[0-9a-f]{1,4}$/.test(w))) return undefined;
  return words.map((w) => parseInt(w, 16));
}

/** 嵌在 IPv6 里的 IPv4（高 16 位、低 16 位）是否私有 */
const embeddedPrivate = (hi: number, lo: number) => privateV4(hi >> 8, hi & 255) || (hi === 0 && lo === 0);

/**
 * 主机名是否是私有地址的字面量。URL 解析时已经把 0x7f.1、2130706433 这类写法规范成点分十进制，
 * 把 [::ffff:127.0.0.1] 规范成 [::ffff:7f00:1]，这里按规范后的形式判断。
 * IPv6 里带着 IPv4 的几种写法都按那个 IPv4 再判一次：IPv4 映射（::ffff:0:0/96）、IPv4 兼容（::/96，如 ::7f00:1）、
 * NAT64（64:ff9b::/96 与本地 64:ff9b:1::/48）和 6to4（2002::/16）。
 */
function privateIp(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h.includes(':')) {
    const w = expandV6(h);
    // 认不出的写法不放行
    if (!w) return true;
    const zeros = (from: number, to: number) => w.slice(from, to).every((x) => x === 0);
    if (zeros(0, 7) && (w[7] === 0 || w[7] === 1)) return true; // :: 与 ::1
    if ((w[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地
    if ((w[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
    if ((w[0] & 0xff00) === 0xff00) return true; // ff00::/8 组播
    if (zeros(0, 5) && w[5] === 0xffff) return privateV4(w[6] >> 8, w[6] & 255); // IPv4 映射
    if (zeros(0, 6)) return embeddedPrivate(w[6], w[7]); // IPv4 兼容
    if (w[0] === 0x64 && w[1] === 0xff9b && (zeros(2, 6) || w[2] === 1)) return embeddedPrivate(w[6], w[7]); // NAT64
    if (w[0] === 0x2002) return embeddedPrivate(w[1], w[2]); // 6to4
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
