import { useEffect, useState } from 'preact/hooks';
import type { AppState } from '../../shared/types.ts';
import { Cell, Group, Icon, Seg, Sheet, Toolbar } from '../components/ui.tsx';
import { api, run, toast } from '../store.ts';
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

type Client = 'codex' | 'claude' | 'cursor' | 'http';
const CLIENTS = (): Array<[Client, string]> => [
  ['codex', 'Codex'],
  ['claude', 'Claude Code'],
  ['cursor', 'Cursor'],
  ['http', t('ai.clientOther')],
];

/** 各家客户端的接入写法；token 为空时用占位符 */
function snippet(client: Client, url: string, token?: string): string {
  const tk = token ?? t('ai.tokenPlaceholder');
  if (client === 'codex') return `export SUBSCRIPTION_MCP_TOKEN=${tk}\ncodex mcp add subscription --url ${url} --bearer-token-env-var SUBSCRIPTION_MCP_TOKEN`;
  if (client === 'claude') return `claude mcp add --transport http subscription ${url} --header "Authorization: Bearer ${tk}"`;
  if (client === 'cursor') return JSON.stringify({ mcpServers: { subscription: { url, headers: { Authorization: `Bearer ${tk}` } } } }, null, 2);
  return `POST ${url}\nAuthorization: Bearer ${tk}\nContent-Type: application/json\n\n{"jsonrpc":"2.0","id":1,"method":"tools/list"}`;
}

const copy = (text: string, what = t('ai.copied')) =>
  navigator.clipboard.writeText(text).then(
    () => toast(what),
    () => toast(t('ai.copyFailed'), true),
  );

/**
 * AI 接入：把账本以 MCP 服务的形式开放给 Codex、Claude Code、Cursor 等 AI 助手。
 * 这里不做聊天，只负责令牌和接入说明；AI 助手拿到令牌后，用自己的对话来查询、记账。
 */
export function Ai({ state }: { state: AppState }) {
  const url = `${location.origin}/mcp`;
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [tools, setTools] = useState<ToolMeta[]>([]);
  const [client, setClient] = useState<Client>('codex');
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<{ token: string; item: Token } | null>(null);
  const ro = !!state.readonly;
  const clients = CLIENTS();
  const load = () => api<Token[]>('/api/mcp/tokens').then(setTokens, () => setTokens([]));
  useEffect(() => {
    load();
    api<ToolMeta[]>('/api/mcp/tools').then(setTools, () => setTools([]));
  }, []);
  const when = (iso?: string) => (iso ? localTime(iso, state.settings.timezone) : t('ai.neverUsed'));

  return (
    <>
      <Toolbar title={t('ai.title')}>
        {!ro && (
          <button class="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t('ai.newToken')}
          </button>
        )}
      </Toolbar>
      <div class="page fade-in ai-page">
        <Group title={t('ai.mcpUrl')}>
          <Cell label={<code class="ai-url">{url}</code>} onClick={() => copy(url, t('ai.urlCopied'))}>
            <Icon name="copy" />
          </Cell>
        </Group>

        <Group title={t('ai.tokens', { count: tokens?.length ?? 0 })}>
          {tokens?.length === 0 && <div class="cell muted">{t('ai.noTokens')}</div>}
          {tokens?.map((tk) => (
            <div key={tk.id} class="cell ai-token">
              <span class="cell-l">
                <span class="row" style={{ gap: 6 }}>
                  {tk.name}
                  <span class={`badge ${tk.scope === 'write' ? 'orange' : ''}`}>{tk.scope === 'write' ? t('ai.scope.write') : t('ai.scope.read')}</span>
                </span>
                <small>
                  <code>{tk.prefix}…</code> · {t('ai.lastUsed', { time: when(tk.lastUsedAt) })}
                </small>
              </span>
              {!ro && (
                <button
                  class="btn danger"
                  onClick={() =>
                    confirmDelete(t('ai.confirmRevoke', { name: tk.name })) &&
                    run(async () => {
                      await api(`/api/mcp/tokens/${tk.id}`, { method: 'DELETE' });
                      await load();
                    }, t('ai.revoked'))
                  }
                >
                  {t('ai.revoke')}
                </button>
              )}
            </div>
          ))}
        </Group>

        <Group title={t('ai.setup')}>
          <div class="cell">
            <Seg value={client} onChange={setClient} options={clients} />
          </div>
          <div class="cell ai-snippet">
            <pre>{snippet(client, url, fresh?.token)}</pre>
            <button class="icon-btn" aria-label={t('ai.copy')} onClick={() => copy(snippet(client, url, fresh?.token))}>
              <Icon name="copy" />
            </button>
          </div>
        </Group>

        <Group title={t('ai.tools', { count: tools.length })}>
          {tools.map((tool) => (
            <div key={tool.name} class="cell ai-tool">
              <span class="cell-l">
                <span class="row" style={{ gap: 6 }}>
                  {tool.title ?? tool.name}
                  {tool.write && <span class="badge orange">{t('ai.writeBadge')}</span>}
                </span>
                <small>
                  <code>{tool.name}</code>
                </small>
              </span>
            </div>
          ))}
        </Group>
      </div>

      {creating && (
        <NewToken
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setFresh(r);
            setCreating(false);
            load();
          }}
        />
      )}
      {fresh && (
        <Sheet narrow title={t('ai.created.title')} onClose={() => setFresh(null)} foot={<button class="btn primary" onClick={() => setFresh(null)}>{t('ai.created.saved')}</button>}>
          <div class="stack">
            <Group title={`${fresh.item.name} · ${fresh.item.scope === 'write' ? t('ai.scope.write') : t('ai.scope.read')}`} foot={t('ai.created.foot')}>
              <div class="cell ai-snippet">
                <pre>{fresh.token}</pre>
                <button class="icon-btn" aria-label={t('ai.created.copyToken')} onClick={() => copy(fresh.token, t('ai.created.tokenCopied'))}>
                  <Icon name="copy" />
                </button>
              </div>
            </Group>
            <Group title={t('ai.created.command')}>
              <div class="cell">
                <Seg value={client} onChange={setClient} options={clients} />
              </div>
              <div class="cell ai-snippet">
                <pre>{snippet(client, url, fresh.token)}</pre>
                <button class="icon-btn" aria-label={t('ai.copy')} onClick={() => copy(snippet(client, url, fresh.token))}>
                  <Icon name="copy" />
                </button>
              </div>
            </Group>
          </div>
        </Sheet>
      )}
    </>
  );
}

function NewToken({ onClose, onCreated }: { onClose: () => void; onCreated: (r: { token: string; item: Token }) => void }) {
  const [name, setName] = useState('Codex');
  const [scope, setScope] = useState<'write' | 'read'>('write');
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
          <button
            class="btn primary"
            onClick={() =>
              run(async () => {
                onCreated(await api<{ token: string; item: Token }>('/api/mcp/tokens', { method: 'POST', body: JSON.stringify({ name, scope }) }));
              })
            }
          >
            {t('ai.generate')}
          </button>
        </>
      }
    >
      <div class="stack">
        <Group>
          <Cell label={t('ai.name')}>
            <input value={name} placeholder={t('ai.namePlaceholder')} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </Cell>
        </Group>
        <Seg
          value={scope}
          onChange={setScope}
          options={[
            ['write', t('ai.scope.writeLong')],
            ['read', t('ai.scope.readLong')],
          ]}
        />
      </div>
    </Sheet>
  );
}
