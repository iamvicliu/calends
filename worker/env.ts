export interface EmailBinding {
  send(msg: {
    from: { email: string; name?: string } | string;
    to: string | string[];
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  EMAIL: EmailBinding;
  SITE_URL: string;
  MAIL_FROM: string;
  MAIL_FROM_NAME: string;
  /** 旧版：口令直接放在密钥里；第一次登录成功后会转存为哈希，之后可以删除 */
  OWNER_PASSCODE?: string;
  /** 首次设置密码时需要提供的一次性令牌（wrangler secret put SETUP_TOKEN） */
  SETUP_TOKEN?: string;
  /** 仅本地：.dev.vars 设为 1 时跳过登录（不要在线上配置） */
  DEV_BYPASS_AUTH?: string;
}
