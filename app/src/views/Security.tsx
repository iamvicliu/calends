import { copyParts } from '../components/copy.tsx';
import { useEffect, useState } from 'react';
import type { AppState } from '../../../shared/types.ts';
import { localTime } from '../../../shared/format.ts';
import { ask, Cell, Group, Icon, Sheet } from '../components/ui.tsx';
import { Picker } from '../components/Picker.tsx';
import { api, registerPasskey, run, saveSettings } from '../store.ts';
import { t } from '../../../shared/i18n.ts';

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
function describeUA(ua: string): { browser: string; os: string } {
  const v = (re: RegExp) => ua.match(re)?.[1]?.split('.')[0];
  let browser = t('settings.security.unknownBrowser');
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
  if (m < 15) return t('settings.security.ago.justNow');
  if (m < 60) return t('settings.security.ago.minutes', { count: m });
  if (m < 1440) return t('settings.security.ago.hours', { count: Math.round(m / 60) });
  if (m < 43200) return t('settings.security.ago.days', { count: Math.round(m / 1440) });
  return iso.slice(0, 10);
}

function DeviceCell({ d, tz, onRevoke }: { d: Device; tz: string; onRevoke: () => void }) {
  const { browser, os } = describeUA(d.userAgent);
  const where = [d.location, d.ip].filter(Boolean).join('\n');
  return (
    <Cell
      label={
        <span>
          {copyParts([browser, os].filter(Boolean).join('\n'))}
          {d.current && (
            <span className="pill" style={{ marginLeft: 8, color: 'var(--green)' }}>
              {t('settings.security.thisDevice')}
            </span>
          )}
        </span>
      }
      sub={[
        where,
        [
          t(d.method === 'passkey' ? 'settings.security.signedInPasskey' : 'settings.security.signedInPassword', { time: localTime(d.createdAt, tz, true) }),
          d.current ? '' : ago(d.lastSeenAt),
        ]
          .filter(Boolean)
          .join('\n'),
      ]
        .filter(Boolean)
        .join('\n')}
    >
      {!d.current && (
        <button type="button" className="chip-btn" onClick={onRevoke}>
          {t('settings.security.revoke')}
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
  const tz = state.settings.timezone;
  return (
    <>
      <Group title={t('settings.security.title')} foot={supported ? t('settings.security.passkeyFoot') : t('settings.security.passkeyUnsupported')}>
        {sec?.passkeys.map((p) => (
          <Cell
            key={p.id}
            label={p.name}
            sub={
              p.lastUsedAt
                ? t('settings.security.lastUsed', { time: localTime(p.lastUsedAt, tz, true) })
                : t('settings.security.addedAt', { time: localTime(p.createdAt, tz, true) })
            }
          >
            <button
              type="button"
              className="chip-btn"
              onClick={async () =>
                (await ask(t('settings.security.confirmRemovePasskey', { name: p.name }))) &&
                run(() => api(`/api/auth/passkey/${encodeURIComponent(p.id)}`, { method: 'DELETE' }).then(load), t('settings.security.removed'))
              }
            >
              {t('settings.security.remove')}
            </button>
          </Cell>
        ))}
        {supported && (
          <Cell
            label={
              <span style={{ color: 'var(--accent)' }}>
                <Icon name="key" /> {t('settings.security.addPasskey')}
              </span>
            }
            onClick={() =>
              run(async () => {
                try {
                  await registerPasskey(deviceName());
                } catch (e) {
                  if (e instanceof Error && e.name === 'NotAllowedError') return;
                  if (e instanceof Error && e.name === 'InvalidStateError') throw new Error(t('settings.security.alreadyBound'));
                  throw e;
                }
                await load();
              })
            }
          />
        )}
        <Cell label={t('settings.security.changePassword')} onClick={() => setPwSheet(true)} />
      </Group>
      <Group
        title={sec ? t('settings.security.devicesCount', { count: sec.sessions.length }) : t('settings.security.devices')}
        foot={t('settings.security.devicesFoot')}
      >
        <Cell label={t('settings.security.maxSessions')}>
          <Picker
            value={max}
            onChange={(n) => run(() => saveSettings({ maxSessions: n }).then(load), t('settings.security.maxSessionsSaved', { count: n }))}
            options={[1, 2, 3, 5, 10, 20].map((n) => ({ value: n, label: t('settings.security.deviceCount', { count: n }) }))}
            ariaLabel={t('settings.security.maxSessions')}
          />
        </Cell>
        {sec?.sessions
          .slice()
          .sort((a, b) => Number(b.current) - Number(a.current))
          .map((d) => (
            <DeviceCell
              key={d.id}
              d={d}
              tz={tz}
              onRevoke={() => run(() => api(`/api/auth/sessions/${d.id}`, { method: 'DELETE' }).then(load), t('settings.security.revoked'))}
            />
          ))}
        {sec && sec.sessions.length > 1 && (
          <button
            className="cell tap"
            style={{ justifyContent: 'center', color: 'var(--red)' }}
            onClick={async () =>
              (await ask(t('settings.security.confirmLogoutOthers'))) &&
              run(() => api('/api/auth/logout-others', { method: 'POST' }).then(load), t('settings.security.loggedOutOthers'))
            }
          >
            {t('settings.security.logoutOthers')}
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
    <input type="password" autoComplete={auto} value={value} placeholder={placeholder} onChange={(e) => set((e.target as HTMLInputElement).value)} />
  );
  return (
    <Sheet
      narrow
      title={t('settings.security.changePassword')}
      onClose={onClose}
      foot={
        <>
          <span className="grow" />
          <button
            className="btn primary"
            disabled={!ok}
            onClick={() =>
              run(async () => {
                await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ current: cur, next }) });
                onDone();
                onClose();
              }, t('settings.security.passwordChanged'))
            }
          >
            {t('settings.security.save')}
          </button>
        </>
      }
    >
      <div className="stack">
        <Group foot={next && again && next !== again ? t('settings.security.mismatch') : t('settings.security.passwordFoot')}>
          <Cell label={t('settings.security.currentPassword')}>{input(cur, setCur, '', 'current-password')}</Cell>
          <Cell label={t('settings.security.newPassword')}>{input(next, setNext, t('settings.security.minLength'), 'new-password')}</Cell>
          <Cell label={t('settings.security.confirmPassword')}>{input(again, setAgain, '', 'new-password')}</Cell>
        </Group>
      </div>
    </Sheet>
  );
}
