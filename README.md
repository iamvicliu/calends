# calends.example.com

个人订阅账本：负 MRR、扣款日历、余额续航、拼车分摊、邮件提醒。单用户、私有，口令登录。

- 线上：https://calends.example.com（Cloudflare Worker `calends` + 静态资源 + D1 `subscription-db`）
- 前端：Vite + Preact 10（注意：Preact 11 不再自动给数字样式补 `px`），PWA（`public/sw.js`、`manifest.webmanifest`）
- 后端：`worker/`，计费逻辑在 `shared/`，前后端共用

## 功能

- 总览：负 MRR / ARR、今年与累计已付、24+12 个月扣款条形图、30 天到期时间轴、分类与支付方式占比、订阅时间线、按年统计、账单小票
- 日历：月视图 + 年度热力图；ICS 私密订阅链接（`/cal/<token>.ics`，含提前提醒）
- 钱包：银行卡 / 支付宝 / App Store 礼品卡余额 / SMART 话费等；余额类账户按扣款逐期推演，给出可扣期数、用完日期与「撑满一年需充值」
- 拼车：车主模式记录成员份额与已付至日期，「收 1 期」自动顺延；成员模式记录付给谁
- 订阅：首期优惠、价格历史（改价自动记录）、试用、暂停、到期不续；App Store 搜索/链接导入图标
- 提醒：每小时 cron，到设置的本地时刻发一封汇总邮件（扣款、试用到期、余额不足、拼车待收、即将到期）；每月 1 日发当月账单预告；`notify_log` 去重
- 数据：导入 Subscriptions App 导出的 CSV、JSON 备份/恢复、CSV 导出；可选公开只读视图（脱敏）

## 开发

```bash
npm i
echo "OWNER_PASSCODE=local-dev-pass" > .dev.vars
npm run build && npm run db:migrate:local
node scripts/seed.ts ~/Downloads/subscriptions.csv > seed/seed.sql
npx wrangler d1 execute subscription-db --local --file seed/seed.sql
npx wrangler dev          # 静态资源变更后需重启
npm test                  # 计费逻辑单测
```

## 部署

```bash
npm run db:migrate:remote
npm run deploy
```

- 口令为 secret `OWNER_PASSCODE`，本机副本在 macOS 钥匙串：`security find-generic-password -s calends.example.com -a owner -w`
- 发信走 Cloudflare Email Sending，发件人 `calends@example.com`（example.com 已在账户内验证）
- 汇率来自 open.er-api.com，cron 每 20 小时刷新一次，也可在设置页手动刷新
- `seed/` 含真实订阅数据，已在 .gitignore 中
