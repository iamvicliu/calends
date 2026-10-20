import { useEffect, useState } from 'preact/hooks';
import { cycleShort } from '../../shared/billing.ts';
import { importSubscriptionsCsv, toCsv } from '../../shared/csv.ts';
import type { AppState, PaymentMethod, Subscription } from '../../shared/types.ts';
import { Cell, Group, Icon, Sheet, Toggle, Toolbar } from '../components/ui.tsx';
import { api, importData, logout, refreshFx, rotateIcs, run, saveSettings, saveSub, syncFx, toast } from '../store.ts';
import { MethodPicker } from '../components/MethodPicker.tsx';
import { ChannelsGroup } from './Channels.tsx';
import { SecurityGroup } from './Security.tsx';
import { go } from '../router.ts';

/** 可设为启动页的页面 */
const START_PAGES: Array<[string, string]> = [
  ['list', '订阅'],
  ['calendar', '日历'],
  ['report', '报告'],
  ['wallet', '钱包'],
];
/** 侧边栏里可以隐藏的模块；概览、订阅始终显示 */
const SIDE_MODULES: Array<[string, string]> = [
  ['calendar', '日历'],
  ['report', '报告'],
  ['wallet', '钱包'],
  ['family', '合租'],
  ['behalf', '代付'],
  ['ai', 'AI 接入'],
];
import { CurrencySelect, Picker } from '../components/Picker.tsx';

