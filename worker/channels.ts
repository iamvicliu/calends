// 通知渠道：同一份提醒，按各家机器人 / 推送服务的格式发出去。
// 邮件依赖 Cloudflare Email Sending；没有的话，Telegram、飞书、钉钉、企业微信、Bark、ntfy、Server酱、Discord、Slack、通用 Webhook 任选。
import { esc } from '../shared/format.ts';
import { t } from '../shared/i18n.ts';
import type { Channel } from '../shared/types.ts';
import type { Env } from './env.ts';
import { renderEmail, type Digest } from './notify.ts';

/** 纯文本：Telegram（HTML 前的回退）、Bark、ntfy 等用 */
export function toText(d: Digest, siteUrl: string): string {
  const lines = [d.intro, ''];
  for (const s of d.sections) {
    lines.push(t('notify.text.heading', { heading: s.heading }));
    for (const r of s.rows) lines.push(`· ${r.title}${r.amount ? `  ${r.amount}` : ''}${r.sub ? `\n  ${r.sub}` : ''}`);
    lines.push('');
  }
  lines.push(`${siteUrl}/admin`);
  return lines.join('\n').trim();
}

/** Markdown：飞书卡片、钉钉、企业微信、Discord、Server酱 */
export function toMarkdown(d: Digest, siteUrl: string): string {
  const b = (s: string) => `**${s}**`;
  const out = [d.intro, ''];
  for (const s of d.sections) {
    out.push(b(s.heading));
    for (const r of s.rows) out.push(`- ${r.title}${r.amount ? ` ${b(r.amount)}` : ''}${r.sub ? `　${r.sub}` : ''}`);
    out.push('');
  }
  out.push(`[${t('notify.email.open')}](${siteUrl}/admin)`);
  return out.join('\n').trim();
}

/** Telegram 的 HTML 子集 */
function toTelegram(d: Digest, siteUrl: string): string {
  const out = [`<b>${esc(d.subject)}</b>`, esc(d.intro), ''];
  for (const s of d.sections) {
    out.push(`<b>${esc(s.heading)}</b>`);
    for (const r of s.rows) out.push(`• ${esc(r.title)}${r.amount ? `  <code>${esc(r.amount)}</code>` : ''}${r.sub ? `\n  <i>${esc(r.sub)}</i>` : ''}`);
    out.push('');
  }
  out.push(`<a href="${siteUrl}/admin">${esc(t('notify.email.open'))}</a>`);
  return out.join('\n').trim().slice(0, 4000);
}

async function hmacBase64(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** 不少机器人接口出错也返回 200，要看返回体里的错误码 */
async function expectOk(res: Response, field: string, okValues: unknown[]): Promise<void> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!okValues.includes(body[field])) throw new Error(`${field}=${String(body[field])} ${String(body.msg ?? body.errmsg ?? body.message ?? body.description ?? '')}`.trim());
}

/** field 是 notify.channel.field 下的键 */
const need = (c: Channel, k: string, field: string) => {
  const v = c.config[k]?.trim();
  if (!v) throw new Error(t('notify.channel.missing', { channel: c.name, field: t(`notify.channel.field.${field}`) }));
  return v;
};

