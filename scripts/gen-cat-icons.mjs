// 生成分类图标集（app/src/components/cat-icons.gen.ts）：从 lucide-react 取精选图标的路径数据，按主题分组。
// 只嵌路径，不引入 React 组件，后台和公开页按名称渲染。改了下面的列表后运行：node scripts/gen-cat-icons.mjs
// 图标来自 Lucide（ISC 许可）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const GROUPS = {
  common: [
    'tag',
    'star',
    'heart',
    'bookmark',
    'flag',
    'sparkles',
    'zap',
    'flame',
    'crown',
    'gem',
    'gift',
    'award',
    'trophy',
    'rocket',
    'target',
    'bell',
    'infinity',
    'circle-dot',
    'box',
    'layers',
  ],
  tech: [
    'bot',
    'brain',
    'cpu',
    'code',
    'square-terminal',
    'server',
    'cloud',
    'database',
    'hard-drive',
    'globe',
    'wifi',
    'shield-check',
    'lock',
    'key-round',
    'network',
    'router',
    'monitor',
    'laptop',
    'smartphone',
    'tablet',
    'watch',
    'keyboard',
    'git-branch',
    'bug',
    'app-window',
    'qr-code',
  ],
  media: [
    'square-play',
    'film',
    'clapperboard',
    'tv',
    'music',
    'headphones',
    'radio',
    'mic',
    'podcast',
    'camera',
    'image',
    'gamepad',
    'gamepad-2',
    'joystick',
    'dices',
    'puzzle',
    'ticket',
    'popcorn',
    'drama',
    'book-open',
    'newspaper',
    'rss',
  ],
  work: [
    'briefcase',
    'calendar',
    'clipboard-list',
    'list-checks',
    'notebook-pen',
    'pen-tool',
    'pencil',
    'file-text',
    'folder',
    'archive',
    'mail',
    'message-circle',
    'send',
    'inbox',
    'presentation',
    'chart-column',
    'chart-pie',
    'calculator',
    'clock',
    'wrench',
    'hammer',
    'settings',
    'palette',
    'brush',
    'scissors',
    'layout-grid',
  ],
  money: [
    'shopping-bag',
    'shopping-cart',
    'store',
    'credit-card',
    'wallet',
    'banknote',
    'coins',
    'piggy-bank',
    'receipt',
    'percent',
    'badge-dollar-sign',
    'landmark',
    'chart-candlestick',
    'bitcoin',
    'package',
    'truck',
  ],
  life: [
    'house',
    'sofa',
    'lamp',
    'bed',
    'bath',
    'shirt',
    'baby',
    'dog',
    'cat',
    'paw-print',
    'leaf',
    'sprout',
    'flower-2',
    'trees',
    'sun',
    'moon',
    'umbrella',
    'droplet',
    'lightbulb',
    'plug',
    'battery',
    'recycle',
  ],
  food: ['utensils', 'coffee', 'pizza', 'cake', 'wine', 'beer', 'cookie', 'apple', 'salad', 'ice-cream-cone', 'shopping-basket', 'chef-hat'],
  health: ['heart-pulse', 'activity', 'dumbbell', 'bike', 'footprints', 'pill', 'stethoscope', 'syringe', 'smile', 'brain-circuit'],
  travel: ['car', 'bus', 'train-front', 'plane', 'ship', 'fuel', 'map', 'map-pin', 'compass', 'mountain', 'tent', 'luggage', 'hotel'],
  people: ['user', 'users', 'heart-handshake', 'message-square', 'phone', 'graduation-cap', 'school', 'book', 'library', 'languages', 'church', 'hand-heart'],
};

const ROOT = new URL('../node_modules/lucide-react/dist/esm/icons/', import.meta.url).pathname;
const icons = {};
const groups = {};
for (const [g, names] of Object.entries(GROUPS)) {
  groups[g] = [];
  for (const name of names) {
    const file = `${ROOT}${name}.mjs`;
    if (!existsSync(file)) {
      console.warn('missing', name);
      continue;
    }
    groups[g].push(name);
    if (icons[name]) continue;
    // icons/<name>.mjs 里的 __iconData.node：[[标签, 属性], …]
    // 改过名的图标（music → eighth-notes）只是转出，顺着找到真正的文件
    const alias = readFileSync(file, 'utf8').match(/export \{ default \} from '\.\/([\w-]+)\.mjs'/)?.[1];
    const { __iconData } = await import(alias ? `${ROOT}${alias}.mjs` : file);
    icons[name] = __iconData.node
      .map(
        ([tag, attrs]) =>
          `<${tag} ${Object.entries(attrs)
            .filter(([k]) => k !== 'key')
            .map(([k, v]) => `${k}="${v}"`)
            .join(' ')}/>`,
      )
      .join('');
  }
}
const out = [
  '// 由 scripts/gen-cat-icons.mjs 从 lucide-react 生成，请勿手改。图标来自 Lucide（ISC 许可）',
  `export const CAT_ICONS: Record<string, string> = ${JSON.stringify(icons, null, 1)};`,
  '',
  '/** 图标选择器里的主题分组（名称取 settings.cat.group.*） */',
  `export const CAT_ICON_GROUPS: Record<string, string[]> = ${JSON.stringify(groups)};`,
  '',
].join('\n');
writeFileSync(new URL('../app/src/components/cat-icons.gen.ts', import.meta.url), out);
console.log(`${Object.keys(icons).length} icons`);
