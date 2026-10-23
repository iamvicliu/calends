import { copyParts } from '../components/copy.tsx';
import { base, storageKey } from '../base.ts';
import type { ReactNode } from 'react';
import { Fragment, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Brain,
  CircleCheck,
  CircleX,
  Clock,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Image as ImageIcon,
  ImagePlus,
  KeyRound,
  Loader2,
  Pencil,
  ReceiptText,
  RotateCcw,
  Settings2,
  Square,
  SquarePen,
  Wrench,
  X,
} from 'lucide-react';
import { cycleLabel } from '../../../shared/billing.ts';
import { flow, billLabel, cnDateFull, money } from '../../../shared/format.ts';
import { locale, t } from '../../../shared/i18n.ts';
import type { ApiMessage, AssistantConfigView, Effort, ErrorKind } from '../../../shared/deepseek.ts';
import { dropOldImages } from '../../../shared/deepseek.ts';
import type { AppState, Subscription } from '../../../shared/types.ts';
import { IconButton, ask, PayBadge, Sheet, SubIcon, Toolbar } from '../components/ui.tsx';
import { Picker } from '../components/Picker.tsx';
import { catColor } from '../derive.ts';
import { api, refresh, toast } from '../store.ts';
import { newSub } from './Editor.tsx';
import { compressImage as compress, takeHandoff } from '../handoff.ts';
import './assistant.css';
import { Streamdown, type Components } from 'streamdown';

// ---------- 会话数据 ----------

type ToolStatus = 'running' | 'done' | 'error';
type ProposalState = 'pending' | 'applying' | 'applied' | 'dismissed' | 'error';

type Part =
  | { kind: 'reasoning'; text: string; start: number; ms?: number }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; args: Record<string, unknown>; status: ToolStatus; result?: unknown; error?: string }
  | {
      kind: 'proposal';
      id: string;
      tool: string;
      args: Record<string, unknown>;
      preview: Preview;
      filled?: string[];
      state: ProposalState;
      error?: string;
      subId?: string;
    };

interface Preview {
  before?: unknown;
  after?: unknown;
  references?: unknown;
  created_category?: { name: string };
  subscription?: { id: string; name: string; category?: string; price?: number; currency?: string; cycle?: string; next_charge?: string | null };
  next_charges?: Array<{ date: string; amount: number; currency: string }>;
}

type ChatTurn =
  | {
      id: string;
      role: 'user';
      text: string;
      images: string[];
      /** 发送时历史的长度：重试、重新生成时截回这里 */ at: number;
      /** 存到服务端时图片不保存，只记张数 */ imgs?: number;
    }
  | { id: string; role: 'assistant'; parts: Part[]; status: 'streaming' | 'done' | 'error' | 'stopped'; error?: { kind: ErrorKind; message: string } };

interface Saved {
  /** 对话 id：服务端按它存；「新对话」换一个新的 */
  id: string;
  createdAt: string;
  turns: ChatTurn[];
  history: ApiMessage[];
}

const STORE = storageKey('calends.assistant');
const rid = () => Math.random().toString(36).slice(2, 10);
const newChat = (): Saved => ({ id: rid(), createdAt: new Date().toISOString(), turns: [], history: [] });

/** 存到服务端的样子：图片换成张数，历史里的图片换成占位文字 */
function forServer(s: Saved) {
  return {
    createdAt: s.createdAt,
    turns: s.turns.map((x) => (x.role === 'user' && x.images.length ? { ...x, images: [], imgs: x.images.length } : x)),
    history: dropOldImages(s.history, 0, '[image]'),
  };
}

/** 会话存在本机浏览器里（只是方便，不是账本数据）：较早的图片不存，免得撑爆存储 */
function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE);
    // 老版本没有 id：补上，之后照常存到服务端
    if (raw) {
      const saved = { ...newChat(), ...(JSON.parse(raw) as Partial<Saved>) } as Saved;
      // 还没说过话的对话：分割线上的时间按这次打开算
      return saved.turns.length ? saved : { ...saved, createdAt: new Date().toISOString() };
    }
  } catch {
    /* 隐私模式等读不到就当新会话 */
  }
  return newChat();
}
function persist(s: Saved) {
  try {
    let users = 0;
    const turns = s.turns
      .slice()
      .reverse()
      .map((x) => (x.role === 'user' && x.images.length && ++users > 2 ? { ...x, images: [] } : x))
      .reverse();
    localStorage.setItem(STORE, JSON.stringify({ id: s.id, createdAt: s.createdAt, turns, history: dropOldImages(s.history, 0, '[image]') }));
  } catch {
    /* 存不下就算了 */
  }
}

/** 对话分隔线上的时间：今年的不写年份 */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(locale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------- 流式请求 ----------

type ServerEvent =
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'step' }
  | { type: 'tool'; id: string; name: string; args: Record<string, unknown>; status: ToolStatus; result?: unknown; error?: string }
  | { type: 'proposal'; id: string; tool: string; args: Record<string, unknown>; preview: Preview; filled?: string[] }
  | { type: 'usage' }
  | { type: 'error'; kind: ErrorKind; message: string }
  | { type: 'done'; messages: ApiMessage[]; aborted?: boolean };

async function stream(body: unknown, signal: AbortSignal, on: (e: ServerEvent) => void) {
  // 带上界面语言：服务端按它给出分类名称和回复语言
  const res = await fetch(base('/api/assistant/chat'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-locale': locale() },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw Object.assign(new Error(b.error ?? `HTTP ${res.status}`), { kind: res.status === 401 ? 'auth' : 'server' });
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) if (line.startsWith('data:')) on(JSON.parse(line.slice(5)) as ServerEvent);
    }
  }
}

/** 把服务端事件并进当前这条助手消息 */
function reduce(turn: Extract<ChatTurn, { role: 'assistant' }>, e: ServerEvent): Extract<ChatTurn, { role: 'assistant' }> {
  const parts = turn.parts.slice();
  const last = parts[parts.length - 1];
  const closeReasoning = () => {
    const r = parts[parts.length - 1];
    if (r?.kind === 'reasoning' && r.ms == null) parts[parts.length - 1] = { ...r, ms: Date.now() - r.start };
  };
  switch (e.type) {
    case 'reasoning':
      if (last?.kind === 'reasoning' && last.ms == null) parts[parts.length - 1] = { ...last, text: last.text + e.delta };
      else parts.push({ kind: 'reasoning', text: e.delta, start: Date.now() });
      break;
    case 'text':
      closeReasoning();
      if (parts[parts.length - 1]?.kind === 'text') {
        const p = parts[parts.length - 1] as Extract<Part, { kind: 'text' }>;
        parts[parts.length - 1] = { ...p, text: p.text + e.delta };
      } else parts.push({ kind: 'text', text: e.delta });
      break;
    case 'step':
      closeReasoning();
      break;
    case 'tool': {
      closeReasoning();
      const i = parts.findIndex((p) => p.kind === 'tool' && p.id === e.id);
      const next: Part = { kind: 'tool', id: e.id, name: e.name, args: e.args, status: e.status, result: e.result, error: e.error };
      if (i >= 0) parts[i] = next;
      else parts.push(next);
      break;
    }
    case 'proposal':
      parts.push({ kind: 'proposal', id: e.id, tool: e.tool, args: e.args, preview: e.preview, filled: e.filled, state: 'pending' });
      break;
    case 'error':
      closeReasoning();
      return { ...turn, parts, status: 'error', error: { kind: e.kind, message: e.message } };
    case 'done':
      closeReasoning();
      return { ...turn, parts, status: e.aborted ? 'stopped' : 'done' };
  }
  return { ...turn, parts };
}

