import { useEffect, useState } from 'preact/hooks';
import { cycleShort } from '../../shared/billing.ts';
import { importSubscriptionsCsv, toCsv } from '../../shared/csv.ts';
import { CURRENCIES } from '../../shared/format.ts';
import type { AppState, PaymentMethod, Subscription } from '../../shared/types.ts';
import { Cell, Group, Icon, Sheet, Toggle, Toolbar } from '../components/ui.tsx';
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

  const hour = (h: number) => `${String(h).padStart(2, '0')}:05`;
  const sel = (e: Event) => (e.target as HTMLSelectElement).value;
  return (
    <>
      <Toolbar title="设置" />
      <div class="page fade-in stack" style={{ maxWidth: 720, gap: 26, margin: '0 auto' }}>
        <Group title="邮件提醒" foot="每天到点检查一次：即将扣款、试用到期、余额不足、拼车待收、到期不续，合并成一封邮件。">
          <Cell label="通知邮箱">
            <input type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
            {email !== s.notifyEmail && (
              <button class="btn primary" onClick={() => run(() => saveSettings({ notifyEmail: email.trim() }), '已保存')}>
                保存
              </button>
            )}
          </Cell>
          <Cell label="默认提前">
            <select value={s.remindDays} onChange={(e) => run(() => saveSettings({ remindDays: Number(sel(e)) }))}>
              {[0, 1, 2, 3, 5, 7, 14].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? '到期当天' : `${n} 天`}
                </option>
              ))}
            </select>
          </Cell>
          <Cell label="发送时间">
            <select value={s.notifyHour} onChange={(e) => run(() => saveSettings({ notifyHour: Number(sel(e)) }))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hour(h)}
                </option>
              ))}
            </select>
          </Cell>
          <Cell label="每月 1 日账单预告" sub="列出当月所有预计扣款">
            <Toggle checked={s.monthlyDigest} onChange={(v) => run(() => saveSettings({ monthlyDigest: v }))} />
          </Cell>
          <Cell
            label={<span style={{ color: 'var(--accent)' }}>发送测试邮件</span>}
            onClick={() =>
              run(async () => {
                const r = await api<{ sent: boolean; reason?: string }>('/api/notify/test', { method: 'POST' });
                if (!r.sent) throw new Error(r.reason ?? '发送失败');
                loadPreview();
              }, `测试邮件已发往 ${s.notifyEmail}`)
            }
          />
          <Cell label={<span style={{ color: 'var(--accent)' }}>预览今天的提醒邮件</span>} onClick={() => window.open('/api/notify/preview?html=1', '_blank')} />
        </Group>

        {preview && (
          <Group title={`今天（${preview.day}）`} foot={preview.log.length ? undefined : '还没有发送记录'}>
            {preview.digests.length === 0 ? (
              <div class="cell muted">今天没有需要提醒的事项</div>
            ) : (
              preview.digests.map((d) => (
                <Cell key={d.key} label={d.subject}>
                  {d.sections.reduce((a, x) => a + x.rows.length, 0)} 项
                </Cell>
              ))
            )}
            {preview.log.slice(0, 6).map((l) => (
              <Cell key={l.dedupe_key} label={<span style={{ fontSize: 13.5 }}>{l.subject}</span>}>
                <span style={{ color: l.status === 'sent' ? undefined : 'var(--red)', fontSize: 12.5 }}>{l.sent_at.slice(5, 16)}</span>
              </Cell>
            ))}
          </Group>
        )}

        <Group title="日历" foot="订阅后扣款日会出现在 Apple 日历 / Google 日历中，并按提醒设置提前弹出通知。">
          <Cell label="订阅到系统日历" onClick={() => setIcs(true)}>
            {s.icsToken ? '已开启' : '未开启'}
          </Cell>
        </Group>

        <Group title="显示">
          <Cell label="本位币">
            <select value={s.baseCurrency} onChange={(e) => run(() => saveSettings({ baseCurrency: sel(e) }))}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Cell>
          <Cell label="时区">
            <select value={s.timezone} onChange={(e) => run(() => saveSettings({ timezone: sel(e) }))}>
              {['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Manila', 'Asia/Singapore', 'Europe/Istanbul', 'Europe/London', 'America/Los_Angeles', 'America/New_York', 'UTC'].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </Cell>
          <Cell label="汇率" sub={`更新于 ${state.fx.fetchedAt.slice(0, 16).replace('T', ' ')}`} onClick={() => run(refreshFx, '汇率已更新')}>
            1 USD = {state.fx.rates.CNY?.toFixed(2)} CNY · {state.fx.rates.TRY?.toFixed(1)} TRY
          </Cell>
        </Group>

        <Group title="隐私" foot="开启后未登录的访客能看到脱敏后的账本：隐藏备注、拼车联系人和卡号尾号。">
          <Cell label="公开只读视图">
            <Toggle checked={s.publicView} onChange={(v) => run(() => saveSettings({ publicView: v }), v ? '已公开' : '已设为私密')} />
          </Cell>
        </Group>

        <Group title="数据" foot="CSV 兼容 Subscriptions App 的导出格式。">
          <Cell label="导入 CSV" onClick={() => pickFile('.csv,text/csv', onCsv)} />
          <Cell label="从 JSON 备份恢复" onClick={() => pickFile('.json,application/json', onJson)} />
          <Cell label="导出 CSV" onClick={exportCsv} />
          <Cell
            label="导出 JSON 备份"
            onClick={() => download(`ledger-backup-${today}.json`, JSON.stringify({ subscriptions: state.subscriptions, methods: state.methods, settings: { ...s, icsToken: undefined } }, null, 2), 'application/json')}
          />
        </Group>

        <Group>
          <button class="cell tap" style={{ justifyContent: 'center', color: 'var(--red)' }} onClick={() => logout()}>
            退出登录
          </button>
        </Group>
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
