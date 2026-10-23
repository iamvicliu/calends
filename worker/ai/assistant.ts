// AI 助手：用 DeepSeek 识别用户粘贴的文字、截图，整理成订阅草稿；查询与修改直接复用 MCP 工具。
// 写操作一律先 dry_run 出草稿，由用户在页面上确认后再经同一个工具真正执行。
import { todayIn } from '../../shared/billing.ts';
import { categoryList } from '../../shared/categories.ts';
import {
  applyLine,
  assistantMessage,
  configView,
  dropOldImages,
  emptyTurn,
  errorKind,
  normBaseUrl,
  parseArgs,
  userMessage,
  type ApiMessage,
  type AssistantConfig,
  type Effort,
  type ErrorKind,
  type Turn,
} from '../../shared/deepseek.ts';
import { locale, t } from '../../shared/i18n.ts';
import type { Env } from '../env.ts';
import { decodeEntities, searchAppStore, TOOLS, type Tool } from './mcp-tools.ts';
import { getKv, loadState, putKv } from '../store.ts';

const KEY = 'assistant';
/** 一次提问里最多跟模型来回几轮（每轮可能调用多个工具） */
const MAX_ROUNDS = 8;

/** Every ledger tool is available; writes are always drafted and only the apply endpoint saves. */
export const ASSISTANT_TOOLS: Tool[] = TOOLS;

export const getConfig = (env: Env) => getKv<AssistantConfig>(env, KEY);

export async function viewConfig(env: Env) {
  return configView(await getConfig(env));
}

/** 保存配置：apiKey 传空串表示保持不变，传 null 表示清除 */
export async function saveConfig(env: Env, b: { apiKey?: string | null; baseUrl?: string; model?: string; effort?: Effort }) {
  const cur = (await getConfig(env)) ?? {};
  const next: AssistantConfig = {
    apiKey: b.apiKey === null ? undefined : b.apiKey?.trim() || cur.apiKey,
    baseUrl: b.baseUrl !== undefined ? normBaseUrl(b.baseUrl) : cur.baseUrl,
    model: b.model !== undefined ? b.model.trim() || undefined : cur.model,
    effort: b.effort ?? cur.effort,
  };
  await putKv(env, KEY, next);
  return configView(next);
}

/** 测试连接：列出模型。返回可用的模型 id，或错误类别 */
export async function testConfig(env: Env, draft?: { apiKey?: string; baseUrl?: string }) {
  const c = (await getConfig(env)) ?? {};
  const apiKey = draft?.apiKey?.trim() || c.apiKey;
  if (!apiKey) return { ok: false, kind: 'config' as ErrorKind, message: t('server.assistant.noKey') };
  const base = normBaseUrl(draft?.baseUrl ?? c.baseUrl);
  try {
    const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
    const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id: string }>; error?: { message?: string } };
    if (!res.ok) return { ok: false, kind: errorKind(res.status), message: body.error?.message ?? `HTTP ${res.status}` };
    return { ok: true, models: (body.data ?? []).map((m) => m.id) };
  } catch (e) {
    return { ok: false, kind: 'network' as ErrorKind, message: e instanceof Error ? e.message : String(e) };
  }
}

