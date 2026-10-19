import { todayIn } from '../shared/billing.ts';
import { DEFAULT_SETTINGS, type FxTable, type PaymentMethod, type Settings, type Subscription } from '../shared/types.ts';
import { isAuthed, login, logout, randomToken, sameOrigin } from './auth.ts';
import { maskForPublic } from '../shared/mask.ts';
import type { Env } from './env.ts';
import { backfill, fxStatus, recordToday } from './fx.ts';
import { buildIcs } from './ics.ts';
import { buildDaily, buildMonthly, renderEmail, runScheduled, sendDigest, type Digest } from './notify.ts';
import { getFx, getSettings, loadState, putKv, remove, replaceAll, upsert } from './store.ts';

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const bad = (msg: string, status = 400) => json({ error: msg }, status);

async function refreshFx(env: Env): Promise<FxTable> {
  const res = await fetch('https://open.er-api.com/v6/latest/USD', { cf: { cacheTtl: 3600 } });
  const body = (await res.json()) as { result?: string; rates?: Record<string, number> };
  if (body.result !== 'success' || !body.rates) throw new Error('汇率接口异常');
  const fx: FxTable = { base: 'USD', rates: body.rates, fetchedAt: new Date().toISOString() };
  await putKv(env, 'fx', fx);
  await recordToday(env, fx, (await getSettings(env)).timezone);
  return fx;
}

function validSub(s: Subscription): string | undefined {
  if (!s || typeof s.id !== 'string' || !s.id) return '缺少 id';
  if (!s.name?.trim()) return '名称不能为空';
  if (!Number.isFinite(s.price) || s.price < 0) return '价格无效';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.start)) return '开始日期无效';
  if (!s.cycle || !['day', 'week', 'month', 'year', 'lifetime'].includes(s.cycle.unit) || !(s.cycle.every >= 1)) return '周期无效';
  return undefined;
}

/**
 * 本地开发免登录：DEV_BYPASS_AUTH 只写在 .dev.vars（不随部署上传）。
 * wrangler dev 会把请求 URL 改写成线上路由域名，所以这里无法按 localhost 判断。
 */
function devBypass(_req: Request, env: Env): boolean {
  return env.DEV_BYPASS_AUTH === '1';
}

