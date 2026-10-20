import { useEffect, useState } from 'preact/hooks';
import type { AppState } from '../../shared/types.ts';
import { Cell, Group, Icon, Sheet } from '../components/ui.tsx';
import { Picker } from '../components/Picker.tsx';
import { api, registerPasskey, run, saveSettings } from '../store.ts';
import { confirmDelete } from './Editor.tsx';

interface Device {
  id: string;
  current: boolean;
  userAgent: string;
  ip: string;
  location: string;
  method: string;
  createdAt: string;
  lastSeenAt: string | null;
}

interface Security {
  passkeys: Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>;
  sessions: Device[];
}

const DEFAULT_MAX = 10;

/** 从 UA 认出浏览器和系统，例如「Chrome 141 · macOS」 */
export function describeUA(ua: string): { browser: string; os: string } {
  const v = (re: RegExp) => ua.match(re)?.[1]?.split('.')[0];
  let browser = '未知浏览器';
  if (/Edg\//.test(ua)) browser = `Edge ${v(/Edg\/([\d.]+)/) ?? ''}`;
  else if (/OPR\//.test(ua)) browser = `Opera ${v(/OPR\/([\d.]+)/) ?? ''}`;
  else if (/Firefox\//.test(ua)) browser = `Firefox ${v(/Firefox\/([\d.]+)/) ?? ''}`;
  else if (/CriOS\//.test(ua)) browser = `Chrome ${v(/CriOS\/([\d.]+)/) ?? ''}`;
  else if (/Chrome\//.test(ua)) browser = `Chrome ${v(/Chrome\/([\d.]+)/) ?? ''}`;
  else if (/Safari\//.test(ua)) browser = `Safari ${v(/Version\/([\d.]+)/) ?? ''}`;
  else if (/curl|wget|node|python/i.test(ua)) browser = ua.split('/')[0];
  let os = '';
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) os = `Android ${v(/Android ([\d.]+)/) ?? ''}`;
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser: browser.trim(), os: os.trim() };
}

function ago(iso: string | null): string {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 15) return '刚刚活跃';
  if (m < 60) return `${m} 分钟前`;
  if (m < 1440) return `${Math.round(m / 60)} 小时前`;
  if (m < 43200) return `${Math.round(m / 1440)} 天前`;
  return iso.slice(0, 10);
}

function DeviceCell({ d, onRevoke }: { d: Device; onRevoke: () => void }) {
  const { browser, os } = describeUA(d.userAgent);
  const where = [d.location, d.ip].filter(Boolean).join(' · ');
  return (
    <Cell
      label={
        <span>
          {[browser, os].filter(Boolean).join(' · ')}
          {d.current && <span class="pill" style={{ marginLeft: 8, color: 'var(--green)' }}>本机</span>}
        </span>
      }
      sub={[where, [`${d.method === 'passkey' ? 'Passkey ' : '密码'}登录于 ${d.createdAt.slice(0, 10)}`, d.current ? '' : ago(d.lastSeenAt)].filter(Boolean).join(' · ')].filter(Boolean).join('\n')}
    >
      {!d.current && (
        <button type="button" class="chip-btn" onClick={onRevoke}>
          移出
        </button>
      )}
    </Cell>
  );
}

/** 根据浏览器 UA 给新 Passkey 起个默认名字 */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Passkey';
}

/** 设置页的「安全」：Passkey、修改密码、其他设备下线 */
export function SecurityGroup({ state }: { state: AppState }) {
  const [sec, setSec] = useState<Security>();
  const [pwSheet, setPwSheet] = useState(false);
  const load = () => api<Security>('/api/auth/security').then(setSec, () => {});
  useEffect(() => void load(), []);
  const supported = typeof window.PublicKeyCredential === 'function';
  const max = state.settings.maxSessions ?? DEFAULT_MAX;
  return (
    <>
      <Group title="安全" foot={supported ? '绑定 Passkey 后可以用面容、指纹或设备密码登录，无需输入密码。' : '当前浏览器不支持 Passkey。'}>
        {sec?.passkeys.map((p) => (
          <Cell key={p.id} label={p.name} sub={p.lastUsedAt ? `上次使用 ${p.lastUsedAt.slice(0, 10)}` : `添加于 ${p.createdAt.slice(0, 10)}`}>
            <button
              type="button"
              class="chip-btn"
              onClick={() => confirmDelete(`移除 Passkey「${p.name}」？`) && run(() => api(`/api/auth/passkey/${encodeURIComponent(p.id)}`, { method: 'DELETE' }).then(load), '已移除')}
            >
              移除
            </button>
          </Cell>
        ))}
        {supported && (
          <Cell
            label={
              <span style={{ color: 'var(--accent)' }}>
                <Icon name="key" /> 添加 Passkey
              </span>
            }
            onClick={() =>
              run(async () => {
                try {
                  await registerPasskey(deviceName());
                } catch (e) {
                  if (e instanceof Error && e.name === 'NotAllowedError') return;
                  if (e instanceof Error && e.name === 'InvalidStateError') throw new Error('这台设备已经绑定过了');
                  throw e;
                }
                await load();
              })
            }
          />
        )}
        <Cell label="修改密码" onClick={() => setPwSheet(true)} />
      </Group>
      <Group title={sec ? `登录设备 · ${sec.sessions.length}` : '登录设备'} foot="超过上限时，最久没有活动的设备会被自动退出。位置按 IP 估算，仅供参考。">
        <Cell label="最多同时登录">
          <Picker
            value={max}
            onChange={(n) => run(() => saveSettings({ maxSessions: n }).then(load), `最多 ${n} 台设备`)}
            options={[1, 2, 3, 5, 10, 20].map((n) => ({ value: n, label: `${n} 台` }))}
            ariaLabel="最多同时登录"
          />
        </Cell>
        {sec?.sessions.slice().sort((a, b) => Number(b.current) - Number(a.current)).map((d) => (
          <DeviceCell key={d.id} d={d} onRevoke={() => run(() => api(`/api/auth/sessions/${d.id}`, { method: 'DELETE' }).then(load), '已移出')} />
        ))}
        {sec && sec.sessions.length > 1 && (
          <button class="cell tap" style={{ justifyContent: 'center', color: 'var(--red)' }} onClick={() => confirmDelete('退出除本机外的所有设备？') && run(() => api('/api/auth/logout-others', { method: 'POST' }).then(load), '其他设备已退出')}>
            退出其他所有设备
          </button>
        )}
      </Group>
      {pwSheet && <PasswordSheet onClose={() => setPwSheet(false)} onDone={load} />}
    </>
  );
}

function PasswordSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const ok = cur && next.length >= 8 && next === again;
  const input = (value: string, set: (v: string) => void, placeholder: string, auto: string) => (
    <input type="password" autoComplete={auto} value={value} placeholder={placeholder} onInput={(e) => set((e.target as HTMLInputElement).value)} />
  );
  return (
    <Sheet
      narrow
      title="修改密码"
      onClose={onClose}
      foot={
        <>
          <span class="grow" />
          <button
            class="btn primary"
            disabled={!ok}
            onClick={() =>
              run(async () => {
                await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ current: cur, next }) });
                onDone();
                onClose();
              }, '密码已修改，其他设备已退出')
            }
          >
            保存
          </button>
        </>
      }
    >
      <div class="stack">
        <Group foot={next && again && next !== again ? '两次输入不一致' : '至少 8 位。修改后，除当前设备外的登录都会失效。'}>
          <Cell label="当前密码">{input(cur, setCur, '', 'current-password')}</Cell>
          <Cell label="新密码">{input(next, setNext, '至少 8 位', 'new-password')}</Cell>
          <Cell label="确认新密码">{input(again, setAgain, '', 'new-password')}</Cell>
        </Group>
      </div>
    </Sheet>
  );
}
