import { isIconName } from '../../shared/categories.ts';
import { CAT_ICONS } from './cat-icons.gen.ts';

/** 分类图标：Lucide 图标名按线性图标画，其余当 emoji 显示；后台和公开页共用 */
export function CatGlyph({ icon, size = 14, class: cls = 'i' }: { icon?: string; size?: number; class?: string }) {
  if (icon && !isIconName(icon)) {
    return (
      <span class={`${cls} cat-emo`} style={{ width: size, height: size, fontSize: Math.round(size * 0.92) }} aria-hidden="true">
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
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      width={size}
      height={size}
      aria-hidden="true"
      class={cls}
      dangerouslySetInnerHTML={{ __html: CAT_ICONS[icon ?? 'tag'] ?? CAT_ICONS.tag }}
    />
  );
}
