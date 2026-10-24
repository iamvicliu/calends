// 通用：域名、应用商店、开发者账号，以及 App Store 搜不到的订阅；图标来源见 public/catalog/SOURCE.txt
import type { CatalogEntry } from '../catalog.ts';

const entries: CatalogEntry[] = [
  {
    name: 'Cloudflare Registrar',
    file: 'cloudflare',
    aka: ['cloudflare', 'domain', '域名'],
    cat: 'domains',
    url: 'https://www.cloudflare.com/products/registrar/',
    icon: '/brands/cloudflare.svg',
    chargeLeadDays: 30,
  },
  {
    name: 'Apple App Store',
    file: 'appstore',
    aka: ['apple', 'app store', '苹果订阅'],
    cat: 'tools',
    url: 'https://apps.apple.com',
    icon: '/catalog/appstore.svg',
    cancelLeadDays: 1,
  },
  {
    name: 'iCloud+',
    file: 'icloud',
    aka: ['icloud', '苹果云', 'apple icloud'],
    cat: 'storage',
    url: 'https://www.icloud.com/',
    icon: '/catalog/icloud.svg',
  },
  {
    name: 'Apple 开发者',
    file: 'appledev',
    aka: ['apple developer', '开发者证书', '苹果开发者'],
    cat: 'developer',
    url: 'https://developer.apple.com/',
    icon: '/catalog/appledev.svg',
  },
  {
    name: 'Microsoft 365',
    file: 'microsoft365',
    aka: ['microsoft 365', 'office 365', 'ms365'],
    cat: 'productivity',
    url: 'https://www.microsoft.com/microsoft-365',
    icon: '/catalog/microsoft365.svg',
  },
  {
    name: 'Setapp',
    file: 'setapp',
    aka: ['setapp', 'mac 软件订阅'],
    cat: 'tools',
    url: 'https://setapp.com/',
    icon: '/catalog/setapp.png',
  },
];

export default entries;
