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
}