async function api(req: Request, env: Env, path: string): Promise<Response> {
  const method = req.method;
  if (path === '/api/login' && method === 'POST') return login(req, env);
  if (path === '/api/logout' && method === 'POST') return logout(req, env);

  const dev = devBypass(req, env);
  const authed = dev || (await isAuthed(req, env));
  if (path === '/api/public' && method === 'GET') {
    const state = await loadState(env);
    if (!state.settings.publicView && !dev) return bad('这个账本没有公开', 404);
    return json(maskForPublic(state));
  }
  if (path === '/api/state' && method === 'GET') {
    const state = await loadState(env);
    if (authed) return json(state);
    if (state.settings.publicView) return json(maskForPublic(state));
    return bad('unauthorized', 401);
  }
  if (!authed) return bad('unauthorized', 401);
  if (method !== 'GET' && !dev && !sameOrigin(req)) return bad('forbidden', 403);

  let m = path.match(/^\/api\/subscriptions\/([\w-]+)$/);
  if (m) {
    if (method === 'PUT') {
      const sub = (await req.json()) as Subscription;
      if (sub.id !== m[1]) return bad('id 不一致');
      const err = validSub(sub);
      if (err) return bad(err);
      sub.updatedAt = new Date().toISOString();
      await upsert(env, 'subscriptions', sub.id, sub);
      return json(sub);
    }
    if (method === 'DELETE') {
      await remove(env, 'subscriptions', m[1]);
      return json({ ok: true });
    }
  }
  m = path.match(/^\/api\/methods\/([\w-]+)$/);
  if (m) {
    if (method === 'PUT') {
      const pm = (await req.json()) as PaymentMethod;
      if (pm.id !== m[1] || !pm.name?.trim()) return bad('支付方式无效');
      await upsert(env, 'methods', pm.id, pm);
      return json(pm);
    }
    if (method === 'DELETE') {
      await remove(env, 'methods', m[1]);
      return json({ ok: true });
    }
  }
  if (path === '/api/settings' && method === 'PUT') {
    const cur = await getSettings(env);
    const next = { ...DEFAULT_SETTINGS, ...cur, ...((await req.json()) as Partial<Settings>), icsToken: cur.icsToken };
    next.notifyHour = Math.min(23, Math.max(0, Math.round(next.notifyHour)));
    await putKv(env, 'settings', next);
    return json(next);
  }
  if (path === '/api/ics/rotate' && method === 'POST') {
    const cur = await getSettings(env);
    const next = { ...cur, icsToken: randomToken(16) };
    await putKv(env, 'settings', next);
    return json(next);
  }
  if (path === '/api/import' && method === 'POST') {
    const body = (await req.json()) as { subscriptions?: Subscription[]; methods?: PaymentMethod[]; settings?: Partial<Settings>; mode?: 'merge' | 'replace' };
    const subs = body.subscriptions ?? [];
    for (const s of subs) {
      const err = validSub(s);
      if (err) return bad(`${s?.name ?? '?'}：${err}`);
    }
    await replaceAll(env, subs, body.methods ?? [], body.mode === 'replace' ? 'replace' : 'merge');
    if (body.settings) {
      const cur = await getSettings(env);
      await putKv(env, 'settings', { ...cur, ...body.settings, icsToken: cur.icsToken });
    }
    return json(await loadState(env));
  }
  if (path === '/api/fx/status' && method === 'GET') {
    const st = await fxStatus(env, await loadState(env));
    return json({ ...st, missing: st.missing.slice(0, 50) });
  }
  if (path === '/api/fx/backfill' && method === 'POST') {
    return json(await backfill(env, await loadState(env)));
  }
  if (path === '/api/fx/refresh' && method === 'POST') {
    try {
      return json(await refreshFx(env));
    } catch (e) {
      return bad(e instanceof Error ? e.message : '刷新失败', 502);
    }
  }
  if (path === '/api/appstore/search' && method === 'GET') {
    const url = new URL(req.url);
    const term = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
    const country = (url.searchParams.get('country') ?? 'us').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2) || 'us';
    if (!term) return json({ results: [] });
    // 粘贴 App Store 链接时按 id 精确查找
    const id = term.match(/id(\d{6,})/)?.[1];
    const api = id
      ? `https://itunes.apple.com/lookup?id=${id}&country=${country}`
      : `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&limit=8&country=${country}`;
    const res = await fetch(api, { cf: { cacheTtl: 86400 } });
    const body = (await res.json().catch(() => ({ results: [] }))) as { results: Array<Record<string, unknown>> };
    return json({
      results: body.results.map((r) => ({
        name: r.trackName,
        icon: r.artworkUrl100,
        url: r.trackViewUrl,
        seller: r.sellerName,
        genre: r.primaryGenreName,
      })),
    });
  }
  if (path === '/api/notify/preview' && method === 'GET') {
    const state = await loadState(env);
    const url = new URL(req.url);
    const day = url.searchParams.get('day') ?? todayIn(state.settings.timezone);
    const digests = [buildMonthly(state, day), buildDaily(state, day)].filter(Boolean) as Digest[];
    const log = await env.DB.prepare('SELECT dedupe_key, kind, subject, status, sent_at FROM notify_log ORDER BY sent_at DESC LIMIT 20').all();
    if (url.searchParams.get('html') === '1' && digests[0]) {
      return new Response(renderEmail(digests[0], env.SITE_URL).html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return json({ day, digests, log: log.results });
  }
  if (path === '/api/notify/test' && method === 'POST') {
    const state = await loadState(env);
    const today = todayIn(state.settings.timezone);
    // 测试信：取未来 30 天内第一个会触发的日报；都没有就发一封样例
    let d: Digest | undefined;
    for (let i = 0; i < 30 && !d; i++) {
      const day = new Date(Date.parse(today) + i * 86_400_000).toISOString().slice(0, 10);
      d = buildDaily(state, day);
    }
    const digest: Digest = d
      ? { ...d, key: `test:${today}`, kind: 'test', subject: `【测试】${d.subject}` }
      : { key: `test:${today}`, kind: 'test', subject: '【测试】订阅提醒已就绪', intro: '邮件通道工作正常。', sections: [] };
    return json(await sendDigest(env, state, digest, { force: true }));
  }
  return bad('not found', 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, env, url.pathname);
      const cal = url.pathname.match(/^\/cal\/([a-f0-9]{32})\.ics$/);
      if (cal) {
        const state = await loadState(env);
        if (!state.settings.icsToken || state.settings.icsToken !== cal[1]) return new Response('not found', { status: 404 });
        return new Response(buildIcs(state, env.SITE_URL), {
          headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=1800' },
        });
      }
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return bad('server error', 500);
    }
  },

  async scheduled(_: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const fx = await getFx(env);
    if (Date.now() - Date.parse(fx.fetchedAt) > 20 * 3_600_000) {
      ctx.waitUntil(refreshFx(env).catch((e) => console.error('[fx]', e)));
    }
    const log = await runScheduled(env, await loadState(env));
    if (log.length) console.log('[notify]', log.join('; '));
  },
} satisfies ExportedHandler<Env>;