/** 系统提示：今天、本位币、分类与支付方式，以及怎么把粘贴的内容整理成订阅 */
async function systemPrompt(env: Env): Promise<string> {
  const st = await loadState(env, false);
  const today = todayIn(st.settings.timezone);
  const cats = categoryList(st.settings, st.subscriptions).map((c) => c.name);
  const methods = st.methods.map((m) => `${m.id}: ${m.name} (${m.kind}, ${m.currency}${m.region ? `, ${m.region}` : ''})`);
  return [
    `You are the assistant inside Calends, the user's personal subscription ledger. Reply in the user's interface language (${locale()}), briefly and warmly; use Markdown sparingly (short lists, **bold** for key numbers).`,
    `Today is ${today} (${st.settings.timezone}). Base currency: ${st.settings.baseCurrency}.`,
    `Categories (reuse these exact names): ${cats.join(', ')}.`,
    `Payment methods (pass the id as "method"): ${methods.join('; ') || 'none'}. Default method id: ${st.settings.defaultMethodId ?? 'none'}.`,
    '',
    'You can maintain every non-security ledger entity: wallets (update_payment_method action=create/update/delete), categories (save_category), people (save_person), proxy relationships (set_proxy), receivables (record_receivable action=record/update/delete) and settings/preferences (get_settings/update_settings). Never access authentication, credentials, sessions/tokens, backups, resets, migrations or whole-ledger deletion.',
    'Main job: the user pastes receipts, App Store / Google Play emails, bank or SMS notices, subscription pages, invoices or screenshots. Extract every subscription in it and call create_subscription once per subscription.',
    '- Every write tool call is only a draft: the app shows it as a card and the user confirms it. Never ask the user to confirm in text, never repeat a call you already made, and do not claim anything was saved.',
    '- Read amounts exactly as shown, with the currency of the store or receipt (App Store Turkey → TRY and region TR). Price is per billing cycle; cycle unit day/week/month/year with every N.',
    '- start = the charge or purchase date shown; if only a renewal date is shown, use it as start. Trials: status "trial" and trial_end. A promotional first-period price: intro {price, until}.',
    '- Past and ended subscriptions (pasted notes, "used it for 3 years"): start = when it began — for "N years/months so far" count back from the latest charge on the stated billing day; month only → that month’s billing day, else day 1. Ended ("A – B", "cancelled in June 2022") → end = the last service day (inclusive; charges may still fall on that day). Earlier prices ("8 yuan at first, 18 since January") → create_subscription with the first price, then change_price on the returned id for each later price, in the same turn; region/plan switches → change_plan.',
    '- What the user states wins: never add an end date, change a price or drop a field because of an existing record; mention the overlap in your reply instead. Do not rename or recategorize an existing subscription unless asked.',
    '- Figures in replies (yearly cost, my share, per month) come from tool results such as get_carpool or get_subscription; do not do mental arithmetic.',
    '- Call list_categories first and reuse an existing category code/name. If the requested category is missing, use save_category action=create or explicitly pass create_category=true (optional category_icon/category_color). Unknown or ambiguous references fail. Pick the payment method that matches the card, store account or wallet mentioned; omit method if unclear.',
    '- Fill in as much as the input supports: name WITH the plan/tier (e.g. "Spotify Premium Family", "iCloud+ 200GB", "ChatGPT Plus"), price, currency, cycle, start, region, method, category, url, icon, account (the login email, phone number for carriers, or username shown), and notes for useful extras (order number, seats). Never leave out a field you can read or infer.',
    '- Icon and url are required for every app or service: call search_app_store (country = the store region, else us) and pass the matching result’s icon (prefer the 256x256 artwork) and url; for web-only services and ones that are not mainly an app (carriers, utilities, cloud hosting) use the official homepage as url. If nothing matches, still give the official url.',
    '- Bill tables and statements covering several months (one row per month, one column per service or line): each column/service is ONE subscription — never one per month or per amount. Keep each name exactly as written (fix only obvious typos such as "T-Moblie" → "T-Mobile"); never translate it or swap it for a different provider, and do not search the ledger under other names. start = its first month with an amount (billing day 1 unless a day is shown); months shown as —/blank are before it started or unknown, not charges. price = the latest month’s amount. Usage-based amounts that vary month to month are actual charges, not price changes: pass ALL of them in create_subscription.payments (every month listed, including ones equal to price), and do not call change_price or record_payment for them. Ignore total/sum columns. If no currency is shown, use the currency of the provider’s home market (T-Mobile, AT&T → USD; CUniq → HKD) and say in the reply which currency you assumed.',
    '- Before creating, check list_subscriptions for the same service; if it already exists, propose update_subscription / change_price / record_payment instead of a duplicate.',
    '- If a required field (price, currency or cycle) truly cannot be inferred, ask one short question instead of guessing.',
    '- Distinguish three ways to stop: non-renewal uses set_status cancel (immediate=false) with at as the last service day; voluntary early stopping uses cancel with immediate=true; provider-disabled access uses terminate with an optional reason. Immediate stops may include refund {amount,date?,settled?}; omit refund when none occurred. Terminated subscriptions must resubscribe using change_plan action=resume with a new phase, never reactivate. Refund currency must equal the subscription currency, and total refunds cannot exceed the current period paid amount.',
    '- Other changes use the matching tool: update_subscription (details), change_price (price change from a date), change_plan (switch plan/region), set_status (pause/cancel/terminate/reactivate), delete_subscription (remove completely), record_payment (a charge happened / refund).',
    '- Shared plans (合租/拼车): set_share to start or change sharing (seats include me) and to change the plan collection rule (rule: fee, bill_every; applies to members who follow it), save_share_member to add or edit a member (new members follow the rule by default; follow_rule=true/false switches between the rule and a custom fee per billing cycle, bill_every months), remove_share_member, record_receivable when a member paid me. get_carpool answers questions about a carpool: seats free, yearly cost vs. income, profit, who owes what.',
    '- Member fee dates: fee_from defaults to today when no date is requested. Each call changes one dated point; later fee_history points remain. For an ongoing custom rate, also replace conflicting later points with that rate in the same turn. Never move the requested/default start to a future date to avoid a scheduled change. A follow_rule switch without a requested date also starts today, using the stored rule.',
    '- Carpool collection: mid-period members align to the shared collection anchor; first_period defaults to prorate by actual days. For record_receivable, omit coverage and amount to use the member’s next unpaid collection; pass the actual amount when stated, even if different. Answer when to collect next and how much is pending from get_carpool results, never mental arithmetic.',
    '- For collection-rule previews, describe only returned fees, cycles, dates and member changes. Do not calculate annual income, savings or percentage changes unless a tool returns those metrics. Never label a larger after-value as a decrease.',
    '- Carpool details: if I use more than one seat myself, add one exempt member per extra seat (name e.g. "自己 · 第 2 台"). Money members already paid in the past → record_receivable for each payment with its date and amount, not just a note. If it is unclear whether an amount is per person or the total, take the reading that fits the other numbers and say which you chose.',
    '- History missing BEFORE an existing subscription’s start (e.g. it was a one-time purchase before it became a subscription) → change_plan action=earlier on that subscription; never create a separate subscription for it.',
    '- Drafts in the same turn build on each other: later tools already see earlier drafts (a new subscription’s id from create_subscription, a member just added). So do multi-step requests in ONE turn — e.g. create_subscription, then set_share on the returned id, then save_share_member for each member, then record_receivable. Never stop to ask the user to confirm an earlier card first; the user confirms all cards together, in order.',
    '- After the tool calls, reply with one or two sentences summarizing what you drafted. For questions about spending, use the read tools and answer with concrete numbers.',
  ].join('\n');
}

