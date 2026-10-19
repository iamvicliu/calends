import { useEffect, useState } from 'preact/hooks';
import { cycleShort } from '../../shared/billing.ts';
import { importSubscriptionsCsv, toCsv } from '../../shared/csv.ts';
import { CURRENCIES } from '../../shared/format.ts';
import type { AppState, PaymentMethod, Subscription } from '../../shared/types.ts';
import { Icon, SectionHead, Sheet, Toggle } from '../components/ui.tsx';
import { api, importData, logout, refreshFx, rotateIcs, run, saveSettings, toast } from '../store.ts';

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
        <p class="muted" style={{ margin: 0, fontSize: 14 }}>
          把扣款日同步到 Apple 日历 / Google 日历 / Outlook，每 6 小时自动刷新，并按提醒设置在扣款前弹出通知。
        </p>
        {url ? (
          <>
            <div class="codebox">{url}</div>
            <div class="hstack">
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
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ics, setIcs] = useState(false);
  const [email, setEmail] = useState(s.notifyEmail);
  const [importing, setImporting] = useState<{ subs: Subscription[]; methods: PaymentMethod[] } | null>(null);

  const loadPreview = () => api<Preview>('/api/notify/preview').then(setPreview).catch(() => {});
  useEffect(() => {
    loadPreview();
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
  const onJson = (text: string) => {
    try {
      const j = JSON.parse(text) as Partial<AppState>;
      if (!Array.isArray(j.subscriptions)) throw new Error();
      setImporting({ subs: j.subscriptions, methods: j.methods ?? [] });
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

  return (
    <div class="wrap fade-in" style={{ maxWidth: 760 }}>
      <SectionHead no="■" label="Settings" title="设置" />

      <div class="stack" style={{ gap: 22 }}>
        <div class="card card-pad">
          <div class="eyebrow" style={{ marginBottom: 6 }}>
            邮件提醒
          </div>
          <div class="switch">
            <div style={{ flex: 1 }}>
              <div class="t">通知邮箱</div>
              <div class="d">每天在设定时刻检查，扣款、试用到期、余额不足、拼车待收会合并为一封邮件。</div>
            </div>
          </div>
          <div class="inline" style={{ margin: '4px 0 6px' }}>
            <input class="input" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
            <button class="btn" style={{ flex: '0 0 auto' }} disabled={email === s.notifyEmail} onClick={() => run(() => saveSettings({ notifyEmail: email.trim() }), '已保存')}>
              保存
            </button>
          </div>
          <div class="form" style={{ marginTop: 10 }}>
            <label class="field">
              <span>默认提前天数</span>
              <select class="input" value={s.remindDays} onChange={(e) => run(() => saveSettings({ remindDays: Number((e.target as HTMLSelectElement).value) }))}>
                {[0, 1, 2, 3, 5, 7, 14].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? '当天' : `提前 ${n} 天`}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>发送时刻（{s.timezone}）</span>
              <select class="input" value={s.notifyHour} onChange={(e) => run(() => saveSettings({ notifyHour: Number((e.target as HTMLSelectElement).value) }))}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:05
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div class="switch">
            <div>
              <div class="t">每月 1 日账单预告</div>
              <div class="d">列出当月所有预计扣款与合计</div>
            </div>
            <Toggle checked={s.monthlyDigest} onChange={(v) => run(() => saveSettings({ monthlyDigest: v }))} />
          </div>
          <div class="hstack" style={{ marginTop: 14 }}>
            <button
              class="btn primary"
              onClick={() =>
                run(async () => {
                  const r = await api<{ sent: boolean; reason?: string }>('/api/notify/test', { method: 'POST' });
                  if (!r.sent) throw new Error(r.reason ?? '发送失败');
                  loadPreview();
                }, `测试邮件已发往 ${s.notifyEmail}`)
              }
            >
              <Icon name="mail" /> 发送测试邮件
            </button>
            <a class="btn" href="/api/notify/preview?html=1" target="_blank" rel="noreferrer">
              预览今日邮件
            </a>
          </div>
          {preview && (
            <div style={{ marginTop: 18 }}>
              <div class="eyebrow" style={{ marginBottom: 6 }}>
                今日（{preview.day}）待发
              </div>
              {preview.digests.length === 0 ? (
                <div class="soft" style={{ fontSize: 13 }}>今天没有需要提醒的事项。</div>
              ) : (
                preview.digests.map((d) => (
                  <div key={d.key} class="log-row">
                    <span>{d.subject}</span>
                    <span class="soft">{d.sections.reduce((a, x) => a + x.rows.length, 0)} 项</span>
                  </div>
                ))
              )}
              {preview.log.length > 0 && (
                <>
                  <div class="eyebrow" style={{ margin: '16px 0 6px' }}>
                    发送记录
                  </div>
                  {preview.log.slice(0, 8).map((l) => (
                    <div key={l.dedupe_key} class="log-row">
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.subject}</span>
                      <span class={`num ${l.status === 'sent' ? 'soft' : 'warn'}`} style={{ flexShrink: 0 }}>
                        {l.sent_at.slice(5, 16)}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <div class="card card-pad">
          <div class="eyebrow" style={{ marginBottom: 6 }}>
            日历与显示
          </div>
          <div class="switch">
            <div>
              <div class="t">日历订阅（ICS）</div>
              <div class="d">{s.icsToken ? '已开启，可在 Apple 日历中查看扣款日' : '把扣款日同步到系统日历'}</div>
            </div>
            <button class="btn sm" onClick={() => setIcs(true)}>
              管理
            </button>
          </div>
          <div class="form" style={{ marginTop: 12 }}>
            <label class="field">
              <span>本位币</span>
              <select class="input" value={s.baseCurrency} onChange={(e) => run(() => saveSettings({ baseCurrency: (e.target as HTMLSelectElement).value }))}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>时区</span>
              <select class="input" value={s.timezone} onChange={(e) => run(() => saveSettings({ timezone: (e.target as HTMLSelectElement).value }))}>
                {['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Manila', 'Asia/Singapore', 'Europe/Istanbul', 'Europe/London', 'America/Los_Angeles', 'America/New_York', 'UTC'].map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </label>
          </div>
          <div class="switch" style={{ marginTop: 6 }}>
            <div>
              <div class="t">汇率</div>
              <div class="d">
                更新于 {state.fx.fetchedAt.slice(0, 16).replace('T', ' ')} · 1 USD = {state.fx.rates.CNY?.toFixed(3)} CNY · {state.fx.rates.TRY?.toFixed(2)} TRY · {state.fx.rates.NGN?.toFixed(0)} NGN ·{' '}
                {state.fx.rates.PHP?.toFixed(2)} PHP
              </div>
            </div>
            <button class="btn sm" onClick={() => run(refreshFx, '汇率已更新')}>
              刷新
            </button>
          </div>
          <div class="switch">
            <div>
              <div class="t">公开只读视图</div>
              <div class="d">开启后未登录访客可查看脱敏后的账本（隐藏备注、联系人、卡号尾号）</div>
            </div>
            <Toggle checked={s.publicView} onChange={(v) => run(() => saveSettings({ publicView: v }), v ? '已公开' : '已设为私密')} />
          </div>
        </div>

        <div class="card card-pad">
          <div class="eyebrow" style={{ marginBottom: 12 }}>
            数据
          </div>
          <div class="hstack">
            <button class="btn" onClick={() => pickFile('.csv,text/csv', onCsv)}>
              <Icon name="upload" /> 导入 CSV
            </button>
            <button class="btn" onClick={() => pickFile('.json,application/json', onJson)}>
              <Icon name="upload" /> 恢复备份
            </button>
            <button class="btn" onClick={exportCsv}>
              <Icon name="download" /> 导出 CSV
            </button>
            <button class="btn" onClick={() => download(`ledger-backup-${today}.json`, JSON.stringify({ subscriptions: state.subscriptions, methods: state.methods, settings: { ...s, icsToken: undefined } }, null, 2), 'application/json')}>
              <Icon name="download" /> 备份 JSON
            </button>
          </div>
          <small class="soft" style={{ display: 'block', marginTop: 10 }}>
            CSV 兼容 Subscriptions App 导出格式：Name, Currency, Price, Category, Cycle, Starts, Ends, Tags, Payment Account, URL, Notes。
          </small>
        </div>

        <div class="hstack">
          <span class="spacer" />
          <button class="btn danger" onClick={() => logout()}>
            退出登录
          </button>
        </div>
      </div>

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
          {importing.methods.length > 0 && <p class="muted" style={{ marginTop: 0 }}>将新建支付方式：{importing.methods.map((m) => m.name).join('、')}</p>}
          {importing.subs.map((x) => (
            <div key={x.id} class="log-row">
              <span>{x.name}</span>
              <span class="num soft">
                {x.currency} {x.price} / {cycleShort(x.cycle)}
              </span>
            </div>
          ))}
        </Sheet>
      )}
    </div>
  );
}
