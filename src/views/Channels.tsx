import { useState } from 'preact/hooks';
import { uid } from '../../shared/billing.ts';
import { channelsOf, type AppState, type Channel, type ChannelKind } from '../../shared/types.ts';
import { Cell, Group, Icon, Sheet, Toggle } from '../components/ui.tsx';
import { Picker } from '../components/Picker.tsx';
import { api, run, saveSettings, toast } from '../store.ts';
import { confirmDelete } from './Editor.tsx';

interface Field {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
}

/** 每种渠道要填什么；logo 是白色标志，放在品牌色底上 */
export const KINDS: Record<ChannelKind, { name: string; color: string; logo?: string; mark?: string; fields: Field[]; help?: string }> = {
  email: { name: '邮件', color: '#ea4335', logo: '/channels/gmail.svg', fields: [{ key: 'to', label: '收件邮箱', placeholder: 'you@example.com' }], help: '经 Cloudflare Email Sending 发出，需要域名已在 Cloudflare 验证' },
  telegram: { name: 'Telegram', color: '#26a5e4', logo: '/channels/telegram.svg', fields: [{ key: 'token', label: 'Bot Token', placeholder: '123456:ABC…', secret: true }, { key: 'chatId', label: 'Chat ID', placeholder: '你的用户 ID 或群 ID' }], help: '找 @BotFather 建机器人拿 Token；先给机器人发一条消息，再用 @userinfobot 查自己的 ID' },
  lark: { name: '飞书 / Lark', color: '#3370ff', mark: '飞', fields: [{ key: 'webhook', label: 'Webhook 地址', placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/…' }, { key: 'secret', label: '签名密钥', placeholder: '开启「签名校验」时填', secret: true, optional: true }], help: '群设置 → 群机器人 → 添加自定义机器人' },
  dingtalk: { name: '钉钉', color: '#1677ff', mark: '钉', fields: [{ key: 'webhook', label: 'Webhook 地址', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=…' }, { key: 'secret', label: '加签密钥', placeholder: 'SEC…，开启「加签」时填', secret: true, optional: true }], help: '群设置 → 机器人 → 自定义机器人' },
  wecom: { name: '企业微信', color: '#07c160', logo: '/channels/wechat.svg', fields: [{ key: 'webhook', label: 'Webhook 地址', placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…' }], help: '群聊 → 添加群机器人' },
  bark: { name: 'Bark', color: '#f04d4d', mark: 'B', fields: [{ key: 'key', label: 'Device Key', placeholder: 'App 里复制的 Key', secret: true }, { key: 'server', label: '服务器', placeholder: 'https://api.day.app', optional: true }], help: 'iPhone 推送，App Store 搜 Bark' },
  ntfy: { name: 'ntfy', color: '#317f6f', logo: '/channels/ntfy.svg', fields: [{ key: 'topic', label: 'Topic', placeholder: '随便起一个不易猜到的名字' }, { key: 'server', label: '服务器', placeholder: 'https://ntfy.sh', optional: true }, { key: 'token', label: '访问令牌', secret: true, optional: true }], help: '手机装 ntfy App 订阅同一个 Topic' },
  serverchan: { name: 'Server酱', color: '#4e5bf2', mark: '酱', fields: [{ key: 'key', label: 'SendKey', placeholder: 'SCT… 或 sctp…', secret: true }], help: '推送到微信（Server酱 Turbo / ³）' },
  discord: { name: 'Discord', color: '#5865f2', logo: '/channels/discord.svg', fields: [{ key: 'webhook', label: 'Webhook 地址', placeholder: 'https://discord.com/api/webhooks/…' }], help: '频道设置 → 整合 → Webhook' },
  slack: { name: 'Slack', color: '#4a154b', logo: '/channels/slack.svg', fields: [{ key: 'webhook', label: 'Webhook 地址', placeholder: 'https://hooks.slack.com/services/…' }], help: 'Slack App → Incoming Webhooks' },
  webhook: { name: '自定义 Webhook', color: '#3a3f47', mark: '{}', fields: [{ key: 'url', label: 'URL', placeholder: 'https://…' }, { key: 'header', label: '附加请求头', placeholder: 'Authorization: Bearer …', secret: true, optional: true }], help: 'POST JSON：subject、intro、sections、text、markdown、url' },
};

export function ChannelMark({ kind, size = 28 }: { kind: ChannelKind; size?: number }) {
  const k = KINDS[kind];
  return (
    <span class="ch-mark" style={{ background: k.color, width: size, height: size }}>
      {k.logo ? <img src={k.logo} alt="" /> : <b>{k.mark}</b>}
    </span>
  );
}

const test = (channel: Channel | string) =>
  run(async () => {
    const r = await api<{ sent: boolean; reason?: string }>('/api/notify/test', { method: 'POST', body: JSON.stringify({ channel }) });
    if (!r.sent) throw new Error(r.reason ?? '发送失败');
  }, '测试消息已发出');

/** 设置页的「通知渠道」：列表、开关、测试、编辑、添加 */
export function ChannelsGroup({ state }: { state: AppState }) {
  const list = channelsOf(state.settings);
  const [edit, setEdit] = useState<Channel | null>(null);
  const save = (next: Channel[]) => saveSettings({ channels: next });
  return (
    <>
      <Group title={`通知渠道 · ${list.filter((c) => c.enabled).length} 个开启`}>
        {list.length === 0 && <div class="cell muted">还没有渠道，提醒不会发出。</div>}
        {list.map((c) => (
          <div key={c.id} class="cell ch-row">
            <button type="button" class="ch-main" onClick={() => setEdit(c)}>
              <ChannelMark kind={c.kind} />
              <span class="cell-l">
                {c.name}
                <small>{c.kind === 'email' && c.config.to ? c.config.to : KINDS[c.kind].name}</small>
              </span>
            </button>
            <button type="button" class="chip-btn" onClick={() => test(c.id)}>
              测试
            </button>
            <Toggle checked={c.enabled} onChange={(v) => run(() => save(list.map((x) => (x.id === c.id ? { ...x, enabled: v } : x))))} />
          </div>
        ))}
        <div class="cell">
          <Picker
            value=""
            onChange={(k) => k && setEdit({ id: uid(), kind: k as ChannelKind, name: KINDS[k as ChannelKind].name, enabled: true, config: {} })}
            options={(Object.keys(KINDS) as ChannelKind[]).map((k) => ({ value: k, label: KINDS[k].name, icon: <ChannelMark kind={k} size={20} /> }))}
            display={
              <>
                <Icon name="plus" /> 添加渠道
              </>
            }
            ariaLabel="添加渠道"
          />
        </div>
      </Group>
      {edit && (
        <ChannelSheet
          c={edit}
          isNew={!list.some((x) => x.id === edit.id)}
          onClose={() => setEdit(null)}
          onSave={(c) =>
            run(async () => {
              await save(list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]);
              setEdit(null);
            }, '已保存')
          }
          onDelete={() =>
            confirmDelete(`删除渠道「${edit.name}」？`) &&
            run(async () => {
              await save(list.filter((x) => x.id !== edit.id));
              setEdit(null);
            }, '已删除')
          }
        />
      )}
    </>
  );
}

function ChannelSheet({ c, isNew, onClose, onSave, onDelete }: { c: Channel; isNew: boolean; onClose: () => void; onSave: (c: Channel) => void; onDelete: () => void }) {
  const [f, setF] = useState<Channel>(c);
  const k = KINDS[f.kind];
  const missing = k.fields.filter((x) => !x.optional && !f.config[x.key]?.trim());
  return (
    <Sheet
      narrow
      title={isNew ? `添加 ${k.name}` : f.name}
      onClose={onClose}
      foot={
        <>
          {!isNew && (
            <button class="btn danger" onClick={onDelete}>
              删除
            </button>
          )}
          <span class="grow" />
          <button class="btn" disabled={missing.length > 0} onClick={() => (missing.length ? toast(`请填写${missing[0].label}`, true) : test(f))}>
            测试
          </button>
          <button class="btn primary" disabled={missing.length > 0} onClick={() => onSave(f)}>
            保存
          </button>
        </>
      }
    >
      <div class="stack">
        <Group foot={k.help}>
          <Cell label="名称">
            <input value={f.name} onInput={(e) => setF({ ...f, name: (e.target as HTMLInputElement).value })} />
          </Cell>
          {k.fields.map((x) => (
            <Cell key={x.key} label={x.label}>
              <input
                type={x.secret ? 'password' : 'text'}
                autoComplete="off"
                autoCapitalize="off"
                value={f.config[x.key] ?? ''}
                placeholder={x.placeholder ?? (x.optional ? '可选' : '')}
                onInput={(e) => setF({ ...f, config: { ...f.config, [x.key]: (e.target as HTMLInputElement).value.trim() } })}
              />
            </Cell>
          ))}
          <Cell label="启用">
            <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
          </Cell>
        </Group>
      </div>
    </Sheet>
  );
}
