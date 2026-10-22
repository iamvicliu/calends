// 常用服务目录：新建订阅时按名称联想，选中后带出 logo、分类和官网。
// AI 产品的图标来自 lobe-icons（MIT），放在 public/ai；不带价格，价格变得太快，留给用户自己填。
import { t } from '../../shared/i18n.ts';
import { presetCat } from './derive.ts';

export interface CatalogItem {
  name: string;
  /** 别名、厂商名、中文名，都参与搜索 */
  aka: string[];
  icon: string;
  category: string;
  url: string;
  chargeLeadDays?: number;
  cancelLeadDays?: number;
}

type Cat = 'ai' | 'tools' | 'productivity' | 'domains';
/** 目录里只存分类代码；名称在 catalog.name.<file> 里有译名时按当前语言显示，原名仍参与搜索 */
type Entry = { name: string; file: string; aka: string[]; cat: Cat; url: string; icon?: string; chargeLeadDays?: number; cancelLeadDays?: number };
const LOCALIZED = new Set(['qwen', 'doubao', 'yuanbao', 'zhipu', 'coze', 'kling', 'hailuo', 'hunyuan']);

const ai = (name: string, file: string, url: string, aka: string[] = [], cat: Cat = 'ai'): Entry => ({ name, file, aka, cat, url });

/** 选中目录项时才取文案：分类会写进订阅，所以按当前语言给默认值 */
function resolve(e: Entry): CatalogItem {
  const name = LOCALIZED.has(e.file) ? t(`catalog.name.${e.file}`) : e.name;
  return {
    name,
    aka: name === e.name ? e.aka : [e.name, ...e.aka],
    icon: e.icon ?? `/ai/${e.file}.svg`,
    chargeLeadDays: e.chargeLeadDays,
    cancelLeadDays: e.cancelLeadDays,
    category: presetCat(e.cat),
    url: e.url,
  };
}

const CATALOG: Entry[] = [
  {
    name: 'Cloudflare Registrar',
    file: 'cloudflare',
    aka: ['cloudflare', 'domain', '域名'],
    cat: 'domains',
    url: 'https://www.cloudflare.com/products/registrar/',
    icon: 'https://www.cloudflare.com/favicon.ico',
    chargeLeadDays: 30,
  },
  {
    name: 'Apple App Store',
    file: 'appstore',
    aka: ['apple', 'app store', '苹果订阅'],
    cat: 'tools',
    url: 'https://apps.apple.com',
    icon: 'https://www.apple.com/favicon.ico',
    cancelLeadDays: 1,
  },
  ai('ChatGPT', 'openai', 'https://chatgpt.com', ['openai', 'gpt', 'chatgpt plus', 'chatgpt pro']),
  ai('Claude', 'claude', 'https://claude.ai', ['anthropic', 'claude pro', 'claude max']),
  ai('Gemini', 'gemini', 'https://gemini.google.com', ['google ai pro', 'google one ai', 'bard']),
  ai('Grok', 'grok', 'https://grok.com', ['xai', 'supergrok']),
  ai('Perplexity', 'perplexity', 'https://www.perplexity.ai', ['perplexity pro']),
  ai('DeepSeek', 'deepseek', 'https://www.deepseek.com', ['深度求索']),
  ai('Kimi', 'kimi', 'https://kimi.com', ['moonshot', '月之暗面', 'kimi code']),
  ai('通义千问', 'qwen', 'https://tongyi.aliyun.com', ['qwen', '通义', '千问']),
  ai('豆包', 'doubao', 'https://www.doubao.com', ['doubao', '字节']),
  ai('腾讯元宝', 'yuanbao', 'https://yuanbao.tencent.com', ['yuanbao', '元宝']),
  ai('智谱清言', 'zhipu', 'https://chatglm.cn', ['zhipu', 'chatglm', 'glm']),
  ai('MiniMax', 'minimax', 'https://www.minimax.io', ['海螺']),
  ai('Mistral', 'mistral', 'https://mistral.ai', ['le chat']),
  ai('Poe', 'poe', 'https://poe.com'),
  ai('Monica', 'monica', 'https://monica.im'),
  ai('Manus', 'manus', 'https://manus.im'),
  ai('OpenRouter', 'openrouter', 'https://openrouter.ai'),
  ai('Microsoft Copilot', 'copilot', 'https://copilot.microsoft.com', ['copilot pro', 'microsoft 365 copilot']),
  ai('GitHub Copilot', 'githubcopilot', 'https://github.com/features/copilot', ['copilot'], 'tools'),
  ai('Cursor', 'cursor', 'https://cursor.com', ['cursor pro'], 'tools'),
  ai('Windsurf', 'windsurf', 'https://windsurf.com', ['codeium'], 'tools'),
  ai('Trae', 'trae', 'https://www.trae.ai', [], 'tools'),
  ai('Cline', 'cline', 'https://cline.bot', [], 'tools'),
  ai('Devin', 'devin', 'https://devin.ai', ['cognition'], 'tools'),
  ai('v0', 'v0', 'https://v0.dev', ['vercel'], 'tools'),
  ai('Lovable', 'lovable', 'https://lovable.dev', [], 'tools'),
  ai('Replit', 'replit', 'https://replit.com', [], 'tools'),
  ai('Hugging Face', 'huggingface', 'https://huggingface.co', ['hf'], 'tools'),
  ai('扣子', 'coze', 'https://www.coze.cn', ['coze']),
  ai('Midjourney', 'midjourney', 'https://www.midjourney.com', ['mj']),
  ai('Ideogram', 'ideogram', 'https://ideogram.ai'),
  ai('Krea', 'krea', 'https://www.krea.ai'),
  ai('Runway', 'runway', 'https://runwayml.com', ['runwayml']),
  ai('Pika', 'pika', 'https://pika.art'),
  ai('可灵', 'kling', 'https://klingai.com', ['kling']),
  ai('海螺 AI', 'hailuo', 'https://hailuoai.com', ['hailuo']),
  ai('Suno', 'suno', 'https://suno.com'),
  ai('Udio', 'udio', 'https://www.udio.com'),
  ai('ElevenLabs', 'elevenlabs', 'https://elevenlabs.io', ['11labs']),
  ai('腾讯混元', 'hunyuan', 'https://hunyuan.tencent.com', ['hunyuan']),
  ai('Notion', 'notion', 'https://www.notion.so', ['notion ai'], 'productivity'),
  ai('Figma', 'figma', 'https://www.figma.com', [], 'tools'),
];

/** 名称联想：前缀命中排前面，其次是包含 */
export function searchCatalog(q: string, limit = 4): CatalogItem[] {
  const k = q.trim().toLowerCase();
  if (k.length < 1) return [];
  const score = (c: Entry) => {
    const names = [c.name, ...c.aka].map((x) => x.toLowerCase());
    if (names.some((n) => n === k)) return 3;
    if (names.some((n) => n.startsWith(k))) return 2;
    if (names.some((n) => n.includes(k) || (k.length >= 3 && k.includes(n)))) return 1;
    return 0;
  };
  return CATALOG.map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => resolve(x.c));
}
