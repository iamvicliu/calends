// 这一种语言的全部文案，按命名空间（文件名）合并
const files = import.meta.glob<{ default: Record<string, unknown> }>('../../../shared/locales/zh-CN/*.json', { eager: true });
export default files;
