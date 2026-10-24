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

type Cat = 'ai' | 'tools' | 'productivity' | 'domains' | 'storage' | 'media' | 'music' | 'shopping' | 'education' | 'news' | 'social' | 'developer';
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
  {
    name: '百度网盘',
    file: 'baidupan',
    aka: ['百度云', 'baidupan', 'baidu pan'],
    cat: 'storage',
    url: 'https://pan.baidu.com/',
    icon: '/brands/baidupan.webp',
  },
  {
    name: '115',
    file: '115',
    aka: ['115网盘', '115云盘', '115 pan'],
    cat: 'storage',
    url: 'https://115.com/',
    icon: '/brands/115.webp',
  },
  {
    name: '阿里云盘',
    file: 'alipan',
    aka: ['alipan', '阿里网盘', 'aliyun drive'],
    cat: 'storage',
    url: 'https://www.alipan.com/',
    icon: '/brands/alipan.webp',
  },
  {
    name: '夸克网盘',
    file: 'quark',
    aka: ['quark', '夸克云盘', 'quark drive'],
    cat: 'storage',
    url: 'https://pan.quark.cn/',
    icon: '/brands/quark.webp',
  },
  {
    name: '腾讯视频',
    file: 'tencentvideo',
    aka: ['v.qq.com', '腾讯影音'],
    cat: 'media',
    url: 'https://v.qq.com/',
    icon: '/brands/tencentvideo.webp',
  },
  {
    name: '爱奇艺',
    file: 'iqiyi',
    aka: ['iqiyi', '奇艺'],
    cat: 'media',
    url: 'https://www.iqiyi.com/',
    icon: '/brands/iqiyi.webp',
  },
  {
    name: '优酷',
    file: 'youku',
    aka: ['youku', '土豆'],
    cat: 'media',
    url: 'https://www.youku.com/',
    icon: '/brands/youku.webp',
  },
  {
    name: '芒果 TV',
    file: 'mgtv',
    aka: ['mgtv', '芒果tv', '芒果'],
    cat: 'media',
    url: 'https://www.mgtv.com/',
    icon: '/brands/mgtv.webp',
  },
  {
    name: 'Bilibili 大会员',
    file: 'bilibili',
    aka: ['bilibili', 'b站', '哔哩哔哩'],
    cat: 'media',
    url: 'https://www.bilibili.com/',
    icon: '/brands/bilibili.webp',
  },
  {
    name: 'Netflix',
    file: 'netflix',
    aka: ['奈飞'],
    cat: 'media',
    url: 'https://www.netflix.com/',
    icon: '/brands/netflix.webp',
  },
  {
    name: 'Spotify',
    file: 'spotify',
    aka: ['声田'],
    cat: 'music',
    url: 'https://www.spotify.com/',
    icon: '/brands/spotify.webp',
  },
  {
    name: 'Apple Music',
    file: 'applemusic',
    aka: ['apple music'],
    cat: 'music',
    url: 'https://www.apple.com/apple-music/',
    icon: '/brands/applemusic.webp',
  },
  {
    name: 'QQ 音乐',
    file: 'qqmusic',
    aka: ['qq音乐', 'qqmusic'],
    cat: 'music',
    url: 'https://y.qq.com/',
    icon: '/brands/qqmusic.webp',
  },
  {
    name: '网易云音乐',
    file: 'netease',
    aka: ['netease', '网易云'],
    cat: 'music',
    url: 'https://music.163.com/',
    icon: '/brands/netease.webp',
  },
  {
    name: '京东 Plus',
    file: 'jd',
    aka: ['jd', '京东', '京东plus'],
    cat: 'shopping',
    url: 'https://www.jd.com/',
    icon: '/brands/jd.webp',
  },
  {
    name: '淘宝 88VIP',
    file: 'taobao',
    aka: ['taobao', '淘宝', '88vip', '天猫'],
    cat: 'shopping',
    url: 'https://www.taobao.com/',
    icon: '/brands/taobao.webp',
  },
  {
    name: '1号会员店',
    file: 'yhd',
    aka: ['一号会员店', '1号店', 'yhd'],
    cat: 'shopping',
    url: 'https://www.yhd.com/',
    icon: '/brands/yhd.webp',
  },
  {
    name: '云闪付会员',
    file: 'unionpay',
    aka: ['云闪付', 'unionpay', 'quickpass', '银联'],
    cat: 'shopping',
    url: 'https://cn.unionpay.com/upowhtml/cn/templates/quickPass/quickPass.html',
    icon: '/brands/unionpay.webp',
  },
  {
    name: 'WPS 会员',
    file: 'wps',
    aka: ['wps', '金山办公'],
    cat: 'productivity',
    url: 'https://www.wps.cn/',
    icon: '/brands/wps.webp',
  },
  {
    name: '百度文库',
    file: 'wenku',
    aka: ['wenku', '百度文库'],
    cat: 'education',
    url: 'https://wenku.baidu.com/',
    icon: '/brands/wenku.webp',
  },
  {
    name: '得到',
    file: 'dedao',
    aka: ['dedao', '得到app'],
    cat: 'education',
    url: 'https://www.dedao.cn/',
    icon: '/brands/dedao.webp',
  },
  {
    name: '知乎盐选',
    file: 'zhihu',
    aka: ['zhihu', '知乎', '知乎会员'],
    cat: 'news',
    url: 'https://www.zhihu.com/',
    icon: '/brands/zhihu.webp',
  },
  {
    name: '微信读书',
    file: 'weread',
    aka: ['weread', '微信读书'],
    cat: 'news',
    url: 'https://weread.qq.com/',
    icon: '/brands/weread.webp',
  },
  {
    name: 'QQ 会员',
    file: 'qqvip',
    aka: ['qq会员', 'qqvip', '腾讯会员'],
    cat: 'social',
    url: 'https://vip.qq.com/',
    icon: '/brands/qqvip.webp',
  },
  {
    name: '腾讯动漫',
    file: 'tencentcomic',
    aka: ['腾讯动漫', 'ac.qq.com'],
    cat: 'media',
    url: 'https://ac.qq.com/',
    icon: '/brands/tencentcomic.webp',
  },
  {
    name: '起点读书',
    file: 'qidian',
    aka: ['qidian', '起点', '阅文'],
    cat: 'news',
    url: 'https://www.qidian.com/',
    icon: '/brands/qidian.webp',
  },
  {
    name: 'YouTube Premium',
    file: 'youtube',
    aka: ['youtube', '油管', 'yt premium'],
    cat: 'media',
    url: 'https://www.youtube.com/premium',
    icon: '/brands/youtube.webp',
  },
  {
    name: '多邻国',
    file: 'duolingo',
    aka: ['duolingo', '多邻国'],
    cat: 'education',
    url: 'https://www.duolingo.com/',
    icon: '/brands/duolingo.webp',
  },
  {
    name: '幕布',
    file: 'mubu',
    aka: ['mubu', '幕布文档'],
    cat: 'productivity',
    url: 'https://mubu.com/',
    icon: '/brands/mubu.webp',
  },
  {
    name: '石墨文档',
    file: 'shimo',
    aka: ['shimo', '石墨'],
    cat: 'productivity',
    url: 'https://shimo.im/',
    icon: '/brands/shimo.webp',
  },
  {
    name: 'ProcessOn',
    file: 'processon',
    aka: ['processon', '流程图'],
    cat: 'productivity',
    url: 'https://www.processon.com/',
    icon: '/brands/processon.webp',
  },
  {
    name: 'Setapp',
    file: 'setapp',
    aka: ['setapp', 'mac 软件订阅'],
    cat: 'tools',
    url: 'https://setapp.com/',
    icon: '/brands/setapp.webp',
  },
  {
    name: 'Termius',
    file: 'termius',
    aka: ['termius', 'ssh 客户端'],
    cat: 'tools',
    url: 'https://termius.com/',
    icon: '/brands/termius.webp',
  },
  {
    name: 'Microsoft 365',
    file: 'microsoft365',
    aka: ['microsoft 365', 'office 365', 'ms365'],
    cat: 'productivity',
    url: 'https://www.microsoft.com/microsoft-365',
    icon: '/brands/microsoft365.webp',
  },
  {
    name: 'iCloud+',
    file: 'icloud',
    aka: ['icloud', '苹果云', 'apple icloud'],
    cat: 'storage',
    url: 'https://www.icloud.com/',
    icon: '/brands/icloud.webp',
  },
  {
    name: '微云',
    file: 'weiyun',
    aka: ['weiyun', '腾讯微云'],
    cat: 'storage',
    url: 'https://www.weiyun.com/',
    icon: '/brands/weiyun.webp',
  },
  {
    name: '小米云服务',
    file: 'miCloud',
    aka: ['小米云', 'micloud', 'xiaomi cloud'],
    cat: 'storage',
    url: 'https://i.mi.com/',
    icon: '/brands/micloud.webp',
  },
  {
    name: 'Apple 开发者',
    file: 'appledev',
    aka: ['apple developer', '开发者证书', '苹果开发者'],
    cat: 'developer',
    url: 'https://developer.apple.com/',
    icon: '/brands/appledev.webp',
  },
  {
    name: '雷神加速器',
    file: 'leigod',
    aka: ['leigod', '雷神'],
    cat: 'tools',
    url: 'https://www.leigod.com/',
    icon: '/brands/leigod.webp',
  },
  {
    name: 'OpenCode',
    file: 'opencode',
    aka: ['opencode zen', 'opencode go', 'sst'],
    cat: 'tools',
    url: 'https://opencode.ai/',
    icon: '/brands/opencode.svg',
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
