// AI 助手：用 DeepSeek 识别用户粘贴的文字、截图，整理成订阅草稿；查询与修改直接复用 MCP 工具。
// 写操作一律先 dry_run 出草稿，由用户在页面上确认后再经同一个工具真正执行。
import { todayIn } from '../shared/billing.ts';
import { categoryList } from '../shared/categories.ts';
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
} from '../shared/deepseek.ts';
import { locale, t } from '../shared/i18n.ts';
import type { Env } from './env.ts';
import { searchAppStore, TOOLS, type Tool } from './mcp-tools.ts';
import { getKv, loadState, putKv } from './store.ts';

const KEY = 'assistant';
/** 一次提问里最多跟模型来回几轮（每轮可能调用多个工具） */
const MAX_ROUNDS = 8;

/** 给模型用的工具：查询类全部开放；写入类只开放常用的几个，而且只出草稿 */
const READ = TOOLS.filter((x) => !x.write);
const WRITE = new Set(['create_subscription', 'update_subscription', 'change_price', 'change_plan', 'set_status', 'record_payment']);
const ASSISTANT_TOOLS: Tool[] = [...READ, ...TOOLS.filter((x) => WRITE.has(x.name))];

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
  const st = await loadState(env);
  const today = todayIn(st.settings.timezone);
  const cats = categoryList(st.settings, st.subscriptions).map((c) => c.name);
  const methods = st.methods.map((m) => `${m.id}: ${m.name} (${m.kind}, ${m.currency}${m.region ? `, ${m.region}` : ''})`);
  return [
    `You are the assistant inside Calends, the user's personal subscription ledger. Reply in the user's interface language (${locale()}), briefly and warmly; use Markdown sparingly (short lists, **bold** for key numbers).`,
    `Today is ${today} (${st.settings.timezone}). Base currency: ${st.settings.baseCurrency}.`,
    `Categories (reuse these exact names): ${cats.join(', ')}.`,
    `Payment methods (pass the id as "method"): ${methods.join('; ') || 'none'}. Default method id: ${st.settings.defaultMethodId ?? 'none'}.`,
    '',
    'Main job: the user pastes receipts, App Store / Google Play emails, bank or SMS notices, subscription pages, invoices or screenshots. Extract every subscription in it and call create_subscription once per subscription.',
    '- Every write tool call is only a draft: the app shows it as a card and the user confirms it. Never ask the user to confirm in text, never repeat a call you already made, and do not claim anything was saved.',
    '- Read amounts exactly as shown, with the currency of the store or receipt (App Store Turkey → TRY and region TR). Price is per billing cycle; cycle unit day/week/month/year with every N.',
    '- start = the charge or purchase date shown; if only a renewal date is shown, use it as start. Trials: status "trial" and trial_end. A promotional first-period price: intro {price, until}.',
    '- Pick the closest category from the list and the payment method that matches the card, store account or wallet mentioned; omit method if unclear.',
    '- Fill in as much as the input supports: name WITH the plan/tier (e.g. "Spotify Premium Family", "iCloud+ 200GB", "ChatGPT Plus"), price, currency, cycle, start, region, method, category, url, icon, and notes for useful extras (order number, account email domain, seats). Never leave out a field you can read or infer.',
    '- Icon and url are required for every app or service: call search_app_store (country = the store region, else us) and pass the matching result’s icon (prefer the 256x256 artwork) and url; for web-only services use the official homepage as url. If nothing matches, still give the official url.',
    '- Before creating, check list_subscriptions for the same service; if it already exists, propose update_subscription / change_price / record_payment instead of a duplicate.',
    '- If a required field (price, currency or cycle) truly cannot be inferred, ask one short question instead of guessing.',
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
  const name = String(args.name ?? '').trim();
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
      const ctx = { env };
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
          emit({ type: 'tool', id: call.id, name: call.function.name, args, status: 'running' });
          let content: string;
          try {
            if (!tool) throw new Error(`unknown tool ${call.function.name}`);
            if (parseError) throw new Error(`invalid arguments: ${parseError}`);
            if (tool.write) {
              const { args: full, filled } = tool.name === 'create_subscription' ? await enrichDraft(args) : { args, filled: [] as string[] };
              const draft = { ...full, dry_run: true };
              const preview = await tool.run(draft, ctx);
              const { dry_run: _d, ...clean } = draft;
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
            content = JSON.stringify({ error: message });
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
