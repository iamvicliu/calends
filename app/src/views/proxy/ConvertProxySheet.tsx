import { useState } from 'react';
import { t } from '../../../../shared/i18n.ts';
import type { AppState, Proxy, Subscription } from '../../../../shared/types.ts';
import { Cell, Group } from '../../components/ui.tsx';
import { ContactField, contactText } from '../../components/Contact.tsx';
import { useSubmit } from '../../components/inputs.tsx';
import { Sheet } from '../../components/overlays.tsx';
import { getState, savePerson, saveSub } from '../../store.ts';
import { run } from '../../toast.ts';
import { linkPerson, PersonPicker } from '../person-fields.tsx';

/** 转为代付：选已有的人，或填写新对象；只补代付信息，订阅历史不变 */
export function ConvertProxySheet({ state, s, onClose }: { state: AppState; s: Subscription; onClose: () => void }) {
  const [proxy, setProxy] = useState<Proxy>({ forName: '' });
  const linked = !!proxy.personId && !!state.people?.some((p) => p.id === proxy.personId);
  const [busy, submit] = useSubmit();
  const save = () =>
    submit(() =>
      run(async () => {
        const current = getState().subscriptions.find((x) => x.id === s.id);
        // 弹窗打开后可能已被其他入口修改或删除，不能覆盖它的身份或重建订阅
        if (!current || current.share || current.proxy) throw new Error(t('proxy.convert.changed'));
        const forName = proxy.forName.trim();
        const link = await linkPerson(getState(), proxy.personId, forName, proxy.contact ? (proxy.contactVia ?? 'Telegram') : undefined, proxy.contact);
        const latest = getState().subscriptions.find((x) => x.id === s.id);
        if (!latest || latest.share || latest.proxy) throw new Error(t('proxy.convert.changed'));
        await saveSub({ ...latest, proxy: { ...proxy, forName, personId: link.id } });
        if (link.after) await savePerson(link.after);
        onClose();
      }, t('proxy.convert.saved')),
    );
  return (
    <Sheet
      narrow
      title={t('proxy.convert.title', { name: s.name })}
      onClose={onClose}
      foot={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={busy || !proxy.forName.trim()} onClick={() => void save()}>
            {t('proxy.convert.submit')}
          </button>
        </>
      }
    >
      <Group>
        {(state.people?.length ?? 0) > 0 && (
          <Cell label={t('people.field.person')}>
            <PersonPicker
              state={state}
              value={linked ? proxy.personId : undefined}
              onPick={(p) => setProxy(p ? { forName: p.name, personId: p.id, contactVia: p.contactVia, contact: p.contact } : { forName: '' })}
            />
          </Cell>
        )}
        {linked ? (
          <Cell label={t('editor.proxy.contact')}>
            <span className={contactText(proxy) ? undefined : 'muted'}>{contactText(proxy) || t('people.field.noContact')}</span>
          </Cell>
        ) : (
          <>
            <Cell label={t('editor.proxy.for')}>
              <input value={proxy.forName} placeholder={t('editor.proxy.forPlaceholder')} onChange={(e) => setProxy({ ...proxy, forName: e.target.value })} />
            </Cell>
            <Cell label={t('editor.proxy.contact')}>
              <ContactField
                via={proxy.contactVia ?? 'Telegram'}
                value={proxy.contact}
                onVia={(contactVia) => setProxy({ ...proxy, contactVia })}
                onChange={(contact) => setProxy({ ...proxy, contactVia: proxy.contactVia ?? 'Telegram', contact: contact || undefined })}
              />
            </Cell>
          </>
        )}
      </Group>
    </Sheet>
  );
}
