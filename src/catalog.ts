// 常用服务目录：新建订阅时按名称联想，选中后带出 logo、分类和官网。
// AI 产品的图标来自 lobe-icons（MIT），放在 public/ai；不带价格，价格变得太快，留给用户自己填。

export interface CatalogItem {
  name: string;
  /** 别名、厂商名、中文名，都参与搜索 */
  aka: string[];
  icon: string;
  category: string;
  url: string;
}

const ai = (name: string, file: string, url: string, aka: string[] = [], category = 'AI'): CatalogItem => ({ name, aka, icon: `/ai/${file}.svg`, category, url });

export const CATALOG: CatalogItem[] = [
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
  ai('GitHub Copilot', 'githubcopilot', 'https://github.com/features/copilot', ['copilot'], '工具'),
  ai('Cursor', 'cursor', 'https://cursor.com', ['cursor pro'], '工具'),
  ai('Windsurf', 'windsurf', 'https://windsurf.com', ['codeium'], '工具'),
  ai('Trae', 'trae', 'https://www.trae.ai', [], '工具'),
  ai('Cline', 'cline', 'https://cline.bot', [], '工具'),
  ai('Devin', 'devin', 'https://devin.ai', ['cognition'], '工具'),
  ai('v0', 'v0', 'https://v0.dev', ['vercel'], '工具'),
  ai('Lovable', 'lovable', 'https://lovable.dev', [], '工具'),
  ai('Replit', 'replit', 'https://replit.com', [], '工具'),
  ai('Hugging Face', 'huggingface', 'https://huggingface.co', ['hf'], '工具'),
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
  ai('Notion', 'notion', 'https://www.notion.so', ['notion ai'], '效率'),
  ai('Figma', 'figma', 'https://www.figma.com', [], '工具'),
];

/** 名称联想：前缀命中排前面，其次是包含 */
export function searchCatalog(q: string, limit = 4): CatalogItem[] {
  const k = q.trim().toLowerCase();
  if (k.length < 1) return [];
  const score = (c: CatalogItem) => {
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
    .map((x) => x.c);
}
