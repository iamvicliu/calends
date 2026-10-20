import { addDays, subError, todayIn } from '../shared/billing.ts';
import { DEFAULT_SETTINGS, type Channel, type FxTable, type PaymentMethod, type Settings, type Subscription } from '../shared/types.ts';
import { DEFAULT_MAX_SESSIONS, authStatus, changePassword, deletePasskey, isAuthed, listPasskeys, listSessions, login, logout, logoutOthers, passkeyLoginOptions, passkeyLoginVerify, passkeyRegisterOptions, passkeyRegisterVerify, pruneSessions, randomToken, revokeSession, sameOrigin, setup } from './auth.ts';
import { maskForPublic } from '../shared/mask.ts';
import type { Env } from './env.ts';
import { backfill, fxStatus, recordToday } from './fx.ts';
import { buildIcs } from './ics.ts';
import { buildDaily, buildMonthly, renderEmail, runScheduled, sendDigest, type Digest } from './notify.ts';
import { getFx, getSettings, loadState, putKv, remove, replaceAll, upsert } from './store.ts';
import { createToken, listTokens, mcp, revokeToken } from './mcp.ts';
import { TOOLS, toolTitle } from './mcp-tools.ts';
import { exportAll, parseBackup, restoreAll } from './backup.ts';
import { requestLocale, settingsLocale, useLocale } from './i18n.ts';
import { t } from '../shared/i18n.ts';

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const bad = (msg: string, status = 400) => json({ error: msg }, status);

async function refreshFx(env: Env): Promise<FxTable> {
  const res = await fetch('https://open.er-api.com/v6/latest/USD', { cf: { cacheTtl: 3600 } });
  const body = (await res.json()) as { result?: string; rates?: Record<string, number> };
  if (body.result !== 'success' || !body.rates) throw new Error(t('server.fxApiError'));
  const fx: FxTable = { base: 'USD', rates: body.rates, fetchedAt: new Date().toISOString() };
  await putKv(env, 'fx', fx);
  await recordToday(env, fx, (await getSettings(env)).timezone);
  return fx;
}

function validSub(s: Subscription): string | undefined {
  if (!s || typeof s.id !== 'string' || !s.id) return t('server.missingId');
  return subError(s);
}

/** 批量导入时第一条不合格的订阅 */
function invalidIn(subs: Subscription[]): string | undefined {
  for (const s of subs) {
    const err = validSub(s);
    if (err) return t('server.invalidItem', { name: s?.name ?? '?', error: err });
  }
  return undefined;
}

