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
  OWNER_PASSCODE?: string;
  /** 仅本地：.dev.vars 设为 1 且访问来自 localhost 时跳过登录 */
  DEV_BYPASS_AUTH?: string;
}
