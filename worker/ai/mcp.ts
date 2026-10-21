// MCP 服务器：让 Codex、Claude、Cursor 等 AI 助手通过 /mcp 读写账本。
// 传输：Streamable HTTP 的无状态模式——每个 POST 是一条 JSON-RPC 请求，直接返回 JSON，不开 SSE、不保留会话。
// 鉴权：Authorization: Bearer <令牌>；令牌在后台「AI」页生成，库里只存 SHA-256，分只读 / 读写两种权限。
import { randomToken, sha256 } from '../auth.ts';
import type { Env } from '../env.ts';
import { getKv, getSettings, putKv } from '../store.ts';
import { TOOLS, toolTitle, type ToolCtx } from './mcp-tools.ts';
import { t } from '../../shared/i18n.ts';

export interface McpToken {
  id: string;
  name: string;
  hash: string;
  /** 明文前 8 位，方便在列表里认出是哪个 */
  prefix: string;
  scope: 'read' | 'write';
  createdAt: string;
  lastUsedAt?: string;
}

const KEY = 'mcpTokens';
const PROTOCOL = '2025-06-18';
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

export async function listTokens(env: Env): Promise<McpToken[]> {
  return (await getKv<McpToken[]>(env, KEY)) ?? [];
}

/** 新建令牌：明文只在这一次返回 */
export async function createToken(env: Env, name: string, scope: 'read' | 'write'): Promise<{ token: string; item: McpToken }> {
  const token = `sub_${randomToken(24)}`;
  const item: McpToken = {
    id: randomToken(6),
    name: name.trim().slice(0, 40) || t('mcp.defaultTokenName'),
    hash: await sha256(token),
    prefix: token.slice(0, 12),
    scope,
    createdAt: new Date().toISOString(),
  };
  await putKv(env, KEY, [...(await listTokens(env)), item]);
  return { token, item };
}

export async function revokeToken(env: Env, id: string): Promise<void> {
  await putKv(
    env,
    KEY,
    (await listTokens(env)).filter((x) => x.id !== id),
  );
}

/** 校验请求里的令牌；通过时顺手记下最后使用时间（同一小时内不重复写） */
async function authenticate(req: Request, env: Env): Promise<McpToken | undefined> {
  const raw = req.headers
    .get('authorization')
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  if (!raw) return undefined;
  const hash = await sha256(raw);
  const tokens = await listTokens(env);
  const tk = tokens.find((x) => x.hash === hash);
  if (!tk) return undefined;
  const now = new Date().toISOString();
  if (!tk.lastUsedAt || now.slice(0, 13) !== tk.lastUsedAt.slice(0, 13)) {
    tk.lastUsedAt = now;
    await putKv(env, KEY, tokens);
  }
  return tk;
}

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };
const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(msg: Rpc, env: Env, token: McpToken): Promise<unknown | undefined> {
  // 通知（没有 id）只需确认收到
  if (msg.id === undefined) return undefined;
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? PROTOCOL);
      return ok(msg.id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'calends', title: t('mcp.serverTitle'), version: '1.0.0' },
        instructions: t('mcp.instructions'),
      });
    }
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, {
        tools: TOOLS.filter((x) => token.scope === 'write' || !x.write).map((x) => ({
          name: x.name,
          title: toolTitle(x.name),
          description: x.description,
          inputSchema: x.inputSchema,
          annotations: { readOnlyHint: !x.write, destructiveHint: !!x.destructive, idempotentHint: !x.write || !!x.idempotent, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const tool = TOOLS.find((x) => x.name === name);
      if (!tool) return fail(msg.id, -32602, t('mcp.error.noTool', { name }));
      if (tool.write && token.scope !== 'write') return ok(msg.id, { isError: true, content: [{ type: 'text', text: t('mcp.error.readOnly') }] });
      const ctx: ToolCtx = { env };
      try {
        const out = await tool.run((msg.params?.arguments ?? {}) as Record<string, unknown>, ctx);
        return ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out });
      } catch (e) {
        // 参数错误、找不到订阅这类问题作为工具结果返回，让 AI 能看到原因并改正
        return ok(msg.id, { isError: true, content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] });
      }
    }
    default:
      return fail(msg.id, -32601, t('mcp.error.unsupportedMethod', { method: msg.method }));
  }
}

export async function mcp(req: Request, env: Env): Promise<Response> {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  // 无状态服务器不提供服务端推送流
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: { ...cors, allow: 'POST' } });
  if ((await getSettings(env)).aiEnabled === false) return Response.json(fail(null, -32002, t('mcp.error.aiDisabled')), { status: 403, headers: cors });
  const token = await authenticate(req, env);
  if (!token) return Response.json(fail(null, -32001, t('mcp.error.badToken')), { status: 401, headers: { ...cors, 'www-authenticate': 'Bearer' } });
  let body: Rpc | Rpc[];
  try {
    body = (await req.json()) as Rpc | Rpc[];
  } catch {
    return Response.json(fail(null, -32700, t('mcp.error.parse')), { status: 400, headers: cors });
  }
  const list = Array.isArray(body) ? body : [body];
  const out = (await Promise.all(list.map((m) => handle(m, env, token)))).filter((x) => x !== undefined);
  if (!out.length) return new Response(null, { status: 202, headers: cors });
  return Response.json(Array.isArray(body) ? out : out[0], { headers: { ...cors, 'cache-control': 'no-store' } });
}