type Emit = (event: Record<string, unknown>) => void;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * 新增订阅的草稿补全：模型没给图标或链接时，按名称（和地区）查 App Store，
 * 名称对得上才采用，补上图标和链接，并告诉模型补了什么
 */
export async function enrichDraft(args: Record<string, unknown>): Promise<{ args: Record<string, unknown>; filled: string[] }> {
  const name = decodeEntities(String(args.name ?? '').trim());
  const fixed: Record<string, unknown> = { ...args, ...(args.name != null ? { name } : {}) };
  // App Store 图标给的是 100px，卡片上显得糊：换成 256px
  if (typeof fixed.icon === 'string') fixed.icon = fixed.icon.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/256x256bb.$1');
  args = fixed;
  if (!name || (args.icon && args.url)) return { args, filled: [] };
  const country = String(args.region ?? 'us').toLowerCase();
  const hits = await searchAppStore(name, country).catch(() => []);
  // 取名称的主干（去掉套餐名）去匹配 App 名
  const stem = norm(name.split(/\s+(premium|plus|pro|max|family|team|business|个人|家庭|会员|年费|月费)\b/i)[0] || name);
  const hit = hits.find((h) => stem.length >= 2 && (norm(h.name).startsWith(stem) || stem.startsWith(norm(h.name).slice(0, Math.max(3, stem.length)))));
  if (!hit) return { args, filled: [] };
  const filled: string[] = [];
  const out = { ...args };
  if (!out.icon && hit.icon) {
    out.icon = hit.icon.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/256x256bb.$1');
    filled.push('icon');
  }
  if (!out.url && hit.url) {
    out.url = hit.url;
    filled.push('url');
  }
  return { args: out, filled };
}

