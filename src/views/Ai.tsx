import { useEffect, useState } from 'preact/hooks';
import type { AppState } from '../../shared/types.ts';
import { Icon, Sheet, Toggle, Toolbar } from '../components/ui.tsx';
import { api, run, saveSettings, toast } from '../store.ts';
import { confirmDelete } from './Editor.tsx';
import { localTime } from '../../shared/format.ts';
import { t } from '../../shared/i18n.ts';

interface Token {
  id: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write';
  createdAt: string;
  lastUsedAt?: string;
}
interface ToolMeta {
  name: string;
  title?: string;
  description: string;
  write: boolean;
}

/** 一个接入客户端：标志、配置写在哪、配置内容；有官方一键安装链接的也给出来 */
interface Client {
  id: string;
  name: string;
  logo: string;
  /** 代码块的语言提示（只用来显示角标） */
  lang: 'shell' | 'json' | 'yaml' | 'http';
  /** 配置放在哪里（文件路径或操作位置） */
  where: () => string;
  snippet: (url: string, token: string) => string;
  /** 一键安装（深链），需要真实令牌 */
  install?: (url: string, token: string) => string;
  experimental?: boolean;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

const CLIENTS: Client[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    logo: '/ai/claude.svg',
    lang: 'shell',
    where: () => t('ai.where.terminal'),
    snippet: (url, tk) => `claude mcp add --transport http calends ${url} \\\n  --header "Authorization: Bearer ${tk}"`,
  },
  {
    id: 'codex',
    name: 'Codex',
    logo: '/ai/openai.svg',
    lang: 'shell',
    where: () => t('ai.where.codex'),
    snippet: (url, tk) => `export CALENDS_TOKEN=${tk}\ncodex mcp add calends --url ${url} --bearer-token-env-var CALENDS_TOKEN`,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    logo: '/ai/cursor.svg',
    lang: 'json',
    where: () => t('ai.where.file', { path: '~/.cursor/mcp.json' }),
    snippet: (url, tk) => json({ mcpServers: { calends: { url, headers: { Authorization: `Bearer ${tk}` } } } }),
    install: (url, tk) =>
      `cursor://anysphere.cursor-deeplink/mcp/install?name=calends&config=${encodeURIComponent(b64(JSON.stringify({ url, headers: { Authorization: `Bearer ${tk}` } })))}`,
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    logo: '/ai/claude.svg',
    lang: 'json',
    where: () => t('ai.where.file', { path: 'claude_desktop_config.json' }),
    snippet: (url, tk) => json({ mcpServers: { calends: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${tk}`] } } }),
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    logo: '/ai/gemini.svg',
    lang: 'shell',
    where: () => t('ai.where.terminal'),
    snippet: (url, tk) => `gemini mcp add --transport http calends ${url} \\\n  --header "Authorization: Bearer ${tk}"`,
  },
  {
    id: 'trae',
    name: 'Trae',
    logo: '/ai/trae.svg',
    lang: 'json',
    where: () => t('ai.where.trae'),
    snippet: (url, tk) => json({ mcpServers: { calends: { url, headers: { Authorization: `Bearer ${tk}` } } } }),
  },
  {
    id: 'deepseek',
    name: 'DeepSeek Harness',
    logo: '/ai/deepseek.svg',
    lang: 'yaml',
    experimental: true,
    where: () => t('ai.where.file', { path: '~/.dsh/profiles/web/cordis.patch.yml' }),
    snippet: (url, tk) =>
      `- insert:\n    - id: mcp-calends\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: calends\n        transport: streamable-http\n        url: ${url}\n        headers:\n          Authorization: 'Bearer ${tk}'`,
  },
  {
    id: 'http',
    name: '',
    logo: '',
    lang: 'http',
    where: () => t('ai.where.http'),
    snippet: (url, tk) => `POST ${url}\nAuthorization: Bearer ${tk}\nContent-Type: application/json\n\n{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
  },
];

const copy = (text: string, what = t('ai.copied')) =>
  navigator.clipboard.writeText(text).then(
    () => toast(what),
    () => toast(t('ai.copyFailed'), true),
  );

function ClientLogo({ c, size = 28 }: { c: Client; size?: number }) {
  return (
    <span class="ai-logo" style={{ width: size, height: size }}>
      {c.logo ? <img src={c.logo} alt="" /> : <Icon name="link" size={size * 0.55} />}
    </span>
  );
}

/** 一段可复制的代码：右上角是复制按钮，左上角是语言角标 */
function CodeBlock({ code, lang, onCopy }: { code: string; lang: string; onCopy: () => void }) {
  return (
    <div class="ai-code">
      <div class="ai-code-bar">
        <span>{lang}</span>
        <button type="button" class="ai-copy" onClick={onCopy}>
          <Icon name="copy" size={14} /> {t('ai.copy')}
        </button>
      </div>
      <pre>{code}</pre>
    </div>
  );
}

/**
 * 接入面板：选客户端 → 看放在哪 → 一键复制（已有新令牌时代码里直接带上令牌）。
 * 令牌只在生成时出现一次，所以没有新令牌时代码里是占位符，并提供「为它生成令牌」。
 */
function Connect({
  url,
  token,
  client,
  setClient,
  onCreate,
}: {
  url: string;
  token?: { token: string; item: Token };
  client: string;
  setClient: (id: string) => void;
  onCreate?: (name: string) => void;
}) {
  const c = CLIENTS.find((x) => x.id === client) ?? CLIENTS[0];
  const name = c.name || t('ai.clientOther');
  const code = c.snippet(url, token?.token ?? t('ai.tokenPlaceholder'));
  return (
    <div class="ai-connect">
      <div class="ai-clients" role="radiogroup" aria-label={t('ai.pickClient')}>
        {CLIENTS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="radio"
            aria-checked={x.id === c.id}
            class={`ai-client ${x.id === c.id ? 'on' : ''}`}
            onClick={() => setClient(x.id)}
          >
            <ClientLogo c={x} />
            <span>{x.name || t('ai.clientOther')}</span>
          </button>
        ))}
      </div>
      <ol class="ai-steps">
        <li>
          <b>{t('ai.step.token')}</b>
          {token ? (
            <span class="ai-step-ok">
              <Icon name="check" size={14} /> {t('ai.step.tokenReady', { name: token.item.name })}
            </span>
          ) : onCreate ? (
            <span>
              {t('ai.step.tokenNeeded')}{' '}
              <button type="button" class="btn plain" onClick={() => onCreate(name)}>
                {t('ai.step.createFor', { name })}
              </button>
            </span>
          ) : null}
        </li>
        <li>
          <b>{t('ai.step.where')}</b>
          <span>
            {c.where()}
            {c.experimental && <span class="badge">{t('ai.experimental')}</span>}
          </span>
        </li>
        <li class="ai-step-code">
          <b>{t('ai.step.paste')}</b>
          <CodeBlock code={code} lang={c.lang} onCopy={() => copy(code, token ? t('ai.copiedWithToken') : t('ai.copied'))} />
          {token && c.install && (
            <a class="btn primary ai-install" href={c.install(url, token.token)}>
              <ClientLogo c={c} size={18} /> {t('ai.installIn', { name })}
            </a>
          )}
        </li>
      </ol>
    </div>
  );
}

/**
 * AI 接入：把账本以 MCP 服务的形式开放给 AI 助手。
 * 这里不做聊天，只负责开关、令牌和各家客户端的接入方式；AI 助手拿到令牌后，用自己的对话来查询、记账。
 */
export function Ai({ state }: { state: AppState }) {
  const url = `${location.origin}/mcp`;
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [client, setClient] = useState('claude-code');
  const [creating, setCreating] = useState<string | null>(null);
  // 刚生成的令牌留在本页（刷新前），主页面的配置也能直接带上；弹层只负责第一次展示
  const [fresh, setFresh] = useState<{ token: string; item: Token } | null>(null);
  const [showFresh, setShowFresh] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const ro = !!state.readonly;
  const enabled = state.settings.aiEnabled !== false;
  const load = () => api<Token[]>('/api/mcp/tokens').then(setTokens, () => setTokens([]));
  useEffect(() => {
    load();
    api<ToolMeta[]>('/api/mcp/tools').then(setTools, () => setTools([]));
  }, []);
  const when = (iso?: string) => (iso ? localTime(iso, state.settings.timezone) : t('ai.neverUsed'));
  const groups: Array<[string, ToolMeta[]]> = [
    [t('ai.toolsRead'), tools.filter((x) => !x.write)],
    [t('ai.toolsWrite'), tools.filter((x) => x.write)],
  ];

  return (
    <>
      <Toolbar title={t('ai.title')}>
        {!ro && (
          <button class="btn primary" onClick={() => setCreating(CLIENTS.find((x) => x.id === client)?.name || 'AI')}>
            <Icon name="plus" /> {t('ai.newToken')}
          </button>
        )}
      </Toolbar>
      <div class="page fade-in ai-page">
        {/* 状态与地址 */}
        <div class={`ai-status ${enabled ? 'on' : ''}`}>
          <div class="ai-status-l">
            <span class="ai-dot" />
            <div>
              <b>{enabled ? t('ai.status.on') : t('ai.status.off')}</b>
              <small>{enabled ? t('ai.status.onHint') : t('ai.status.offHint')}</small>
            </div>
          </div>
          {!ro && <Toggle checked={enabled} label={t('ai.title')} onChange={(v) => run(() => saveSettings({ aiEnabled: v }))} />}
        </div>
        <button type="button" class="ai-endpoint" onClick={() => copy(url, t('ai.urlCopied'))} title={t('ai.copy')}>
          <span>{t('ai.mcpUrl')}</span>
          <code>{url}</code>
          <Icon name="copy" size={15} />
        </button>

        <section class="ai-card">
          <header>
            <h2>{t('ai.setup')}</h2>
            <p>{t('ai.setupHint')}</p>
          </header>
          <Connect url={url} token={fresh ?? undefined} client={client} setClient={setClient} onCreate={ro ? undefined : (name) => setCreating(name)} />
        </section>

        <section class="ai-card">
          <header>
            <h2>{t('ai.tokens', { count: tokens?.length ?? 0 })}</h2>
            <p>{t('ai.tokensHint')}</p>
          </header>
          {tokens?.length === 0 && <div class="ai-empty">{t('ai.noTokens')}</div>}
          {!!tokens?.length && (
            <div class="ai-tokens" role="table">
              {tokens.map((tk) => (
                <div key={tk.id} class="ai-token" role="row">
                  <span class="ai-token-name">
                    <b>{tk.name}</b>
                    <span class={`ai-scope ${tk.scope}`}>{tk.scope === 'write' ? t('ai.scope.write') : t('ai.scope.read')}</span>
                  </span>
                  <code class="ai-token-prefix">{tk.prefix}…</code>
                  <span class="ai-token-meta">
                    {t('ai.createdAt', { time: localTime(tk.createdAt, state.settings.timezone, true) })}
                    <br />
                    {t('ai.lastUsed', { time: when(tk.lastUsedAt) })}
                  </span>
                  {!ro && (
                    <button
                      type="button"
                      class="icon-btn ai-revoke"
                      aria-label={t('ai.revoke')}
                      title={t('ai.revoke')}
                      onClick={() =>
                        confirmDelete(t('ai.confirmRevoke', { name: tk.name })) &&
                        run(async () => {
                          await api(`/api/mcp/tokens/${tk.id}`, { method: 'DELETE' });
                          if (fresh?.item.id === tk.id) setFresh(null);
                          await load();
                        }, t('ai.revoked'))
                      }
                    >
                      <Icon name="x" size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section class="ai-card">
          <button type="button" class="ai-tools-toggle" onClick={() => setShowTools(!showTools)} aria-expanded={showTools}>
            <span>
              <h2>{t('ai.tools', { count: tools.length })}</h2>
              <p>{t('ai.toolsHint')}</p>
            </span>
            <Icon name="down" size={16} />
          </button>
          {showTools && (
            <div class="ai-tools">
              {groups.map(([title, list]) => (
                <div key={title}>
                  <h3>{title}</h3>
                  {list.map((tool) => (
                    <div key={tool.name} class="ai-tool">
                      <b>{tool.title ?? tool.name}</b>
                      <code>{tool.name}</code>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {creating !== null && (
        <NewToken
          initialName={creating}
          onClose={() => setCreating(null)}
          onCreated={(r) => {
            setFresh(r);
            setShowFresh(true);
            setCreating(null);
            load();
          }}
        />
      )}
      {fresh && showFresh && (
        <Sheet
          title={t('ai.created.title')}
          onClose={() => setShowFresh(false)}
          foot={
            <>
              <span class="grow" />
              <button class="btn primary" onClick={() => setShowFresh(false)}>
                {t('ai.created.saved')}
              </button>
            </>
          }
        >
          <div class="stack">
            <div class="ai-fresh">
              <div class="ai-fresh-head">
                <b>{fresh.item.name}</b>
                <span class={`ai-scope ${fresh.item.scope}`}>{fresh.item.scope === 'write' ? t('ai.scope.write') : t('ai.scope.read')}</span>
              </div>
              <CodeBlock code={fresh.token} lang="token" onCopy={() => copy(fresh.token, t('ai.created.tokenCopied'))} />
              <p class="ai-warn">
                <Icon name="key" size={14} /> {t('ai.created.foot')}
              </p>
            </div>
            <Connect url={url} token={fresh} client={client} setClient={setClient} />
          </div>
        </Sheet>
      )}
    </>
  );
}

function NewToken({ initialName, onClose, onCreated }: { initialName: string; onClose: () => void; onCreated: (r: { token: string; item: Token }) => void }) {
  const [name, setName] = useState(initialName);
  const [scope, setScope] = useState<'write' | 'read'>('write');
  const create = () =>
    run(async () => {
      onCreated(await api<{ token: string; item: Token }>('/api/mcp/tokens', { method: 'POST', body: JSON.stringify({ name, scope }) }));
    });
  return (
    <Sheet
      narrow
      title={t('ai.newToken')}
      onClose={onClose}
      foot={
        <>
          <span class="grow" />
          <button class="btn" onClick={onClose}>
            {t('ai.cancel')}
          </button>
          <button class="btn primary" disabled={!name.trim()} onClick={create}>
            {t('ai.generate')}
          </button>
        </>
      }
    >
      <div class="stack">
        <label class="ai-field">
          <span>{t('ai.name')}</span>
          <input
            value={name}
            placeholder={t('ai.namePlaceholder')}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()}
          />
        </label>
        <div class="ai-scopes" role="radiogroup" aria-label={t('ai.scope.label')}>
          {(['write', 'read'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={scope === s}
              class={`ai-scope-card ${scope === s ? 'on' : ''}`}
              onClick={() => setScope(s)}
            >
              <span class="ai-radio" />
              <span>
                <b>{s === 'write' ? t('ai.scope.write') : t('ai.scope.read')}</b>
                <small>{s === 'write' ? t('ai.scope.writeDesc') : t('ai.scope.readDesc')}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
