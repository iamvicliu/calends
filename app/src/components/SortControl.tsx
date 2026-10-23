import { t } from '../../../shared/i18n.ts';
import { Picker } from './Picker.tsx';
import { Icon, IconButton } from './ui.tsx';

/** 排序方式与方向：订阅与合租列表共用；选择器选字段，旁边的圆形按钮切换升降序 */
export function SortControl<T extends string>({
  value,
  dir,
  options,
  onSort,
  onDir,
}: {
  value: T;
  dir: 'asc' | 'desc';
  options: Array<{ value: T; label: string }>;
  onSort: (v: T) => void;
  onDir: (d: 'asc' | 'desc') => void;
}) {
  const label = dir === 'asc' ? t('list.sort.asc') : t('list.sort.desc');
  return (
    <>
      <Picker variant="btn" value={value} onChange={onSort} ariaLabel={t('list.sort.label')} options={options} />
      <IconButton type="button" onClick={() => onDir(dir === 'asc' ? 'desc' : 'asc')} aria-label={label} title={label}>
        <Icon name={dir === 'asc' ? 'sort-asc' : 'sort-desc'} />
      </IconButton>
    </>
  );
}