/** 调一次 DeepSeek（流式），边收边把思考和正文推给前端 */
async function complete(cfg: AssistantConfig, messages: ApiMessage[], emit: Emit, signal: AbortSignal): Promise<Turn> {
  const effort = cfg.effort ?? 'low';
  const res = await fetch(`${normBaseUrl(cfg.baseUrl)}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model || 'deepseek-flash',
      messages,
      tools: ASSISTANT_TOOLS.map((x) => ({ type: 'function', function: { name: x.name, description: x.description, parameters: x.inputSchema } })),
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: effort === 'none' ? 'disabled' : 'enabled' },
      ...(effort === 'none' ? {} : { reasoning_effort: effort }),
    }),
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw Object.assign(new Error(body.error?.message ?? `HTTP ${res.status}`), { kind: errorKind(res.status), status: res.status });
  }
  const turn = emptyTurn();
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      const d = applyLine(turn, line);
      if (d?.reasoning) emit({ type: 'reasoning', delta: d.reasoning });
      if (d?.text) emit({ type: 'text', delta: d.text });
    }
  }
  if (buf) applyLine(turn, buf);
  return turn;
}

/**
 * 一次提问：把用户这轮加进历史，和模型来回直到它不再调用工具。
 * 查询工具直接执行；写入工具强制 dry_run，草稿推给前端（proposal），等用户确认。
 * 结束时把这轮新增的消息（含 reasoning_content、工具调用与结果）推给前端，作为下一轮的历史。
 */
export function chat(env: Env, body: { history?: ApiMessage[]; text?: string; images?: string[] }, signal: AbortSignal): Response {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const enc = new TextEncoder();
  const emit: Emit = (ev) => void writer.write(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)).catch(() => {});

  void (async () => {
    const added: ApiMessage[] = [];
    try {
      const cfg = await getConfig(env);
      if (!cfg?.apiKey) throw Object.assign(new Error(t('server.assistant.noKey')), { kind: 'config' });
      const images = (body.images ?? []).filter((u) => typeof u === 'string' && u.startsWith('data:image/')).slice(0, 8);
      const user = userMessage(String(body.text ?? ''), images);
      added.push(user);
      const history = dropOldImages(Array.isArray(body.history) ? body.history : [], 0);
      // 这一问里的草稿叠在一起，后面的工具能看到前面的草稿
      const ctx = { env, overlay: new Map() };
      const drafted = new Set<string>();
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const messages: ApiMessage[] = [{ role: 'system', content: await systemPrompt(env) }, ...history, ...added];
        const turn = await complete(cfg, messages, emit, signal);
        added.push(assistantMessage(turn));
        if (turn.usage) emit({ type: 'usage', ...turn.usage });
        const calls = turn.toolCalls.filter(Boolean);
        if (!calls.length) break;
        emit({ type: 'step' });
        for (const call of calls) {
          const tool = ASSISTANT_TOOLS.find((x) => x.name === call.function.name);
          const { args, error: parseError } = parseArgs(call.function.arguments);
          // 同一问里重复出同一个写操作草稿：不再执行、不显示，直接告诉模型已经有了
          const sig = `${call.function.name}:${JSON.stringify({ ...args, dry_run: undefined })}`;
          if (tool?.write && drafted.has(sig)) {
            added.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ duplicate: true, note: 'This exact draft was already shown to the user in this turn. Do not call it again.' }),
            });
            continue;
          }
          if (tool?.write) drafted.add(sig);
          emit({ type: 'tool', id: call.id, name: call.function.name, args, status: 'running' });
          let content: string;
          try {
            if (!tool) throw new Error(`unknown tool ${call.function.name}`);
            if (parseError) throw new Error(`invalid arguments: ${parseError}`);
            if (tool.write) {
              const { args: full, filled } =
                tool.name === 'create_subscription' || tool.name === 'update_subscription' ? await enrichDraft(args) : { args, filled: [] as string[] };
              const draft = { ...full, dry_run: true };
              const preview = await tool.run(draft, ctx);
              const { dry_run: _d, ...clean } = draft as Record<string, unknown>;
              const pv = preview as {
                created?: { id: string };
                member?: { id: string; leave_refund?: { amount: number; currency: string; date: string; note?: string } | null };
                subscription?: { id?: string; members?: Array<{ id: string; name: string }> };
                receipt?: { amount: number; currency: string; date: string; from: string; until: string };
              };
              // 把默认收款展开到确认参数：卡片显示实际金额，确认时沿用预览的覆盖区间。
              if (tool.name === 'record_receivable' && pv.receipt) Object.assign(clean, pv.receipt);
              if (tool.name === 'save_share_member' && clean.leave_refund && pv.member?.leave_refund) clean.leave_refund = pv.member.leave_refund;
              if (pv.created) clean.id = pv.created.id;
              if (tool.name === 'create_subscription' && pv.subscription?.id) clean.id = pv.subscription.id;
              if (tool.name === 'save_share_member' && !clean.member && pv.member) clean.id = pv.member.id;
              emit({ type: 'tool', id: call.id, name: tool.name, args: clean, status: 'done' });
              emit({ type: 'proposal', id: call.id, tool: tool.name, args: clean, preview, filled });
              content = JSON.stringify({
                draft_shown_to_user: true,
                auto_filled: filled,
                note: 'Shown to the user as a card to confirm. Do not call again.',
                preview,
              });
            } else {
              const result = await tool.run(args, ctx);
              emit({ type: 'tool', id: call.id, name: tool.name, args, status: 'done', result });
              content = JSON.stringify(result);
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            emit({ type: 'tool', id: call.id, name: call.function.name, args, status: 'error', error: message });
            const deletedNow = [...ctx.overlay.values()].some((v) => v === null);
            content = JSON.stringify({
              error: message,
              ...(deletedNow ? { hint: 'Subscriptions you drafted for deletion in this turn are already hidden; that is expected. Do not retry.' } : {}),
            });
          }
          // 工具结果太长时截断，避免撑爆上下文
          added.push({ role: 'tool', tool_call_id: call.id, content: content.length > 24000 ? `${content.slice(0, 24000)}…` : content });
        }
      }
      emit({ type: 'done', messages: added });
    } catch (e) {
      const err = e as Error & { kind?: ErrorKind; status?: number };
      if (signal.aborted) emit({ type: 'done', messages: added, aborted: true });
      else emit({ type: 'error', kind: err.kind ?? 'network', status: err.status, message: err.message });
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(stream.readable, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
}

/** 用户确认草稿：经同一个 MCP 工具真正执行（不再 dry_run） */
export async function apply(env: Env, b: { tool?: string; args?: Record<string, unknown> }) {
  const tool = ASSISTANT_TOOLS.find((x) => x.name === b.tool && x.write);
  if (!tool) throw new Error(t('server.assistant.badTool'));
  return tool.run({ ...b.args, dry_run: false }, { env });
}

// ---------- 聊天记录：存在服务端，多台设备共用；「新对话」只是开新的一段，清空要在设置里明确操作 ----------

const CHAT_MAX = 1_500_000;

/** 全部对话，按开始时间从早到晚 */
export async function listChats(env: Env): Promise<unknown[]> {
  const rows = (await env.DB.prepare('SELECT id, data FROM chats').all<{ id: string; data: string }>()).results;
  return rows
    .map((r) => ({ id: r.id, ...(JSON.parse(r.data) as { createdAt?: string }) }))
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
}

/** 保存一个对话（整段覆盖）；过大的拒绝，免得一条对话撑爆数据库 */
export async function saveChat(env: Env, id: string, body: unknown): Promise<void> {
  const b = body as { createdAt?: unknown; turns?: unknown; history?: unknown } | null;
  if (!b || !Array.isArray(b.turns) || !Array.isArray(b.history)) throw new Error('invalid chat');
  const data = JSON.stringify({ createdAt: typeof b.createdAt === 'string' ? b.createdAt : new Date().toISOString(), turns: b.turns, history: b.history });
  if (data.length > CHAT_MAX) throw new Error('chat too large');
  await env.DB.prepare(
    `INSERT INTO chats (id, data, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(id, data)
    .run();
}

export async function clearChats(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM chats').run();
}
