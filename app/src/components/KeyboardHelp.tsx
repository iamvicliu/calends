import { commandLabel } from '../keyboard.ts';
import { t } from '../../../shared/i18n.ts';
import { Cell, Group, Sheet } from './ui.tsx';

/** Only mounted by ?, with the same focus containment and dismissal as other sheets. */
export function KeyboardHelp({ onClose }: { onClose: () => void }) {
  const cmd = commandLabel();
  const groups = [
    [
      'global',
      [
        [`${cmd} K`, 'search'],
        [`${cmd} B`, 'sidebar'],
        ['N', 'new'],
        ['1–9', 'navigate'],
        ['?', 'help'],
      ],
    ],
    [
      'page',
      [
        ['/', 'pageSearch'],
        ['E', 'edit'],
      ],
    ],
    [
      'forms',
      [
        ['Enter', 'enter'],
        [`${cmd} Enter / ${cmd} S`, 'submit'],
        ['Esc', 'close'],
        ['Enter', 'confirm'],
      ],
    ],
    [
      'calendar',
      [
        ['← / →', 'months'],
        ['T', 'today'],
      ],
    ],
  ] as const;
  return (
    <Sheet narrow title={t('app.shortcuts.title')} onClose={onClose}>
      <div className="stack">
        {groups.map(([group, rows]) => (
          <Group key={group} title={t(`app.shortcuts.${group}`)}>
            {rows.map(([key, label]) => (
              <Cell key={label} label={t(`app.shortcuts.${label}`)}>
                <kbd>{key}</kbd>
              </Cell>
            ))}
          </Group>
        ))}
        <p className="muted">{t('app.shortcuts.hint')}</p>
      </div>
    </Sheet>
  );
}