// ---------- 页面 ----------

export function Assistant({ state, today, onOpen }: { state: AppState; today: string; onOpen: (s: Subscription) => void }) {
  const [cfg, setCfg] = useState<AssistantConfigView | null>(null);
  const [setup, setSetup] = useState(false);
  const [chat, setChat] = useState<Saved>(load);
  // 以前的对话（服务端）：显示在当前对话上面，往上翻就能看到；只读
  const [past, setPast] = useState<Saved[]>([]);
  // 历史记录加载完才显示欢迎语：加载前后滚动位置不同，提前显示会先出现在一处再跳到另一处
  const [pastLoaded, setPastLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const composer = useRef<ComposerHandle>(null);

  useEffect(() => {
    void api<AssistantConfigView>('/api/assistant/config').then(setCfg, () => setCfg(null));
  }, []);
  useEffect(() => persist(chat), [chat]);
  useEffect(() => {
    void api<Saved[]>('/api/assistant/chats')
      .then(
        (list) => setPast(list.filter((c) => c.turns?.length)),
        () => {},
      )
      .finally(() => setPastLoaded(true));
  }, []);
  // 每轮回复结束后存到服务端（流式过程中不存）；其他设备也能看到
  useEffect(() => {
    if (busy || !chat.turns.length) return;
    const h = setTimeout(() => void api(`/api/assistant/chats/${chat.id}`, { method: 'PUT', body: JSON.stringify(forServer(chat)) }).catch(() => {}), 600);
    return () => clearTimeout(h);
  }, [chat, busy]);
  const shownPast = past.filter((c) => c.id !== chat.id);
  // 别处（新建订阅表单）带着文字或图片跳过来：放进输入框
  useEffect(() => {
    const h = takeHandoff();
    if (h) composer.current?.prefill(h.text, h.images);
  }, []);

  // 有历史时，当前对话至少占满一屏（顶栏与输入框之间）：滚到底就是一段全新的对话，往上翻才看到历史
  const [fill, setFill] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      // 顶栏只在吸顶时（窄屏）占可视高度；分割线留在可视区最上方
      const tb = document.querySelector<HTMLElement>('.toolbar');
      const bar = tb && getComputedStyle(tb).position === 'sticky' ? tb.getBoundingClientRect().height : 0;
      const dock = document.querySelector('.as-composer')?.getBoundingClientRect().height ?? 0;
      setFill(Math.max(0, window.innerHeight - bar - dock - 24));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [chat.id, !chat.turns.length]);

  // 新内容到来时贴着底部滚；用户往上翻了就不打扰，显示「回到底部」
  useLayoutEffect(() => {
    if (atBottom) window.scrollTo(0, document.documentElement.scrollHeight);
  }, [chat, atBottom, fill, past]);
  // 布局完成后直接校正滚动位置，不把受滚动影响的坐标反写为高度。
  // 浏览器缩放或滚动尚未完成时，反复 setFill 会形成同步更新循环。
  const session = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!atBottom) return;
    const frame = requestAnimationFrame(() => {
      const head = session.current?.querySelector('.as-past-head');
      if (!head) return;
      const tb = document.querySelector<HTMLElement>('.toolbar');
      const top = tb && getComputedStyle(tb).position === 'sticky' ? tb.getBoundingClientRect().bottom : 0;
      const d = head.getBoundingClientRect().top - (top + 12);
      if (Math.abs(d) > 1) window.scrollTo({ top: window.scrollY + d, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [fill, past, chat.id, atBottom]);
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      setAtBottom(el.scrollHeight - window.scrollY - window.innerHeight < 120);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const send = async (text: string, images: string[], history = chat.history, base = chat.turns) => {
    if (busy || (!text.trim() && !images.length)) return;
    const user: ChatTurn = { id: rid(), role: 'user', text, images, at: history.length };
    let bot: Extract<ChatTurn, { role: 'assistant' }> = { id: rid(), role: 'assistant', parts: [], status: 'streaming' };
    setChat((c) => ({ ...c, history, turns: [...base, user, bot] }));
    setAtBottom(true);
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    let added: ApiMessage[] | null = null;
    try {
      const on = (e: ServerEvent) => {
        bot = reduce(bot, e);
        if (e.type === 'done') added = e.messages;
        setChat((c) => ({ ...c, turns: c.turns.map((x) => (x.id === bot.id ? bot : x)) }));
      };
      await stream({ history, text, images }, ctrl.signal, on);
    } catch (err) {
      const aborted = ctrl.signal.aborted;
      bot = aborted
        ? { ...bot, status: 'stopped' }
        : { ...bot, status: 'error', error: { kind: ((err as { kind?: ErrorKind }).kind ?? 'network') as ErrorKind, message: (err as Error).message } };
      setChat((c) => ({ ...c, turns: c.turns.map((x) => (x.id === bot.id ? bot : x)) }));
    } finally {
      // 成功（或中途停止）才把这轮写进历史；出错的这轮不进历史，重试时原样再发
      const done = added as ApiMessage[] | null;
      if (done) setChat((c) => ({ ...c, history: [...history, ...done] }));
      if (bot.status === 'streaming') setChat((c) => ({ ...c, turns: c.turns.map((x) => (x.id === bot.id ? { ...bot, status: 'done' } : x)) }));
      setBusy(false);
      abort.current = null;
    }
  };

  /** 重试 / 重新生成：去掉最后一问一答，用原来的内容和当时的历史再发一次 */
  const retry = () => {
    const i = chat.turns.map((x) => x.role).lastIndexOf('user');
    const u = chat.turns[i];
    if (!u || u.role !== 'user') return;
    void send(u.text, u.images, chat.history.slice(0, u.at), chat.turns.slice(0, i));
  };

  const setPart = (turnId: string, partId: string, patch: Partial<Extract<Part, { kind: 'proposal' }>>) =>
    setChat((c) => ({
      ...c,
      turns: c.turns.map((x) =>
        x.id === turnId && x.role === 'assistant'
          ? { ...x, parts: x.parts.map((p) => (p.kind === 'proposal' && p.id === partId ? { ...p, ...patch } : p)) }
          : x,
      ),
    }));

  /** 确认草稿：同一个 MCP 工具真正执行；结果作为备注写进历史，模型下一轮就知道已经加上了 */
  const applyProposal = async (turnId: string, p: Extract<Part, { kind: 'proposal' }>) => {
    setPart(turnId, p.id, { state: 'applying', error: undefined });
    try {
      const r = await api<{ subscription?: { id: string; name: string } }>('/api/assistant/apply', {
        method: 'POST',
        body: JSON.stringify({ tool: p.tool, args: p.args }),
      });
      await refresh();
      setPart(turnId, p.id, { state: 'applied', subId: r.subscription?.id });
      setChat((c) => ({
        ...c,
        history: [
          ...c.history,
          { role: 'user', content: `[note] The user confirmed ${p.tool} for "${String(p.args.name ?? r.subscription?.name ?? '')}". It is saved now.` },
        ],
      }));
      toast(t('assistant.applied'));
    } catch (e) {
      setPart(turnId, p.id, { state: 'error', error: (e as Error).message });
    }
  };

  /** 全部确认：同一轮的草稿按出现顺序逐张执行（后面的可能依赖前面的，例如先建订阅再加成员） */
  const applyAll = async (turnId: string) => {
    const turn = chat.turns.find((x) => x.id === turnId);
    if (turn?.role !== 'assistant') return;
    for (const p of turn.parts) if (p.kind === 'proposal' && (p.state === 'pending' || p.state === 'error')) await applyProposal(turnId, p);
  };

  /** 编辑后再添加：用草稿填好新建表单 */
  const editProposal = (p: Extract<Part, { kind: 'proposal' }>) => {
    const a = p.args;
    const cyc = (a.cycle ?? {}) as { unit?: Subscription['cycle']['unit']; every?: number };
    const draft: Subscription = {
      ...newSub(
        String(a.start ?? today),
        state.methods.find((m) => m.id === a.method || m.name === a.method)?.id ?? state.settings.defaultMethodId,
        String(a.currency ?? state.settings.baseCurrency),
      ),
      name: String(a.name ?? ''),
      price: Number(a.price ?? 0),
      cycle: { unit: cyc.unit ?? 'month', every: Number(cyc.every ?? 1) },
      ...(a.category ? { category: String(a.category) } : {}),
      ...(a.region ? { region: String(a.region).toUpperCase() } : {}),
      ...(a.url ? { url: String(a.url) } : {}),
      ...(a.icon ? { icon: String(a.icon) } : {}),
      ...(a.notes ? { notes: String(a.notes) } : {}),
      ...(a.account ? { account: String(a.account) } : {}),
      ...(a.status === 'trial' ? { status: 'trial' as const } : {}),
      ...(a.trial_end ? { trialEnd: String(a.trial_end) } : {}),
      ...(Array.isArray(a.payments) && a.payments.length
        ? { payments: (a.payments as Array<{ date: string; amount: number; note?: string }>).map((x) => ({ date: x.date, amount: x.amount, note: x.note })) }
        : {}),
    };
    window.dispatchEvent(new CustomEvent('ledger:add', { detail: draft }));
  };

  /** 新对话：只是开新的一段，之前的留在上面（服务端也还在）；真正清空在设置里 */
  const reset = () => {
    abort.current?.abort();
    if (chat.turns.length) setPast((p) => [...p.filter((c) => c.id !== chat.id), chat]);
    setChat(newChat());
    setAtBottom(true);
  };

  const empty = !chat.turns.length;
  const noop = () => {};
  const ready = !!cfg?.configured;
  return (
    <>
      <Toolbar title={t('assistant.title')}>
        <span className="as-tb">
          {!empty && (
            <IconButton onClick={reset} title={t('assistant.new')} aria-label={t('assistant.new')}>
              <SquarePen size={16} />
            </IconButton>
          )}
          <IconButton onClick={() => setSetup(true)} title={t('assistant.settings')} aria-label={t('assistant.settings')}>
            <Settings2 size={16} />
          </IconButton>
        </span>
      </Toolbar>
      <div className="as">
        <div className="as-scroll">
          <div className="as-col">
            {shownPast.map((c) => (
              <div key={c.id} className="as-past">
                <div className="as-past-head">{fmtWhen(c.createdAt)}</div>
                {c.turns.map((turn) =>
                  turn.role === 'user' ? (
                    <UserBubble key={turn.id} turn={turn} />
                  ) : (
                    <BotMessage
                      key={turn.id}
                      turn={turn.status === 'streaming' ? { ...turn, status: 'stopped' } : turn}
                      state={state}
                      last={false}
                      onRetry={noop}
                      onSetup={() => setSetup(true)}
                      onApply={noop}
                      onEdit={noop}
                      onDismiss={noop}
                      onApplyAll={noop}
                      onOpen={(id) => {
                        const s = state.subscriptions.find((x) => x.id === id);
                        if (s) onOpen(s);
                      }}
                    />
                  ),
                )}
              </div>
            ))}
            <section ref={session} className={`as-session ${shownPast.length ? 'fresh' : ''}`} style={shownPast.length ? { minHeight: fill } : undefined}>
              {shownPast.length > 0 && <div className="as-past-head">{fmtWhen(chat.createdAt)}</div>}
              {empty
                ? pastLoaded && <Welcome ready={ready} cfg={cfg} onSetup={() => setSetup(true)} />
                : chat.turns.map((turn, i) =>
                    turn.role === 'user' ? (
                      <UserBubble key={turn.id} turn={turn} />
                    ) : (
                      <BotMessage
                        key={turn.id}
                        turn={turn}
                        state={state}
                        last={i === chat.turns.length - 1}
                        onRetry={retry}
                        onSetup={() => setSetup(true)}
                        onApply={(p) => void applyProposal(turn.id, p)}
                        onEdit={editProposal}
                        onDismiss={(p) => setPart(turn.id, p.id, { state: 'dismissed' })}
                        onApplyAll={() => void applyAll(turn.id)}
                        onOpen={(id) => {
                          const s = state.subscriptions.find((x) => x.id === id);
                          if (s) onOpen(s);
                        }}
                      />
                    ),
                  )}
            </section>
          </div>
        </div>
        {!atBottom && (
          <IconButton className="as-bottom" onClick={() => setAtBottom(true)} aria-label={t('assistant.toBottom')}>
            <ArrowDown size={16} />
          </IconButton>
        )}
        <Composer
          ref={composer}
          above={empty && ready ? <Suggestions onPick={(x) => (x.send ? void send(x.text, []) : composer.current?.prefill(x.text))} /> : undefined}
          busy={busy}
          disabled={!ready}
          model={cfg?.model}
          onSend={(text, imgs) => void send(text, imgs)}
          onStop={() => abort.current?.abort()}
          onSettings={() => setSetup(true)}
          onReset={empty ? undefined : reset}
        />
      </div>
      {setup && (
        <SetupSheet
          cfg={cfg}
          onClose={() => setSetup(false)}
          onSaved={setCfg}
          onClearChats={() => {
            abort.current?.abort();
            setPast([]);
            setChat(newChat());
          }}
        />
      )}
    </>
  );
}

// ---------- 空状态（对应 AI Elements 的 ConversationEmptyState）与建议（Suggestions） ----------

const SUGGESTIONS: Array<{ key: string; send: boolean }> = [
  { key: 'receipt', send: false },
  { key: 'screenshot', send: false },
  { key: 'month', send: true },
  { key: 'hikes', send: true },
];

/** 欢迎语随机轮换一套场景示例；标题与描述都做轻，只作提示 */
const WELCOME_COUNT = 20;

function Welcome({ ready, cfg, onSetup }: { ready: boolean; cfg: AssistantConfigView | null; onSetup: () => void }) {
  const [n] = useState(() => Math.floor(Math.random() * WELCOME_COUNT) + 1);
  return (
    <div className="as-welcome">
      <img className="as-orb" src={base('/icons/logo.svg')} alt="" />
      <h2>{t(`assistant.welcome.variants.v${n}.title`)}</h2>
      <p>{t(`assistant.welcome.variants.v${n}.body`)}</p>
      {!ready && cfg && (
        <button className="as-setup-cta" onClick={onSetup}>
          <KeyRound size={16} />
          <span>
            <b>{t('assistant.setup.cta')}</b>
          </span>
        </button>
      )}
    </div>
  );
}

/** 输入框上方一排可横向滑动的建议（窄屏换行） */
function Suggestions({ onPick }: { onPick: (s: { text: string; send: boolean }) => void }) {
  return (
    <div className="as-suggest">
      {SUGGESTIONS.map((s) => (
        <button key={s.key} title={t(`assistant.suggest.${s.key}.hint`)} onClick={() => onPick({ text: t(`assistant.suggest.${s.key}.text`), send: s.send })}>
          {t(`assistant.suggest.${s.key}.title`)}
        </button>
      ))}
    </div>
  );
}

// ---------- 消息 ----------

function UserBubble({ turn }: { turn: Extract<ChatTurn, { role: 'user' }> }) {
  return (
    <div className="as-user">
      {turn.images.length > 0 && (
        <div className="as-user-imgs">
          {turn.images.map((src, i) => (
            <img key={i} src={base(src)} alt="" />
          ))}
        </div>
      )}
      {!turn.images.length && !!turn.imgs && (
        <div className="as-user-imgnote">
          <ImageIcon size={13} /> {t('assistant.imagesSent', { count: turn.imgs })}
        </div>
      )}
      {turn.text && <div className="as-bubble">{turn.text}</div>}
    </div>
  );
}

function BotMessage(props: {
  turn: Extract<ChatTurn, { role: 'assistant' }>;
  state: AppState;
  last: boolean;
  onRetry: () => void;
  onSetup: () => void;
  onApply: (p: Extract<Part, { kind: 'proposal' }>) => void;
  onEdit: (p: Extract<Part, { kind: 'proposal' }>) => void;
  onDismiss: (p: Extract<Part, { kind: 'proposal' }>) => void;
  onApplyAll: () => void;
  onOpen: (id: string) => void;
}) {
  const { turn } = props;
  const pending = turn.parts.filter((p) => p.kind === 'proposal' && (p.state === 'pending' || p.state === 'error')).length;
  const text = turn.parts.flatMap((p) => (p.kind === 'text' ? [p.text] : [])).join('\n\n');
  const waiting = turn.status === 'streaming' && !turn.parts.length;
  return (
    <div className="as-bot">
      <div className="as-bot-body">
        {waiting && <Dots />}
        {turn.parts.map((p, i) => {
          if (p.kind === 'reasoning') return <Reasoning key={i} part={p} live={turn.status === 'streaming' && p.ms == null} />;
          if (p.kind === 'text') return <Markdown key={i} text={p.text} streaming={turn.status === 'streaming'} />;
          if (p.kind === 'tool') return <ToolCard key={`tool:${p.id}`} part={p} />;
          return (
            <Proposal
              key={`proposal:${p.id}`}
              part={p}
              siblings={turn.parts.flatMap((x) => (x.kind === 'proposal' ? [{ tool: x.tool, args: x.args }] : []))}
              state={props.state}
              onApply={() => props.onApply(p)}
              onEdit={() => props.onEdit(p)}
              onDismiss={() => props.onDismiss(p)}
              onOpen={props.onOpen}
            />
          );
        })}
        {pending > 1 && turn.status !== 'streaming' && (
          <div className="as-applyall">
            <span>{t('assistant.card.pendingCount', { count: pending })}</span>
            <button className="btn primary" onClick={props.onApplyAll}>
              <Check size={14} /> {t('assistant.card.applyAll')}
            </button>
          </div>
        )}
        {turn.status === 'error' && turn.error && <ErrorCard error={turn.error} onRetry={props.onRetry} onSetup={props.onSetup} />}
        {turn.status === 'stopped' && <div className="as-stopped">{t('assistant.stopped')}</div>}
        {props.last && turn.status !== 'streaming' && turn.status !== 'error' && (
          <div className="as-actions">
            {text && (
              <IconButton
                onClick={() => void navigator.clipboard.writeText(text).then(() => toast(t('assistant.copied')))}
                title={t('assistant.copy')}
                aria-label={t('assistant.copy')}
              >
                <Copy size={14} />
              </IconButton>
            )}
            <IconButton onClick={props.onRetry} title={t('assistant.regenerate')} aria-label={t('assistant.regenerate')}>
              <RotateCcw size={14} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <div className="as-dots" aria-label={t('assistant.thinking')}>
      <i />
      <i />
      <i />
    </div>
  );
}

/** 思考过程（AI Elements Reasoning）：进行中展开并显示流光，结束 1 秒后自动收起成「思考了 N 秒」 */
function Reasoning({ part, live }: { part: Extract<Part, { kind: 'reasoning' }>; live: boolean }) {
  const [open, setOpen] = useState(live);
  useEffect(() => {
    if (live) return setOpen(true);
    const id = setTimeout(() => setOpen(false), 1000);
    return () => clearTimeout(id);
  }, [live]);
  const secs = Math.max(1, Math.round((part.ms ?? 0) / 1000));
  return (
    <div className={`as-reason ${open ? 'open' : ''}`}>
      <button className="as-reason-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Brain size={15} />
        <span className={live ? 'shimmer' : ''}>{live ? t('assistant.thinking') : t('assistant.thought', { count: secs })}</span>
        <ChevronDown size={15} className="chev" />
      </button>
      {open && <div className="as-reason-b">{part.text}</div>}
    </div>
  );
}

/** 工具调用：名称、状态，点开看参数与结果 */
function ToolCard({ part }: { part: Extract<Part, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const title = t(`mcp.tool.${part.name}`) || part.name;
  const json = (v: unknown) => {
    const s = JSON.stringify(v, null, 2);
    return s.length > 4000 ? `${s.slice(0, 4000)}\n…` : s;
  };
  return (
    <div className={`as-tool ${part.status}`}>
      <button className="as-tool-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Wrench size={15} />
        <span className="as-tool-name">{title}</span>
        <span className={`as-pill ${part.status}`}>
          {part.status === 'running' ? <Clock size={13} className="pulse" /> : part.status === 'done' ? <CircleCheck size={13} /> : <CircleX size={13} />}
          {t(`assistant.tool.${part.status}`)}
        </span>
        <ChevronDown size={15} className="chev" />
      </button>
      {open && (
        <div className="as-tool-b">
          <small>{t('assistant.tool.input')}</small>
          <pre>{json(part.args)}</pre>
          {part.status !== 'running' && (
            <>
              <small>{part.error ? t('assistant.tool.error') : t('assistant.tool.output')}</small>
              <pre className={part.error ? 'err' : ''}>{part.error ?? json(part.result)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 草稿卡片：新增订阅时显示图标、名称、价格与接下来的扣款；其他写操作显示要改的内容 */
/** 各写操作的草稿内容：用人话把参数列出来（标签与取值都本地化） */
function summaryRows(
  tool: string,
  a: Record<string, unknown>,
  state: AppState,
  subCcy?: string,
  preview?: Record<string, unknown>,
): Array<[string, ReactNode]> {
  const rows: Array<[string, ReactNode]> = [];
  const add = (label: string, v: ReactNode | undefined | null | false) => {
    if (v !== undefined && v !== null && v !== false && v !== '') rows.push([label, v]);
  };
  const day = (v: unknown) => (v ? cnDateFull(String(v)) : undefined);
  const collect = state.settings.collectCurrency ?? state.settings.baseCurrency;
  const method = (v: unknown) => state.methods.find((m) => m.id === v || m.name === v);
  switch (tool) {
    case 'record_receivable':
      if (a.action === 'update' || a.action === 'delete' || a.entry) {
        for (const [key, value] of Object.entries(a))
          if (!['subscription', 'dry_run'].includes(key))
            add(
              t(`assistant.f.${key}`) === `assistant.f.${key}` ? key : t(`assistant.f.${key}`),
              typeof value === 'object' ? JSON.stringify(value) : String(value),
            );
        break;
      }
      add(t('assistant.f.member'), a.member ? String(a.member) : a.person ? String(a.person) : undefined);
      add(t('assistant.f.amount'), a.amount != null ? <span className="green">{flow(Number(a.amount), String(a.currency ?? collect))}</span> : undefined);
      add(t('assistant.f.date'), day(a.date) ?? t('assistant.card.today'));
      add(t('assistant.f.paidUntil'), day(a.until));
      break;
    case 'save_share_member':
      add(t('assistant.f.member'), String(a.name ?? a.member ?? ''));
      add(
        t('assistant.f.fee'),
        a.exempt
          ? t('assistant.v.exempt')
          : a.fee != null
            ? `${money(Number(a.fee), String(a.fee_currency ?? collect))}\n${billLabel(Number(a.bill_every ?? 1))}`
            : undefined,
      );
      add(t('assistant.f.paidUntil'), day(a.paid_until));
      add(t('family.member.firstPeriod'), a.first_period ? t(`family.member.firstMode.${String(a.first_period)}`) : undefined);
      add(t('family.member.firstAmount'), a.first_amount != null ? money(Number(a.first_amount), String(a.fee_currency ?? collect)) : undefined);
      add(t('assistant.f.joined'), day(a.joined));
      add(t('assistant.f.left'), a.left === null ? t('family.member.notSet') : day(a.left));
      if ('leave_refund' in a || a.left === null) {
        const r = a.leave_refund as { amount: number; currency?: string; date?: string; note?: string } | null;
        const actual = (preview?.member as { leave_refund?: { currency: string; date: string } } | undefined)?.leave_refund;
        const suggested = preview?.suggested_refund as { currency?: string } | undefined;
        add(t('family.refund.title'), r ? flow(-r.amount, r.currency ?? actual?.currency ?? suggested?.currency ?? collect) : t('family.refund.none'));
        if (r) {
          add(t('family.refund.date'), day(r.date ?? actual?.date ?? a.left));
          add(t('family.member.note'), r.note);
        }
      }
      add(t('assistant.f.contact'), [a.contact_via, a.contact].filter(Boolean).join(' ') || undefined);
      break;
    case 'remove_share_member':
      add(t('assistant.f.member'), String(a.member ?? ''));
      break;
    case 'set_share':
      add(t('assistant.f.role'), t(`assistant.v.${a.role === 'member' ? 'member' : a.role === 'none' ? 'unshare' : 'owner'}`));
      add(t('assistant.f.seats'), a.seats != null ? String(a.seats) : undefined);
      add(t('assistant.f.ownerName'), a.owner_name ? String(a.owner_name) : undefined);
      add(t('assistant.f.since'), day(a.since));
      add(t('family.member.collectionAnchor'), day(a.collect_from));
      break;
    case 'change_price':
      add(t('assistant.f.newPrice'), a.amount != null ? money(Number(a.amount), subCcy ?? state.settings.baseCurrency) : undefined);
      add(t('assistant.f.from'), day(a.from) ?? t('assistant.card.today'));
      break;
    case 'set_status':
      add(t('assistant.f.action'), t(`assistant.v.${String(a.action)}`));
      add(t('assistant.f.date'), day(a.at));
      break;
    case 'record_payment':
      add(t('assistant.f.kind'), a.kind && a.kind !== 'charge' ? t(`detail.charges.kind.${String(a.kind)}`) : t('assistant.v.charge'));
      add(
        t('assistant.f.amount'),
        a.amount != null ? (
          <span className={a.kind === 'refund' ? 'green' : undefined}>
            {flow(a.kind === 'refund' ? Math.abs(Number(a.amount)) : -Number(a.amount), subCcy ?? state.settings.baseCurrency)}
          </span>
        ) : undefined,
      );
      add(t('assistant.f.date'), day(a.date) ?? t('assistant.card.today'));
      break;
    case 'delete_subscription':
      add(t('assistant.f.effect'), t('assistant.v.deleteAll'));
      break;
    default: {
      // update_subscription / change_plan 等：逐项列出要改的字段
      const set = (a.set && typeof a.set === 'object' ? a.set : a.plan && typeof a.plan === 'object' ? a.plan : a) as Record<string, unknown>;
      for (const [k, v] of Object.entries(set)) {
        if (['subscription', 'id', 'force', 'dry_run', 'set', 'plan'].includes(k)) continue;
        const label = t(`assistant.f.${k}`) === `assistant.f.${k}` ? k : t(`assistant.f.${k}`);
        const val =
          k === 'method'
            ? (method(v)?.name ?? String(v))
            : /date|end|due|until|from|at|expires/.test(k)
              ? day(v)
              : Array.isArray(v)
                ? v.join('、')
                : typeof v === 'object'
                  ? JSON.stringify(v)
                  : String(v);
        add(label, val);
      }
      if (tool === 'change_plan') add(t('assistant.f.from'), day(a.at));
    }
  }
  return rows;
}

function Proposal(props: {
  siblings: Array<{ tool: string; args: Record<string, unknown> }>;
  part: Extract<Part, { kind: 'proposal' }>;
  state: AppState;
  onApply: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onOpen: (id: string) => void;
}) {
  const { part, state } = props;
  const a = part.args;
  const create = part.tool === 'create_subscription';
  const sub = part.preview.subscription;
  const name = String(
    a.name ?? sub?.name ?? (a.set as { name?: string } | undefined)?.name ?? a.method ?? a.person ?? a.category ?? t(`mcp.tool.${part.tool}`),
  );
  const sib = props.siblings.find((x) => x.tool === 'create_subscription' && x.args.id && x.args.id === sub?.id)?.args;
  const sibling = sib ? { icon: sib.icon ? String(sib.icon) : undefined, url: sib.url ? String(sib.url) : undefined } : undefined;
  const icon: Pick<Subscription, 'name' | 'icon' | 'url' | 'category'> = {
    name,
    // 同一轮先建的订阅还没保存时，从那张新建草稿里取图标和链接
    icon: a.icon ? String(a.icon) : (state.subscriptions.find((s) => s.id === sub?.id)?.icon ?? sibling?.icon),
    url: a.url ? String(a.url) : (state.subscriptions.find((s) => s.id === sub?.id)?.url ?? sibling?.url),
    category: String(a.category ?? sub?.category ?? ''),
  };
  const cyc = a.cycle as { unit: Subscription['cycle']['unit']; every?: number } | undefined;
  const history = create && Array.isArray(a.payments) ? (a.payments as Array<{ amount: number }>) : [];
  const method =
    state.methods.find((m) => m.id === a.method || m.name === a.method) ??
    (create ? state.methods.find((m) => m.id === state.settings.defaultMethodId) : undefined);
  const done = part.state === 'applied';
  const destructive =
    part.tool === 'delete_subscription' ||
    part.tool === 'delete_payment' ||
    part.tool === 'remove_share_member' ||
    a.action === 'delete' ||
    a.action === 'remove' ||
    a.top_up_action === 'delete' ||
    (part.tool === 'set_share' && a.role === 'none');
  // 没识别出来、用了默认值的字段：提醒用户核对
  const missing = create
    ? [!a.start && t('assistant.card.start'), !a.method && t('detail.field.method'), !a.category && t('detail.field.category')].filter((x): x is string => !!x)
    : [];
  const gone = part.state === 'dismissed';
  const rows: Array<[string, ReactNode]> = create
    ? [
        [t('assistant.card.start'), a.start ? cnDateFull(String(a.start)) : t('assistant.card.today')],
        ...(a.region ? [[t('detail.field.region'), String(a.region).toUpperCase()] as [string, ReactNode]] : []),
        ...(a.status === 'trial' && a.trial_end ? [[t('detail.field.trialEnd'), cnDateFull(String(a.trial_end))] as [string, ReactNode]] : []),
        [t('detail.field.method'), <PayBadge key="m" m={method} />],
        ...(history.length
          ? [
              [
                t('assistant.card.history'),
                `${t('assistant.card.historyCount', { count: history.length })}\n${flow(-history.reduce((x, p) => x + p.amount, 0), String(a.currency))}`,
              ] as [string, ReactNode],
            ]
          : []),
      ]
    : summaryRows(part.tool, a, state, sub?.currency, part.preview as Record<string, unknown>);
  return (
    <div className={`as-card ${part.state}`} style={{ '--tint': catColor(icon.category) } as Record<string, string>}>
      <div className="as-card-tag">
        <ReceiptText size={12} /> {create ? t('assistant.card.draft') : t(`mcp.tool.${part.tool}`)}
      </div>
      <div className="as-card-head row">
        <SubIcon sub={icon} size={44} />
        <div className="as-card-id">
          <b className="text-ellipsis">{name}</b>
          {create && cyc ? (
            <span>
              {money(Number(a.price), String(a.currency))} {cycleLabel({ unit: cyc.unit, every: Number(cyc.every ?? 1) })}
              {copyParts(a.category ? `\n${String(a.category)}` : '')}
            </span>
          ) : (
            sub && <span>{copyParts([sub.price != null && sub.currency ? money(sub.price, sub.currency) : '', sub.cycle].filter(Boolean).join('\n'))}</span>
          )}
        </div>
      </div>
      <dl className="as-card-rows">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>{copyParts(v)}</dd>
          </Fragment>
        ))}
      </dl>
      {part.preview.created_category && <div className="as-card-next">{t('mcp.label.createCategory', { name: part.preview.created_category.name })}</div>}
      {!create && part.preview.before !== undefined && (
        <details className="as-tool-detail">
          <summary>{t('assistant.card.changes')}</summary>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflow: 'auto', fontSize: 'var(--fs-1)' }}>
            {JSON.stringify({ before: part.preview.before, after: part.preview.after, references: part.preview.references }, null, 2)}
          </pre>
        </details>
      )}
      {create && part.preview.next_charges && part.preview.next_charges.length > 0 && (
        <div className="as-card-next">
          <small>{t('assistant.card.next')}</small>
          <div>
            {part.preview.next_charges.map((c) => (
              <span key={c.date}>
                {c.date.slice(5).replace('-', '/')} <span className="copy-gap" aria-hidden="true" /> {flow(-c.amount, c.currency)}
              </span>
            ))}
          </div>
        </div>
      )}
      {create && part.state === 'pending' && (missing.length > 0 || part.filled?.length) ? (
        <div className="as-card-note">
          {missing.length > 0 && (
            <span className="warn">
              <CircleAlert size={13} /> {t('assistant.card.missing', { fields: missing.join(t('assistant.card.sep')) })}
            </span>
          )}
          {part.filled?.length ? <span>{t('assistant.card.filled')}</span> : null}
        </div>
      ) : null}
      {part.state === 'error' && part.error && (
        <div className="as-card-err icon-text">
          <CircleAlert size={14} /> {part.error}
        </div>
      )}
      <div className="as-card-foot">
        {done ? (
          <>
            <span className="as-ok icon-text">
              <Check size={15} /> {create ? t('assistant.card.added') : t('assistant.card.done')}
            </span>
            {part.subId && (
              <button className="btn" onClick={() => props.onOpen(part.subId!)}>
                {t('assistant.card.view')}
              </button>
            )}
          </>
        ) : gone ? (
          <span className="as-muted icon-text">
            <CircleX size={15} /> {t('assistant.card.dismissed')}
          </span>
        ) : (
          <>
            <button className="btn plain" onClick={props.onDismiss} disabled={part.state === 'applying'}>
              {t('assistant.card.dismiss')}
            </button>
            {create && (
              <button className="btn" onClick={props.onEdit} disabled={part.state === 'applying'}>
                <Pencil size={14} /> {t('assistant.card.edit')}
              </button>
            )}
            <button className={`btn ${destructive ? 'danger-solid' : 'primary'}`} onClick={props.onApply} disabled={part.state === 'applying'}>
              {part.state === 'applying' ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              {create ? t('assistant.card.add') : t('assistant.card.confirm')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ErrorCard({ error, onRetry, onSetup }: { error: { kind: ErrorKind; message: string }; onRetry: () => void; onSetup: () => void }) {
  const fixable = error.kind === 'auth' || error.kind === 'config' || error.kind === 'balance';
  return (
    <div className="as-error row" role="alert">
      <CircleAlert size={16} />
      <div>
        <b>{t(`assistant.error.${error.kind}`)}</b>
        <small>{error.message}</small>
        <div className="as-error-acts">
          <button className="btn" onClick={onRetry}>
            <RotateCcw size={14} /> {t('assistant.retry')}
          </button>
          {fixable && (
            <button className="btn plain" onClick={onSetup}>
              {t('assistant.settings')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 消息正文：Streamdown（AI Elements 用的渲染器），支持表格、标题、引用、代码块、删除线、任务列表等 GFM，
 * 流式输出时自动补全没写完的 Markdown（半张表、没闭合的粗体）。后台不用 Tailwind，样式写在 assistant.css；
 * 关掉它自带的复制 / 下载按钮和外链确认弹窗，外链直接新标签打开。
 */
const MD_COMPONENTS: Components = {
  table: ({ children }) => (
    <div className="as-table">
      <table>{children}</table>
    </div>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  pre: ({ children }) => <pre className="as-pre">{children}</pre>,
  code: ({ className, children }) => <code className={className}>{children}</code>,
};

function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <Streamdown
      className="as-md"
      mode={streaming ? 'streaming' : 'static'}
      isAnimating={streaming}
      parseIncompleteMarkdown
      controls={false}
      linkSafety={{ enabled: false }}
      components={MD_COMPONENTS}
    >
      {text}
    </Streamdown>
  );
}

// ---------- 输入框：文字 + 图片（粘贴、拖拽、选择） ----------

interface ComposerHandle {
  prefill: (text: string, images?: string[]) => void;
}

function Composer({
  ref,
  busy,
  disabled,
  model,
  onSend,
  onStop,
  onSettings,
  onReset,
  above,
}: {
  ref: React.Ref<ComposerHandle>;
  busy: boolean;
  disabled: boolean;
  model?: string;
  onSend: (text: string, images: string[]) => void;
  onStop: () => void;
  onSettings: () => void;
  /** 有会话时才有：窄屏工具栏放不下，「新对话」放在输入框里 */
  onReset?: () => void;
  /** 输入框上方的内容（建议） */
  above?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ prefill }));
  function prefill(s: string, imgs: string[] = []) {
    setText(s);
    if (imgs.length) setImages(imgs.slice(0, 8));
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(s.length, s.length);
    });
  }
  // 高度随内容增长，最多约 8 行
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const addFiles = async (files: Iterable<File>) => {
    const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 8 - images.length);
    if (!list.length) return;
    try {
      const urls = await Promise.all(list.map(compress));
      setImages((x) => [...x, ...urls].slice(0, 8));
    } catch {
      toast(t('assistant.imageFailed'), true);
    }
  };
  const submit = () => {
    if (busy || disabled || (!text.trim() && !images.length)) return;
    onSend(text, images);
    setText('');
    setImages([]);
  };

  return (
    <div
      className={`as-composer ${drag ? 'drag' : ''}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      {above}
      <div className="as-input">
        {images.length > 0 && (
          <div className="as-atts">
            {images.map((src, i) => (
              <span key={i} className="as-att">
                <img src={base(src)} alt="" />
                <IconButton onClick={() => setImages((x) => x.filter((_, k) => k !== i))} aria-label={t('assistant.removeImage')}>
                  <X size={12} />
                </IconButton>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={disabled ? t('assistant.placeholderSetup') : t('assistant.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="as-input-bar">
          <IconButton
            className="as-icon"
            onClick={() => file.current?.click()}
            disabled={disabled}
            title={t('assistant.addImage')}
            aria-label={t('assistant.addImage')}
          >
            <ImagePlus size={17} />
          </IconButton>
          <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
          <button className="as-model" onClick={onSettings} title={t('assistant.settings')}>
            {model === 'deepseek-flash' ? 'DeepSeek V4.1 Flash' : (model ?? 'DeepSeek')}
          </button>
          {onReset && (
            <IconButton className="as-icon m-only" onClick={onReset} title={t('assistant.new')} aria-label={t('assistant.new')}>
              <SquarePen size={16} />
            </IconButton>
          )}
          <span className="grow" />
          {busy ? (
            <IconButton className="as-send accent stop" onClick={onStop} title={t('assistant.stop')} aria-label={t('assistant.stop')}>
              <Square size={13} fill="currentColor" />
            </IconButton>
          ) : (
            <IconButton
              className="as-send accent"
              onClick={submit}
              disabled={disabled || (!text.trim() && !images.length)}
              title={t('assistant.send')}
              aria-label={t('assistant.send')}
            >
              <ArrowUp size={17} />
            </IconButton>
          )}
        </div>
      </div>
      <p className="as-foot">{t('assistant.disclaimer')}</p>
    </div>
  );
}

// ---------- 配置：DeepSeek API Key、Base URL、模型、思考强度 ----------

function SetupSheet({
  cfg,
  onClose,
  onSaved,
  onClearChats,
}: {
  cfg: AssistantConfigView | null;
  onClose: () => void;
  onSaved: (c: AssistantConfigView) => void;
  onClearChats: () => void;
}) {
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(cfg?.baseUrl ?? 'https://api.deepseek.com');
  const [model, setModel] = useState(cfg?.model ?? 'deepseek-flash');
  const [effort, setEffort] = useState<Effort>(cfg?.effort ?? 'low');
  const [saving, setSaving] = useState(false);
  // 模型列表：填好地址和 Key 后向服务商的 /models 取；取不到（有的服务没有这个接口）时可以手动填
  const [models, setModels] = useState<string[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const canFetch = !!baseUrl.trim() && (!!key.trim() || !!cfg?.configured);

  const fetchModels = async () => {
    if (!canFetch) return;
    setFetching(true);
    setFetchErr(null);
    try {
      const r = await api<{ ok: boolean; message?: string; models?: string[] }>('/api/assistant/test', {
        method: 'POST',
        body: JSON.stringify({ apiKey: key.trim() || undefined, baseUrl }),
      });
      if (!r.ok || !r.models?.length) {
        setModels(null);
        setFetchErr(r.ok ? t('assistant.setup.noModels') : (r.message ?? t('assistant.error.network')));
        return;
      }
      const list = [...r.models].sort((a, b) => a.localeCompare(b));
      setModels(list);
      setManual(false);
      // 当前模型不在列表里：优先挑一个 Flash，其次第一个
      setModel((m) => (list.includes(m) ? m : (list.find((x) => /flash/i.test(x)) ?? list[0])));
    } catch (e) {
      setModels(null);
      setFetchErr((e as Error).message);
    } finally {
      setFetching(false);
    }
  };
  // 打开时（已保存 Key）以及改了地址或 Key 后，停顿一下自动获取
  useEffect(() => {
    if (!canFetch) return;
    const h = setTimeout(() => void fetchModels(), key || baseUrl !== (cfg?.baseUrl ?? '') ? 700 : 0);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, baseUrl]);
  const save = async () => {
    setSaving(true);
    try {
      const v = await api<AssistantConfigView>('/api/assistant/config', { method: 'PUT', body: JSON.stringify({ apiKey: key, baseUrl, model, effort }) });
      onSaved(v);
      toast(t('assistant.setup.saved'));
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  const clear = async () => {
    const v = await api<AssistantConfigView>('/api/assistant/config', { method: 'PUT', body: JSON.stringify({ apiKey: null }) });
    onSaved(v);
    toast(t('assistant.setup.cleared'));
  };

  return (
    <Sheet
      narrow
      title={t('assistant.setup.title')}
      onClose={onClose}
      foot={
        <>
          {cfg?.configured && (
            <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => void clear()}>
              {t('assistant.setup.clear')}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={saving || (!key && !cfg?.configured) || !model.trim()}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="as-setup">
        {/* 清空聊天记录：服务端和本机都删掉，不可恢复，所以要确认 */}
        <div className="as-clear-chats">
          <span>{t('assistant.clearChatsHint')}</span>
          <button
            type="button"
            className="btn danger"
            onClick={async () =>
              (await ask(t('assistant.clearChatsConfirm'))) &&
              void api('/api/assistant/chats', { method: 'DELETE' }).then(() => {
                try {
                  localStorage.removeItem(STORE);
                } catch {
                  /* ignore */
                }
                onClearChats();
                toast(t('assistant.clearChatsDone'));
              })
            }
          >
            {t('assistant.clearChats')}
          </button>
        </div>
        <p className="as-setup-intro">
          {t('assistant.setup.intro')}{' '}
          <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">
            platform.deepseek.com
          </a>
        </p>
        <label className="as-field">
          <span>Base URL</span>
          <input spellCheck={false} value={baseUrl} placeholder="https://api.deepseek.com" onChange={(e) => setBaseUrl(e.target.value)} />
          <small>{t('assistant.setup.baseHint')}</small>
        </label>
        <label className="as-field">
          <span>API Key</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            placeholder={cfg?.configured ? t('assistant.setup.keySaved', { hint: cfg.keyHint ?? '' }) : 'sk-…'}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <div className="as-field">
          <span className="as-model-head">
            {t('assistant.setup.model')}
            {models && !manual && (
              <button type="button" className="as-link" onClick={() => void fetchModels()} disabled={fetching}>
                {fetching ? <Loader2 size={12} className="spin" /> : <RotateCcw size={12} />} {t('assistant.setup.refresh')}
              </button>
            )}
          </span>
          {models && !manual ? (
            <div className="as-model-pick">
              <Picker
                variant="btn"
                value={model}
                ariaLabel={t('assistant.setup.model')}
                search
                options={[
                  ...(model && !models.includes(model) ? [{ value: model, label: model, hint: t('assistant.setup.notInList') }] : []),
                  ...models.map((m) => ({
                    value: m,
                    label: m.includes('/') ? m.slice(m.indexOf('/') + 1) : m,
                    group: m.includes('/') ? m.slice(0, m.indexOf('/')) : undefined,
                  })),
                ]}
                onChange={setModel}
              />
            </div>
          ) : manual ? (
            <input spellCheck={false} value={model} placeholder="deepseek-flash" onChange={(e) => setModel(e.target.value)} />
          ) : (
            <div className="as-model-empty">
              {fetching ? (
                <>
                  <Loader2 size={14} className="spin" /> {t('assistant.setup.fetching')}
                </>
              ) : (
                (fetchErr ?? t('assistant.setup.fetchHint'))
              )}
            </div>
          )}
          <small className="as-model-foot">
            {models && !manual ? t('assistant.setup.fetched', { count: models.length }) : t('assistant.setup.modelHint')}
            {!manual ? (
              <>
                {fetchErr && !fetching && (
                  <button type="button" className="as-link" onClick={() => void fetchModels()}>
                    {t('assistant.setup.retry')}
                  </button>
                )}
                <button type="button" className="as-link" onClick={() => setManual(true)}>
                  {t('assistant.setup.manual')}
                </button>
              </>
            ) : (
              models && (
                <button type="button" className="as-link" onClick={() => setManual(false)}>
                  {t('assistant.setup.pickList')}
                </button>
              )
            )}
          </small>
        </div>
        <div className="as-field">
          <span>{t('assistant.setup.effort')}</span>
          <div className="as-effort">
            {(['none', 'low', 'high'] as Effort[]).map((e) => (
              <button key={e} className={effort === e ? 'on' : ''} onClick={() => setEffort(e)}>
                <b>{t(`assistant.setup.effort_${e}`)}</b>
                <small>{t(`assistant.setup.effort_${e}Hint`)}</small>
              </button>
            ))}
          </div>
        </div>
        <p className="as-setup-note">{t('assistant.setup.privacy')}</p>
      </div>
    </Sheet>
  );
}