interface Preview {
  day: string;
  digests: Array<{ key: string; subject: string; intro: string; sections: Array<{ heading: string; rows: Array<{ title: string; sub?: string; amount?: string }> }> }>;
  log: Array<{ dedupe_key: string; subject: string; status: string; sent_at: string }>;
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function icsUrl(state: AppState) {
  return state.settings.icsToken ? `${location.origin}/cal/${state.settings.icsToken}.ics` : '';
}

export function IcsSheet({ state, onClose }: { state: AppState; onClose: () => void }) {
  const url = icsUrl(state);
  return (
    <Sheet narrow title="订阅到日历" onClose={onClose}>
      <div class="stack">
        <p class="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
          把扣款日同步到 Apple 日历 / Google 日历 / Outlook，每 6 小时自动刷新，并按提醒设置在扣款前弹出通知。
        </p>
        {url ? (
          <>
            <div class="codebox">{url}</div>
            <div class="row" style={{ flexWrap: 'wrap' }}>
              <a class="btn primary" href={url.replace(/^https?:/, 'webcal:')}>
                <Icon name="cal" /> 一键订阅
              </a>
              <button class="btn" onClick={() => navigator.clipboard.writeText(url).then(() => toast('已复制'))}>
                复制链接
              </button>
              <button class="btn ghost" onClick={() => run(rotateIcs, '已重置，旧链接失效')}>
                重置链接
              </button>
            </div>
          </>
        ) : (
          <button class="btn primary" onClick={() => run(rotateIcs, '已生成日历链接')}>
            生成私密日历链接
          </button>
        )}
        <small class="soft">链接含私密令牌，持有者可看到扣款日程；泄露后点「重置链接」即可作废。</small>
      </div>
    </Sheet>
  );
}

export function Settings({ state, today }: { state: AppState; today: string }) {
  const s = state.settings;
  // 只补没有分段、也不是代付的订阅：分段的每段各有支付方式，代付用的是别人的钱
  const unassigned = state.subscriptions.filter((x) => !x.methodId && !x.phases?.length && !x.proxy);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState(s.displayName);
  const [ics, setIcs] = useState(false);
  const [importing, setImporting] = useState<{ subs: Subscription[]; methods: PaymentMethod[] } | null>(null);

  const loadPreview = () => api<Preview>('/api/notify/preview').then(setPreview).catch(() => {});
  const [fxs, setFxs] = useState<{ needed: number; covered: number; sources: Record<string, number>; first?: string } | null>(null);
  const loadFx = () => api<typeof fxs>('/api/fx/status').then(setFxs).catch(() => {});
  useEffect(() => {
    loadPreview();
    loadFx();
  }, []);

  const pickFile = (accept: string, cb: (text: string) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => input.files?.[0]?.text().then(cb);
    input.click();
  };

  const onCsv = (text: string) => {
    const r = importSubscriptionsCsv(text, state.methods, today);
    if (!r.subscriptions.length) return toast('CSV 中没有可导入的订阅', true);
    setImporting({ subs: r.subscriptions, methods: r.methods });
  };
  // 备份恢复：整份交给服务端，订阅、支付方式、设置、汇率一起原样还原
  const [restoring, setRestoring] = useState<{ raw: unknown; subs: number; methods: number; exportedAt?: string; version: number } | null>(null);
  const onJson = (text: string) => {
    try {
      const j = JSON.parse(text) as { subscriptions?: unknown[]; methods?: unknown[]; exportedAt?: string; version?: number };
      if (!Array.isArray(j.subscriptions)) throw new Error();
      setRestoring({ raw: j, subs: j.subscriptions.length, methods: j.methods?.length ?? 0, exportedAt: j.exportedAt, version: j.version ?? 1 });
    } catch {
      toast('不是有效的备份文件', true);
    }
  };

  const exportCsv = () => {
    const head = ['Name', 'Currency', 'Price', 'Category', 'Cycle', 'Starts', 'Ends', 'Tags', 'Payment Account', 'URL', 'Notes'];
    const cyc = (x: Subscription) => (x.cycle.unit === 'lifetime' ? 'Lifetime' : x.cycle.every === 1 ? { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[x.cycle.unit] : `Every ${x.cycle.every} ${x.cycle.unit}s`);
    const rows = state.subscriptions.map((x) => [x.name, x.currency, x.price, x.category, cyc(x), x.start, x.end ?? '', x.tags.join(' '), state.methods.find((m) => m.id === x.methodId)?.name ?? '', x.url ?? '', x.notes ?? '']);
    download(`subscriptions-${today}.csv`, toCsv([head, ...rows]), 'text/csv');
  };

  const hour = (h: number) => `${String(h).padStart(2, '0')}:05`;
  return (
    <>
      <Toolbar title="设置" />
      <div class="page fade-in stack" style={{ maxWidth: 720, gap: 26, margin: '0 auto' }}>
        <Group title="通用">
          <Cell label="名字">
            <input value={name} placeholder="分享图、公开页上显示" onInput={(e) => setName((e.target as HTMLInputElement).value)} onBlur={() => name.trim() !== s.displayName && run(() => saveSettings({ displayName: name.trim() }), '已保存')} />
          </Cell>
          <Cell label="打开后先看">
            <Picker value={s.startPage ?? ''} onChange={(v) => run(() => saveSettings({ startPage: v || undefined }))} options={[{ value: '', label: '概览' }, ...START_PAGES.map(([k, l]) => ({ value: k, label: l }))]} ariaLabel="启动页" />
          </Cell>
          <Cell label="本位币">
            <CurrencySelect value={s.baseCurrency} onChange={(c) => run(() => saveSettings({ baseCurrency: c }))} ariaLabel="本位币" />
          </Cell>
          <Cell label="时区">
            <Picker value={s.timezone} onChange={(z) => run(() => saveSettings({ timezone: z }))} options={['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Manila', 'Asia/Singapore', 'Europe/Istanbul', 'Europe/London', 'America/Los_Angeles', 'America/New_York', 'UTC'].map((z) => ({ value: z, label: z }))} ariaLabel="时区" />
          </Cell>
          <Cell label="每周从">
            <Picker value={String(s.weekStart ?? 1)} onChange={(v) => run(() => saveSettings({ weekStart: v === '0' ? 0 : 1 }))} options={[{ value: '1', label: '周一开始' }, { value: '0', label: '周日开始' }]} ariaLabel="每周起始日" />
          </Cell>
        </Group>

        <Group title="侧边栏">
          <Cell label="即将扣款">
            <Toggle checked={s.sidebarUpcoming !== false} onChange={(v) => run(() => saveSettings({ sidebarUpcoming: v }))} />
          </Cell>
          {s.sidebarUpcoming !== false && (
            <Cell label="往后看">
              <Picker value={s.upcomingDays ?? 45} onChange={(n) => run(() => saveSettings({ upcomingDays: n }))} options={[7, 14, 30, 45, 60, 90].map((n) => ({ value: n, label: `${n} 天` }))} ariaLabel="即将扣款天数" search={false} />
            </Cell>
          )}
          {SIDE_MODULES.map(([k, l]) => (
            <Cell key={k} label={l}>
              <Toggle checked={!(s.hiddenNav ?? []).includes(k)} onChange={(v) => run(() => saveSettings({ hiddenNav: v ? (s.hiddenNav ?? []).filter((x) => x !== k) : [...(s.hiddenNav ?? []), k] }))} />
            </Cell>
          ))}
        </Group>

        <Group title="提醒">
          <Cell label="默认提前">
            <Picker value={s.remindDays} onChange={(n) => run(() => saveSettings({ remindDays: n }))} options={[0, 1, 2, 3, 5, 7, 14].map((n) => ({ value: n, label: n === 0 ? '到期当天' : `${n} 天` }))} ariaLabel="默认提前" />
          </Cell>
          <Cell label="发送时间">
            <Picker value={s.notifyHour} onChange={(h) => run(() => saveSettings({ notifyHour: h }))} options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: hour(h) }))} ariaLabel="发送时间" search={false} />
          </Cell>
          <Cell label="每月 1 日账单预告">
            <Toggle checked={s.monthlyDigest} onChange={(v) => run(() => saveSettings({ monthlyDigest: v }))} />
          </Cell>
          <Cell
            label={<span style={{ color: 'var(--accent)' }}>发一条测试提醒到所有渠道</span>}
            onClick={() =>
              run(async () => {
                const r = await api<{ sent: boolean; reason?: string; results?: Array<{ channel: string; ok: boolean; error?: string }> }>('/api/notify/test', { method: 'POST', body: '{}' });
                if (!r.sent) throw new Error(r.reason ?? '发送失败');
                const bad = r.results?.filter((x) => !x.ok) ?? [];
                if (bad.length) throw new Error(bad.map((x) => `${x.channel}：${x.error}`).join('；'));
                loadPreview();
              }, '测试提醒已发出')
            }
          />
          <Cell label={<span style={{ color: 'var(--accent)' }}>预览今天的提醒</span>} onClick={() => window.open('/api/notify/preview?html=1', '_blank')} />
        </Group>

        <ChannelsGroup state={state} />

        {preview && (preview.digests.length > 0 || preview.log.length > 0) && (
          <Group title={`今天（${preview.day}）`}>
            {preview.digests.map((d) => (
              <Cell key={d.key} label={d.subject}>
                {d.sections.reduce((a, x) => a + x.rows.length, 0)} 项
              </Cell>
            ))}
            {preview.log.slice(0, 6).map((l) => (
              <Cell key={l.dedupe_key} label={<span style={{ fontSize: 13.5 }}>{l.subject}</span>}>
                <span style={{ color: l.status === 'sent' ? undefined : 'var(--red)', fontSize: 12.5 }}>{l.sent_at.slice(5, 16)}</span>
              </Cell>
            ))}
          </Group>
        )}

        <Group title="记账">
          <Cell label="默认支付方式">
            <MethodPicker methods={state.methods} value={s.defaultMethodId} onChange={(id) => run(() => saveSettings({ defaultMethodId: id }))} />
          </Cell>
          {s.defaultMethodId && unassigned.length > 0 && (
            <Cell
              label={`${unassigned.length} 个订阅未指定支付方式`}
              onClick={() =>
                run(async () => {
                  for (const x of unassigned) await saveSub({ ...x, methodId: s.defaultMethodId });
                }, `已把 ${unassigned.length} 个订阅设为默认支付方式`)
              }
            >
              <span style={{ color: 'var(--accent)' }}>全部设为默认</span>
            </Cell>
          )}
          <Cell label="合租收款币种">
            <CurrencySelect value={s.collectCurrency ?? s.baseCurrency} onChange={(c) => run(() => saveSettings({ collectCurrency: c }))} ariaLabel="合租收款币种" />
          </Cell>
        </Group>

        <Group title="汇率">
          <Cell label="当前汇率" sub={`更新于 ${state.fx.fetchedAt.slice(0, 16).replace('T', ' ')}`} onClick={() => run(refreshFx, '汇率已更新')}>
            1 USD = {state.fx.rates.CNY?.toFixed(2)} CNY
          </Cell>
          <Cell label="历史汇率覆盖" sub={fxs?.first ? `最早 ${fxs.first}` : undefined}>
            {fxs ? `${fxs.covered} / ${fxs.needed} 天` : '…'}
          </Cell>
          {fxs && fxs.covered < fxs.needed && <Cell label={<span style={{ color: 'var(--accent)' }}>补齐缺失的汇率</span>} onClick={() => run(async () => { await syncFx(); await loadFx(); }, '历史汇率已更新')} />}
        </Group>

        <Group title="开放">
          <Cell label="订阅到系统日历" onClick={() => setIcs(true)}>
            {s.icsToken ? '已开启' : '未开启'}
          </Cell>
          <Cell label="公开页" sub={s.publicView ? `${location.origin}/` : undefined}>
            <Toggle checked={s.publicView} onChange={(v) => run(() => saveSettings({ publicView: v }), v ? '已公开' : '已关闭公开页')} />
          </Cell>
          {s.publicView && <Cell label={<span style={{ color: 'var(--accent)' }}>预览公开页</span>} onClick={() => window.open('/', '_blank')} />}
          <Cell label="AI 接入（MCP）">
            <Toggle checked={s.aiEnabled !== false} onChange={(v) => run(() => saveSettings({ aiEnabled: v }), v ? '已开启 AI 接入' : '已关闭，AI 助手将无法访问')} />
          </Cell>
          {s.aiEnabled !== false && <Cell label={<span style={{ color: 'var(--accent)' }}>管理令牌与接入方式</span>} onClick={() => go('ai')} />}
        </Group>

        {!state.readonly && <SecurityGroup state={state} />}

        <Group title="数据">
          <Cell label="导入 CSV" onClick={() => pickFile('.csv,text/csv', onCsv)} />
          <Cell label="从备份恢复" onClick={() => pickFile('.json,application/json', onJson)} />
          <Cell label="导出 CSV" onClick={exportCsv} />
          <Cell label="导出完整备份" onClick={() => (location.href = '/api/backup')} />
        </Group>

        <Group>
          <button class="cell tap" style={{ justifyContent: 'center', color: 'var(--red)' }} onClick={() => logout()}>
            退出登录
          </button>
        </Group>
      </div>

      {restoring && (
        <Sheet
          narrow
          title="从备份恢复"
          onClose={() => setRestoring(null)}
          foot={
            <>
              <span class="grow" />
              <button class="btn" onClick={() => setRestoring(null)}>
                取消
              </button>
              <button
                class="btn primary"
                onClick={() =>
                  run(async () => {
                    const r = await api<{ restored: { subscriptions: number; methods: number; fxDays: number }; state: AppState }>('/api/backup', { method: 'POST', body: JSON.stringify(restoring.raw) });
                    setRestoring(null);
                    location.reload();
                    return r;
                  }, '已恢复')
                }
              >
                替换当前账本
              </button>
            </>
          }
        >
          <Group foot="当前账本会被备份里的内容整体替换，无法撤销；建议先导出一份当前备份。">
            <Cell label="订阅">{restoring.subs} 个</Cell>
            <Cell label="支付方式">{restoring.methods} 个</Cell>
            {restoring.exportedAt && <Cell label="备份时间">{restoring.exportedAt.slice(0, 16).replace('T', ' ')}</Cell>}
            {restoring.version < 2 && <Cell label="格式">旧版备份：只含订阅与支付方式</Cell>}
          </Group>
        </Sheet>
      )}
      {ics && <IcsSheet state={state} onClose={() => setIcs(false)} />}
      {importing && (
        <Sheet
          title={`导入 ${importing.subs.length} 项订阅`}
          onClose={() => setImporting(null)}
          foot={
            <>
              <button
                class="btn danger"
                onClick={() =>
                  window.confirm('替换会清空现有订阅与支付方式，确定？') &&
                  run(async () => {
                    await importData({ subscriptions: importing.subs, methods: importing.methods, mode: 'replace' });
                    setImporting(null);
                  }, '已替换导入')
                }
              >
                替换全部
              </button>
              <span class="grow" />
              <button
                class="btn primary"
                onClick={() =>
                  run(async () => {
                    await importData({ subscriptions: importing.subs, methods: importing.methods, mode: 'merge' });
                    setImporting(null);
                  }, '已合并导入')
                }
              >
                追加导入
              </button>
            </>
          }
        >
          <Group title={importing.methods.length ? `将新建支付方式：${importing.methods.map((m) => m.name).join('、')}` : undefined}>
            {importing.subs.map((x) => (
              <Cell key={x.id} label={x.name}>
                {x.currency} {x.price} / {cycleShort(x.cycle)}
              </Cell>
            ))}
          </Group>
        </Sheet>
      )}
    </>
  );
}
