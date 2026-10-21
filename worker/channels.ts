// 通知渠道：同一份提醒，按各家机器人 / 推送服务的格式发出去。
// 邮件依赖 Cloudflare Email Sending；没有的话，Telegram、飞书、钉钉、企业微信、Bark、ntfy、Server酱、Discord、Slack、通用 Webhook 任选。
import { esc, relDays } from '../shared/format.ts';
import { t } from '../shared/i18n.ts';
import type { Channel } from '../shared/types.ts';
import { renderEmail } from './email.ts';
import type { Env } from './env.ts';
import type { Digest, Row, Section } from './notify.ts';

/** 金额：原币，后面带上折合本位币 */
const amountOf = (r: Row) => [r.amount, r.amountSub ? `(${r.amountSub})` : ''].filter(Boolean).join(' ');
/** 小节标题带上条数 */
const headingOf = (s: Section) => `${s.heading} · ${s.rows.length}`;
/** 说明：没有专门的 detail 时用 sub；有距今天数时补在前面，附加提示放最后 */
const metaOf = (r: Row) => [r.detail && r.days != null ? relDays(r.days) : '', r.detail ?? r.sub, r.note].filter(Boolean).join(' · ');

/** 纯文本：Bark、ntfy、通用 Webhook 等用 */
function toText(d: Digest, siteUrl: string): string {
  const lines = [d.intro, ''];
  if (d.stats?.length) lines.push(d.stats.map((x) => `${x.label} ${x.value}`).join(' · '), '');
  for (const s of d.sections) {
    lines.push(t('notify.text.heading', { heading: headingOf(s) }));
    for (const r of s.rows) {
      const meta = metaOf(r);
      lines.push(`· ${r.title}${r.amount ? `  ${amountOf(r)}` : ''}${meta ? `\n  ${meta}` : ''}`);
    }
    if (s.total) lines.push(`${s.total.label}  ${s.total.amount}`);
    lines.push('');
  }
  lines.push(`${siteUrl}/`);
  return lines.join('\n').trim();
}

/** 各家 Markdown 方言里的灰色小字；不支持颜色的原样输出 */
type Grey = (s: string) => string;
const plain: Grey = (s) => s;
const GREY = {
  lark: (s: string) => `<font color='grey'>${s}</font>`,
  wecom: (s: string) => `<font color="comment">${s}</font>`,
  dingtalk: (s: string) => `<font color=#8a8a8a>${s}</font>`,
} satisfies Record<string, Grey>;

/** 一个小节的 Markdown：标题带条数，每条一行（名称、金额、折合，说明用灰色），月度账单附合计 */
function sectionMarkdown(s: Section, grey: Grey): string {
  const out = [`**${headingOf(s)}**`];
  for (const r of s.rows) {
    const meta = metaOf(r);
    out.push(`- **${r.title}**${r.amount ? `　${r.amount}` : ''}${r.amountSub ? ` ${grey(r.amountSub)}` : ''}${meta ? `　${grey(meta)}` : ''}`);
  }
  if (s.total) out.push(`**${s.total.label}　${s.total.amount}**`);
  return out.join('\n');
}

/** Markdown：钉钉、企业微信、Discord、Server酱、Slack */
function toMarkdown(d: Digest, siteUrl: string, grey: Grey = plain): string {
  const out = [d.intro];
  if (d.stats?.length) out.push(d.stats.map((x) => `${x.label} **${x.value}**`).join('　'));
  for (const s of d.sections) out.push(sectionMarkdown(s, grey));
  out.push(`[${t('notify.email.open')} →](${siteUrl}/)`);
  return out.join('\n\n').trim();
}

/** 飞书卡片：导语、各小节之间用分隔线，底部一个打开后台的按钮 */
function toLarkCard(d: Digest, siteUrl: string) {
  const blocks: unknown[] = [{ tag: 'markdown', content: d.intro }];
  if (d.stats?.length) blocks.push({ tag: 'markdown', content: d.stats.map((x) => `${x.label} **${x.value}**`).join('　') });
  for (const s of d.sections) blocks.push({ tag: 'hr' }, { tag: 'markdown', content: sectionMarkdown(s, GREY.lark) });
  blocks.push({
    tag: 'action',
    actions: [{ tag: 'button', text: { tag: 'plain_text', content: t('notify.email.open') }, type: 'primary', url: `${siteUrl}/` }],
  });
  return {
    config: { wide_screen_mode: true },
    header: { template: d.kind === 'test' ? 'grey' : 'blue', title: { tag: 'plain_text', content: d.subject } },
    elements: blocks,
  };
}

