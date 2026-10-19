import type { Env } from './env.ts';

const COOKIE = 'sid';
const SESSION_DAYS = 180;
const MAX_FAILS = 6;
const WINDOW_MS = 15 * 60_000;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export { randomToken };

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

export async function isAuthed(req: Request, env: Env): Promise<boolean> {
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const row = await env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?1')
    .bind(await sha256(token))
    .first<{ expires_at: number }>();
  return !!row && row.expires_at > Date.now();
}

/** 定长比较，避免按位泄露口令 */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function login(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const now = Date.now();
  const rec = await env.DB.prepare('SELECT fails, window_start FROM login_attempts WHERE ip = ?1').bind(ip).first<{ fails: number; window_start: number }>();
  if (rec && now - rec.window_start < WINDOW_MS && rec.fails >= MAX_FAILS) {
    return Response.json({ error: '尝试过多，请 15 分钟后再试' }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { passcode?: string };
  if (!env.OWNER_PASSCODE || !body.passcode || !(await safeEqual(body.passcode, env.OWNER_PASSCODE))) {
    const fresh = !rec || now - rec.window_start >= WINDOW_MS;
    await env.DB.prepare(
      'INSERT INTO login_attempts (ip, fails, window_start) VALUES (?1, 1, ?2) ON CONFLICT(ip) DO UPDATE SET fails = ?3, window_start = ?4',
    )
      .bind(ip, now, fresh ? 1 : rec!.fails + 1, fresh ? now : rec!.window_start)
      .run();
    return Response.json({ error: '口令不正确' }, { status: 401 });
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?1').bind(ip).run();
  const token = randomToken();
  const expires = now + SESSION_DAYS * 86_400_000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, expires_at, user_agent) VALUES (?1, ?2, ?3)').bind(
      await sha256(token),
      expires,
      (req.headers.get('user-agent') ?? '').slice(0, 200),
    ),
  ]);
  return Response.json(
    { ok: true },
    { headers: { 'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` } },
  );
}

export async function logout(req: Request, env: Env): Promise<Response> {
  const token = readCookie(req, COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256(token)).run();
  return Response.json({ ok: true }, { headers: { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
}

/** 写操作必须同源（SameSite=Lax 之外再加一道） */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  return new URL(origin).host === new URL(req.url).host;
}