async function api(req: Request, env: Env, path: string): Promise<Response> {
  const method = req.method;
  if (path === '/api/login' && method === 'POST') return login(req, env);
  if (path === '/api/logout' && method === 'POST') return logout(req, env);
  // 登录前可用：状态、首次设置、Passkey 登录
  if (path === '/api/auth/status' && method === 'GET') return authStatus(env);
  // 本地开发免登录：DEV_BYPASS_AUTH 只写在 .dev.vars（不随部署上传）。
  // wrangler dev 会把请求 URL 改写成线上路由域名，所以这里无法按 localhost 判断。
  const dev = env.DEV_BYPASS_AUTH === '1';
  if (method === 'POST' && path.startsWith('/api/auth/') && !dev && !sameOrigin(req)) return bad('forbidden', 403);
  if (path === '/api/auth/setup' && method === 'POST') return setup(req, env);
  if (path === '/api/auth/passkey/login/options' && method === 'POST') return passkeyLoginOptions(req, env);
  if (path === '/api/auth/passkey/login' && method === 'POST') return passkeyLoginVerify(req, env);

  const authed = dev || (await isAuthed(req, env));
  if (path === '/api/public' && method === 'GET') {
    const state = await loadState(env);
    if (!state.settings.publicView && !dev) return bad(t('server.notPublic'), 404);
    return json(maskForPublic(state));
  }
  if (path === '/api/state' && method === 'GET') {
    const state = await loadState(env);
    // 后台数据只给登录用户；访客的公开数据走 /api/public
    if (authed) return json(state);
    return bad('unauthorized', 401);
  }
  if (!authed) return bad('unauthorized', 401);
  if (method !== 'GET' && !dev && !sameOrigin(req)) return bad('forbidden', 403);

  // 图片中转：分享图要把订阅图标画进 canvas，跨域图片会污染画布，所以经同源转一道。只转 https 的图片，限 1MB
  if (path === '/api/img' && method === 'GET') {
    const u = new URL(req.url).searchParams.get('u') ?? '';
    if (!/^https:\/\//.test(u)) return bad('bad url', 400);
    const res = await fetch(u, { cf: { cacheTtl: 86400, cacheEverything: true } });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return bad('not an image', 502);
    const body = await res.arrayBuffer();
    if (body.byteLength > 1_000_000) return bad('too large', 413);
    return new Response(body, { headers: { 'content-type': type, 'cache-control': 'private, max-age=86400' } });
  }
  // 已登录：账号安全
  if (path === '/api/auth/security' && method === 'GET') return json({ passkeys: await listPasskeys(env), sessions: await listSessions(req, env) });
  const sess = path.match(/^\/api\/auth\/sessions\/(\w+)$/);
  if (sess && method === 'DELETE') return revokeSession(req, env, sess[1]);
  if (path === '/api/auth/password' && method === 'POST') return changePassword(req, env);
  if (path === '/api/auth/logout-others' && method === 'POST') return logoutOthers(req, env);
  if (path === '/api/auth/passkey/register/options' && method === 'POST') return passkeyRegisterOptions(req, env);
  if (path === '/api/auth/passkey/register' && method === 'POST') return passkeyRegisterVerify(req, env);
  const pk = path.match(/^\/api\/auth\/passkey\/([\w-]+)$/);
  if (pk && method === 'DELETE') {
    await deletePasskey(env, pk[1]);
    return json({ ok: true });
  }
  // MCP 令牌管理（后台「AI」页）：明文只在新建时返回一次
  if (path === '/api/mcp/tools' && method === 'GET') return json(TOOLS.map((x) => ({ name: x.name, title: toolTitle(x.name), description: x.description, write: !!x.write })));
  if (path === '/api/mcp/tokens' && method === 'GET') return json((await listTokens(env)).map(({ hash: _h, ...rest }) => rest));
  if (path === '/api/mcp/tokens' && method === 'POST') {
    const b = (await req.json()) as { name?: string; scope?: string };
    const { token, item } = await createToken(env, b.name ?? '', b.scope === 'read' ? 'read' : 'write');
    const { hash: _h, ...rest } = item;
    return json({ token, item: rest });
  }
  const tm = path.match(/^\/api\/mcp\/tokens\/([\w-]+)$/);
  if (tm && method === 'DELETE') {
    await revokeToken(env, tm[1]);
    return json({ ok: true });
  }
  let m = path.match(/^\/api\/subscriptions\/([\w-]+)$/);
  if (m) {
    if (method === 'PUT') {
      const sub = (await req.json()) as Subscription;
      if (sub.id !== m[1]) return bad(t('server.idMismatch'));
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
      if (pm.id !== m[1] || !pm.name?.trim()) return bad(t('server.invalidMethod'));
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
    // null 表示清空这个设置
    for (const k of Object.keys(next) as Array<keyof Settings>) if (next[k] === null) delete next[k];
    next.notifyHour = Math.min(23, Math.max(0, Math.round(next.notifyHour)));
    if (next.maxSessions !== undefined) next.maxSessions = Math.min(50, Math.max(1, Math.round(next.maxSessions)));
    await putKv(env, 'settings', next);
    if (next.maxSessions !== cur.maxSessions) await pruneSessions(req, env, next.maxSessions ?? DEFAULT_MAX_SESSIONS);
    return json(next);
  }
  if (path === '/api/ics/rotate' && method === 'POST') {
    const cur = await getSettings(env);
    const next = { ...cur, icsToken: randomToken(16) };
    await putKv(env, 'settings', next);
    return json(next);
  }
  // 完整备份：导出文件可在全新部署上原样恢复
  if (path === '/api/backup' && method === 'GET') {
    const b = await exportAll(env);
    return new Response(JSON.stringify(b, null, 1), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="ledger-backup-${b.exportedAt.slice(0, 10)}.json"`, 'cache-control': 'no-store' } });
  }
  if (path === '/api/backup' && method === 'POST') {
    let b;
    try {
      b = parseBackup(await req.json());
    } catch (e) {
      return bad(e instanceof Error ? e.message : t('server.invalidBackup'));
    }
    const err = invalidIn(b.subscriptions);
    if (err) return bad(err);
    return json({ restored: await restoreAll(env, b), state: await loadState(env) });
  }
  if (path === '/api/import' && method === 'POST') {
    const body = (await req.json()) as { subscriptions?: Subscription[]; methods?: PaymentMethod[]; settings?: Partial<Settings>; mode?: 'merge' | 'replace' };
    const subs = body.subscriptions ?? [];
    const err = invalidIn(subs);
    if (err) return bad(err);
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
      return bad(e instanceof Error ? e.message : t('server.refreshFailed'), 502);
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
    const body = (await res.json().catch(() => ({}))) as { results?: Array<Record<string, unknown>> };
    return json({
      results: (body.results ?? []).map((r) => ({
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
      d = buildDaily(state, addDays(today, i));
    }
    const digest: Digest = d
      ? { ...d, key: `test:${today}`, kind: 'test', subject: t('notify.test.subject', { subject: d.subject }), title: undefined }
      : { key: `test:${today}`, kind: 'test', subject: t('notify.test.sampleSubject'), intro: t('notify.test.sampleIntro'), sections: [] };
    // 可以只测某一个渠道；传入 channel 对象时测试还没保存的配置
    const body = (await req.json().catch(() => ({}))) as { channel?: Channel | string };
    if (body.channel && typeof body.channel === 'object') {
      const c = body.channel;
      return json(await sendDigest(env, { ...state, settings: { ...state.settings, channels: [c] } }, digest, { force: true, only: c.id }));
    }
    return json(await sendDigest(env, state, digest, { force: true, only: typeof body.channel === 'string' ? body.channel : undefined }));
  }
  return bad('not found', 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      // 公开页、静态资源不需要文案；接口、MCP、日历订阅按请求或设置切换语言
      if (url.pathname.startsWith('/api/') || url.pathname === '/mcp' || url.pathname.startsWith('/cal/')) {
        const s = await getSettings(env);
        useLocale(url.pathname === '/mcp' ? settingsLocale(s) : requestLocale(req, s));
      }
      if (url.pathname.startsWith('/api/')) return await api(req, env, url.pathname);
      if (url.pathname === '/mcp') return await mcp(req, env);
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
    const state = await loadState(env);
    useLocale(settingsLocale(state.settings));
    const log = await runScheduled(env, state);
    if (log.length) console.log('[notify]', log.join('; '));
  },
} satisfies ExportedHandler<Env>;