/** Telegram 的 HTML 子集 */
function toTelegram(d: Digest, siteUrl: string): string {
  const out = [`<b>${esc(d.subject)}</b>`, esc(d.intro), ''];
  if (d.stats?.length) out.push(d.stats.map((x) => `${esc(x.label)} <b>${esc(x.value)}</b>`).join(' · '), '');
  for (const s of d.sections) {
    out.push(`<b>${esc(headingOf(s))}</b>`);
    for (const r of s.rows) {
      const meta = metaOf(r);
      out.push(
        `• <b>${esc(r.title)}</b>${r.amount ? `  <code>${esc(r.amount)}</code>` : ''}${r.amountSub ? ` ${esc(r.amountSub)}` : ''}${meta ? `\n  <i>${esc(meta)}</i>` : ''}`,
      );
    }
    if (s.total) out.push(`<b>${esc(s.total.label)}  ${esc(s.total.amount)}</b>`);
    out.push('');
  }
  out.push(`<a href="${esc(siteUrl)}/">${esc(t('notify.email.open'))} →</a>`);
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
  if (!okValues.includes(body[field]))
    throw new Error(`${field}=${String(body[field])} ${String(body.msg ?? body.errmsg ?? body.message ?? body.description ?? '')}`.trim());
}

/** field 是 notify.channel.field 下的键 */
const need = (c: Channel, k: string, field: string) => {
  const v = c.config[k]?.trim();
  if (!v) throw new Error(t('notify.channel.missing', { channel: c.name, field: t(`notify.channel.field.${field}`) }));
  return v;
};

/** 发一份提醒到一个渠道；失败时抛错，由调用方记录 */
export async function sendTo(env: Env, c: Channel, d: Digest): Promise<void> {
  const site = env.SITE_URL ?? '';
  switch (c.kind) {
    case 'email': {
      const to = need(c, 'to', 'to');
      if (!env.EMAIL || !env.MAIL_FROM) throw new Error(t('notify.channel.emailNotConfigured'));
      const { html, text } = renderEmail(d, site);
      await env.EMAIL.send({ from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || t('notify.sender') }, to, subject: d.subject, text, html });
      return;
    }
    case 'telegram': {
      const token = need(c, 'token', 'botToken');
      const res = await post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: need(c, 'chatId', 'chatId'),
        text: toTelegram(d, site),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
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
        card: toLarkCard(d, site),
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
      const res = await post(url, { msgtype: 'markdown', markdown: { title: d.subject, text: `### ${d.subject}\n\n${toMarkdown(d, site, GREY.dingtalk)}` } });
      return expectOk(res, 'errcode', [0]);
    }
    case 'wecom': {
      const res = await post(need(c, 'webhook', 'webhook'), {
        msgtype: 'markdown',
        markdown: { content: `### ${d.subject}\n${toMarkdown(d, site, GREY.wecom)}`.slice(0, 4000) },
      });
      return expectOk(res, 'errcode', [0]);
    }
    case 'bark': {
      const server = (c.config.server?.trim() || 'https://api.day.app').replace(/\/$/, '');
      await post(`${server}/push`, {
        device_key: need(c, 'key', 'deviceKey'),
        title: d.subject,
        body: toText(d, site),
        url: `${site}/`,
        group: t('notify.appName'),
      });
      return;
    }
    case 'ntfy': {
      const server = (c.config.server?.trim() || 'https://ntfy.sh').replace(/\/$/, '');
      const auth: Record<string, string> = c.config.token?.trim() ? { authorization: `Bearer ${c.config.token.trim()}` } : {};
      await post(server, { topic: need(c, 'topic', 'topic'), title: d.subject, message: toText(d, site), click: `${site}/`, markdown: false }, auth);
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
      await post(need(c, 'webhook', 'webhook'), {
        username: t('notify.appName'),
        embeds: [{ title: d.subject, description: toMarkdown(d, site).slice(0, 4000), url: `${site}/`, color: 0x3e63dd }],
      });
      return;
    }
    case 'slack': {
      const md = toMarkdown(d, site)
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/\[(.+?)\]\((.+?)\)/g, '<$2|$1>');
      await post(need(c, 'webhook', 'webhook'), { text: `*${d.subject}*\n${md}` });
      return;
    }
    case 'webhook': {
      const headers: Record<string, string> = {};
      if (c.config.header?.includes(':')) {
        const [k, ...v] = c.config.header.split(':');
        headers[k.trim()] = v.join(':').trim();
      }
      await post(
        need(c, 'url', 'url'),
        { subject: d.subject, intro: d.intro, kind: d.kind, sections: d.sections, text: toText(d, site), markdown: toMarkdown(d, site), url: `${site}/` },
        headers,
      );
      return;
    }
  }
}
