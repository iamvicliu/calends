// 联系方式：渠道（Telegram、微信、邮箱…）+ 账号；合租成员、代付对象和人员名册共用
import type { ShareMember } from '../../../shared/types.ts';
import { t } from '../../../shared/i18n.ts';
import { Picker } from './Picker.tsx';
import { Icon } from './ui.tsx';

// 渠道值存进数据里（微信、邮箱等保持中文代码），显示时再翻译
const CONTACT_VIA = ['Telegram', '微信', 'WhatsApp', '邮箱', '手机', 'X', 'Discord', '其他'];
const VIA_KEY: Record<string, string> = { 微信: 'wechat', 邮箱: 'email', 手机: 'phone', 其他: 'other' };
/** 渠道的显示名：Telegram 等专名原样，微信、邮箱等按当前语言 */
export const viaLabel = (via: string): string => (VIA_KEY[via] ? t(`family.contact.via.${VIA_KEY[via]}`) : via);
const CONTACT_HINT: Record<string, string> = { Telegram: '@username', WhatsApp: '+63 …', 邮箱: 'name@example.com', 手机: '+86 …', X: '@handle' };
const contactHint = (via: string): string | undefined =>
  via === '微信' ? t('family.contact.hint.wechat') : via === 'Discord' ? t('family.contact.hint.discord') : CONTACT_HINT[via];

/** 用户名前面带 @ 的渠道：输入框里固定显示 @，存的时候去掉 */
const AT_VIA = new Set(['Telegram', 'X']);
const bare = (id: string) => id.replace(/^@+/, '');

/** 只要联系方式本身（如 @name、手机号），不带「Telegram」「微信」等渠道名；列表里用 */
export function contactValue(m: Pick<ShareMember, 'contactVia' | 'contact' | 'tg'>): string {
  const via = m.contactVia ?? (m.tg ? 'Telegram' : '');
  const id = m.contact ?? m.tg;
  if (!id) return '';
  return AT_VIA.has(via) ? `@${bare(id)}` : id;
}

/** 成员联系方式的一行文字：「Telegram @abc」 */
export function contactText(m: Pick<ShareMember, 'contactVia' | 'contact' | 'tg'>): string {
  const via = m.contactVia ?? (m.tg ? 'Telegram' : '');
  const id = m.contact ?? m.tg;
  if (!id) return '';
  const shown = AT_VIA.has(via) ? `@${bare(id)}` : id;
  return via && via !== '其他' ? `${viaLabel(via)} ${shown}` : shown;
}

/** 联系方式输入：渠道选择 + 账号；Telegram、X 固定显示 @，能直接打开的渠道后面带一个跳转按钮 */
export function ContactField({ via, value, onVia, onChange }: { via: string; value?: string; onVia: (v: string) => void; onChange: (id: string) => void }) {
  const at = AT_VIA.has(via);
  const url = contactUrl(via, value);
  return (
    <span className="contact-field">
      <Picker value={via} onChange={onVia} options={CONTACT_VIA.map((c) => ({ value: c, label: viaLabel(c) }))} ariaLabel={t('family.contact.viaAria')} />
      {at && <span className="contact-at">@</span>}
      <input
        value={at ? bare(value ?? '') : (value ?? '')}
        autoCapitalize="off"
        inputMode={via === '邮箱' ? 'email' : via === '手机' ? 'tel' : 'text'}
        placeholder={at ? bare(contactHint(via) ?? '') : (contactHint(via) ?? t('family.contact.hint.generic'))}
        onChange={(e) => {
          const v = (e.target as HTMLInputElement).value.trim();
          onChange(at ? bare(v) : v);
        }}
      />
      {url && (
        <a
          className="icon-btn contact-go"
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label={t('family.contact.open', { via: viaLabel(via) })}
          title={t('family.contact.open', { via: viaLabel(via) })}
        >
          <Icon name="link" />
        </a>
      )}
    </span>
  );
}

/** 能直接打开的联系链接：Telegram → t.me，X → x.com，WhatsApp → wa.me，邮箱、手机走系统 */
export function contactUrl(via: string, id?: string): string | undefined {
  if (!id) return undefined;
  if (via === 'Telegram') return `https://t.me/${bare(id)}`;
  if (via === 'X') return `https://x.com/${bare(id)}`;
  if (via === 'WhatsApp') return `https://wa.me/${id.replace(/\D/g, '')}`;
  if (via === '邮箱') return `mailto:${id}`;
  if (via === '手机') return `tel:${id.replace(/[^\d+]/g, '')}`;
  return undefined;
}
