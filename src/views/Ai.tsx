import { useEffect, useState } from 'preact/hooks';
import type { AppState } from '../../shared/types.ts';
import { Cell, Group, Icon, Seg, Sheet, Toolbar } from '../components/ui.tsx';
import { api, run, toast } from '../store.ts';
import { confirmDelete } from './Editor.tsx';

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
const CLIENTS: Array<[Client, string]> = [
  ['codex', 'Codex'],
  ['claude', 'Claude Code'],
  ['cursor', 'Cursor'],
  ['http', '其他'],
];

/** 各家客户端的接入写法；token 为空时用占位符 */
function snippet(client: Client, url: string, token?: string): string {
  const t = token ?? '<你的令牌>';
  if (client === 'codex') return `export SUBSCRIPTION_MCP_TOKEN=${t}\ncodex mcp add subscription --url ${url} --bearer-token-env-var SUBSCRIPTION_MCP_TOKEN`;
  if (client === 'claude') return `claude mcp add --transport http subscription ${url} --header "Authorization: Bearer ${t}"`;
  if (client === 'cursor') return JSON.stringify({ mcpServers: { subscription: { url, headers: { Authorization: `Bearer ${t}` } } } }, null, 2);
  return `POST ${url}\nAuthorization: Bearer ${t}\nContent-Type: application/json\n\n{"jsonrpc":"2.0","id":1,"method":"tools/list"}`;
}

const copy = (text: string, what = '已复制') =>
  navigator.clipboard.writeText(text).then(
    () => toast(what),
    () => toast('复制失败', true),
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
  const load = () => api<Token[]>('/api/mcp/tokens').then(setTokens, () => setTokens([]));
  useEffect(() => {
    load();
    api<ToolMeta[]>('/api/mcp/tools').then(setTools, () => setTools([]));
  }, []);
  const when = (iso?: string) => (iso ? iso.slice(0, 16).replace('T', ' ') : '从未使用');

  return (
    <>
      <Toolbar title="AI 接入">
        {!ro && (
          <button class="btn primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> 新建令牌
          </button>
        )}
      </Toolbar>
      <div class="page fade-in ai-page">
        <Group title="MCP 地址">
          <Cell label={<code class="ai-url">{url}</code>} onClick={() => copy(url, '地址已复制')}>
            <Icon name="copy" />
          </Cell>
        </Group>

        <Group title={`令牌 · ${tokens?.length ?? 0} 个`}>
          {tokens?.length === 0 && <div class="cell muted">还没有令牌。新建一个，交给要接入的 AI 助手。</div>}
          {tokens?.map((t) => (
            <div key={t.id} class="cell ai-token">
              <span class="cell-l">
                <span class="row" style={{ gap: 6 }}>
                  {t.name}
                  <span class={`badge ${t.scope === 'write' ? 'orange' : ''}`}>{t.scope === 'write' ? '读写' : '只读'}</span>
                </span>
                <small>
                  <code>{t.prefix}…</code> · 最近使用 {when(t.lastUsedAt)}
                </small>
              </span>
              {!ro && (
                <button
                  class="btn danger"
                  onClick={() =>
                    confirmDelete(`吊销「${t.name}」？用它接入的 AI 助手会立刻失去访问权限。`) &&
                    run(async () => {
                      await api(`/api/mcp/tokens/${t.id}`, { method: 'DELETE' });
                      await load();
                    }, '已吊销')
                  }
                >
                  吊销
                </button>
              )}
            </div>
          ))}
        </Group>

        <Group title="接入方式">
          <div class="cell">
            <Seg value={client} onChange={setClient} options={CLIENTS} />
          </div>
          <div class="cell ai-snippet">
            <pre>{snippet(client, url, fresh?.token)}</pre>
            <button class="icon-btn" aria-label="复制" onClick={() => copy(snippet(client, url, fresh?.token))}>
              <Icon name="copy" />
            </button>
          </div>
        </Group>

        <Group title={`可用工具 · ${tools.length} 个`}>
          {tools.map((t) => (
            <div key={t.name} class="cell ai-tool">
              <span class="cell-l">
                <span class="row" style={{ gap: 6 }}>
                  {t.title ?? t.name}
                  {t.write && <span class="badge orange">写入</span>}
                </span>
                <small>
                  <code>{t.name}</code>
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
        <Sheet narrow title="令牌已生成" onClose={() => setFresh(null)} foot={<button class="btn primary" onClick={() => setFresh(null)}>我已保存</button>}>
          <div class="stack">
            <Group title={`${fresh.item.name} · ${fresh.item.scope === 'write' ? '读写' : '只读'}`} foot="令牌只显示这一次，关掉后无法再查看；丢了就吊销重建。">
              <div class="cell ai-snippet">
                <pre>{fresh.token}</pre>
                <button class="icon-btn" aria-label="复制令牌" onClick={() => copy(fresh.token, '令牌已复制')}>
                  <Icon name="copy" />
                </button>
              </div>
            </Group>
            <Group title="接入命令">
              <div class="cell">
                <Seg value={client} onChange={setClient} options={CLIENTS} />
              </div>
              <div class="cell ai-snippet">
                <pre>{snippet(client, url, fresh.token)}</pre>
                <button class="icon-btn" aria-label="复制" onClick={() => copy(snippet(client, url, fresh.token))}>
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
      title="新建令牌"
      onClose={onClose}
      foot={
        <>
          <span class="grow" />
          <button class="btn" onClick={onClose}>
            取消
          </button>
          <button
            class="btn primary"
            onClick={() =>
              run(async () => {
                onCreated(await api<{ token: string; item: Token }>('/api/mcp/tokens', { method: 'POST', body: JSON.stringify({ name, scope }) }));
              })
            }
          >
            生成
          </button>
        </>
      }
    >
      <div class="stack">
        <Group>
          <Cell label="名称">
            <input value={name} placeholder="给哪个 AI 用" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </Cell>
        </Group>
        <Seg
          value={scope}
          onChange={setScope}
          options={[
            ['write', '读写：可查询、新增、修改'],
            ['read', '只读：只能查询'],
          ]}
        />
      </div>
    </Sheet>
  );
}
