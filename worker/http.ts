// 接口层的小工具：请求体解析失败是客户端的错（400），不应落成 500
import { t } from '../shared/i18n.ts';

/** 带状态码的错误：由 worker/index.ts 的总兜底转成对应的 JSON 响应 */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 读取 JSON 请求体；不是合法 JSON 时抛 400 */
export async function readJson<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, t('server.invalidJson'));
  }
}
