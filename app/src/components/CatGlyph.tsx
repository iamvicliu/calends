import { isIconName } from '../../../shared/categories.ts';
import { CAT_ICONS } from './cat-icons.gen.ts';

/** 分类图标：Lucide 图标名按线性图标画，其余当 emoji 显示；后台和公开页共用 */
export function CatGlyph({ icon, size = 14, className: cls = 'i' }: { icon?: string; size?: number; className?: string }) {
  if (icon && !isIconName(icon)) {
    return (
      <span className={`${cls} cat-emo`} style={{ width: size, height: size, fontSize: 'var(--fs-1)' }} aria-hidden="true">
        {icon}
      </span>
    );
  }
  // 生成的图标数据是写死在仓库里的 SVG 片段，不含用户输入
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      aria-hidden="true"
      className={cls}
      dangerouslySetInnerHTML={{ __html: CAT_ICONS[icon ?? 'tag'] ?? CAT_ICONS.tag }}
    />
  );
}