/** 发一份提醒到一个渠道；失败时抛错，由调用方记录 */
export async function sendTo(env: Env, c: Channel, d: Digest): Promise<void> {
  const site = env.SITE_URL;
  switch (c.kind) {
    case 'email': {
      const to = need(c, 'to', 'to');
      const { html, text } = renderEmail(d, site);
      await env.EMAIL.send({ from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME }, to, subject: d.subject, text, html });
      return;
    }
    case 'telegram': {
      const token = need(c, 'token', 'botToken');
      const res = await post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: need(c, 'chatId', 'chatId'), text: toTelegram(d, site), parse_mode: 'HTML', disable_web_page_preview: true });
      return expectOk(res, 'ok', [true]);
    }
    case 'lark': {
      // 飞书 / Lark 自定义机器人：可选签名校验（timestamp + "\n" + secret 作为 HMAC 的 key，对空串签名）
      const url = need(c, 'webhook', 'webhook');
      const secret = c.config.secret?.trim();
      const ts = Math.floor(Date.now() / 1000).toString();
      const sign = secret ? { timestamp: ts, sign: await hmacBase64(`${ts}\n${secret}`, '') } : {};
      const res = await post(url, {
        ...sign,
        msg_type: 'interactive',
        card: { config: { wide_screen_mode: true }, header: { template: 'blue', title: { tag: 'plain_text', content: d.subject } }, elements: [{ tag: 'markdown', content: toMarkdown(d, site) }] },
      });
      return expectOk(res, 'code', [0, undefined]);
    }
    case 'dingtalk': {
      // 钉钉群机器人：加签时 sign = base64(HMAC-SHA256(secret, timestamp + "\n" + secret))，拼在 URL 上
      let url = need(c, 'webhook', 'webhook');
      const secret = c.config.secret?.trim();
      if (secret) {
        const ts = Date.now().toString();
        url += `${url.includes('?') ? '&' : '?'}timestamp=${ts}&sign=${encodeURIComponent(await hmacBase64(secret, `${ts}\n${secret}`))}`;
      }
      const res = await post(url, { msgtype: 'markdown', markdown: { title: d.subject, text: `### ${d.subject}\n\n${toMarkdown(d, site)}` } });
      return expectOk(res, 'errcode', [0]);
    }
    case 'wecom': {
      const res = await post(need(c, 'webhook', 'webhook'), { msgtype: 'markdown', markdown: { content: `**${d.subject}**\n${toMarkdown(d, site)}`.slice(0, 4000) } });
      return expectOk(res, 'errcode', [0]);
    }
    case 'bark': {
      const server = (c.config.server?.trim() || 'https://api.day.app').replace(/\/$/, '');
      await post(`${server}/push`, { device_key: need(c, 'key', 'deviceKey'), title: d.subject, body: toText(d, site), url: `${site}/admin`, group: t('notify.appName') });
      return;
    }
    case 'ntfy': {
      const server = (c.config.server?.trim() || 'https://ntfy.sh').replace(/\/$/, '');
      const auth: Record<string, string> = c.config.token?.trim() ? { authorization: `Bearer ${c.config.token.trim()}` } : {};
      await post(server, { topic: need(c, 'topic', 'topic'), title: d.subject, message: toText(d, site), click: `${site}/admin`, markdown: false }, auth);
      return;
    }
    case 'serverchan': {
      const key = need(c, 'key', 'sendKey');
      // sctp 开头的是 Server酱³，地址不同
      const m = key.match(/^sctp(\d+)t/);
      const url = m ? `https://${m[1]}.push.ft07.com/send/${key}.send` : `https://sctapi.ftqq.com/${key}.send`;
      const res = await post(url, { title: d.subject, desp: toMarkdown(d, site) });
      return expectOk(res, 'code', [0]);
    }
    case 'discord': {
      await post(need(c, 'webhook', 'webhook'), { username: t('notify.appName'), embeds: [{ title: d.subject, description: toMarkdown(d, site).slice(0, 4000), url: `${site}/admin`, color: 0x1d2328 }] });
      return;
    }
    case 'slack': {
      const md = toMarkdown(d, site).replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/\[(.+?)\]\((.+?)\)/g, '<$2|$1>');
      await post(need(c, 'webhook', 'webhook'), { text: `*${d.subject}*\n${md}` });
      return;
    }
    case 'webhook': {
      const headers: Record<string, string> = {};
      if (c.config.header?.includes(':')) {
        const [k, ...v] = c.config.header.split(':');
        headers[k.trim()] = v.join(':').trim();
      }
      await post(need(c, 'url', 'url'), { subject: d.subject, intro: d.intro, kind: d.kind, sections: d.sections, text: toText(d, site), markdown: toMarkdown(d, site), url: `${site}/admin` }, headers);
      return;
    }
  }
}
