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

## 本地开发

```bash
npm i
npm run db:migrate:local   # 首次或新增迁移后
npm run db:pull            # 把线上数据只读复制到本地 D1（口令取自钥匙串）
npm run dev                # Vite :5173（热更新）+ wrangler :8787（Worker + 本地 D1）
```

- 公开页：http://localhost:5173/ （根路径，对外展示，无登录入口；域名、账户等已在服务端脱敏）
- 后台：http://localhost:5173/admin （需登录；`.dev.vars` 中 `DEV_BYPASS_AUTH=1` 时本地免登录，该变量不会上传）
- 历史汇率：打开页面后自动补齐缺失的扣款日汇率；也可在「设置 → 历史汇率」手动触发
- 测试：`npm test`

### 域名同步

- `npm run sync:domains`：从 Cloudflare Registrar + 账单历史同步全部域名（默认写本地，`--remote` 写线上，`--dry` 只打印）
- 自动续费在到期前 30 天扣款，据此把发票匹配到域名；一次注册多年、提前续费、促销价都按实际账单记录
- 关闭自动续费的域名记为「到期不续」，到期前会邮件提醒

### 订阅历程

- `payments`：实际扣款记录，存在时以记录为准；`nextDue`：之后从这一天按周期推算
- `phases`：换区、换套餐、断更后续订形成多个阶段，每段有自己的地区/币种/价格/周期/支付方式；阶段内调价用 `priceHistory`
- 编辑页「历程与变更」可记录调价、换区 / 换套餐、续订，详情页展示时间线

### 历史汇率

- 每笔已发生的扣款按扣款当天汇率折算为人民币 / 美元；未来预测按当前汇率
- 数据源：2024-03-02 起用 fawazahmed0/currency-api（全币种，含 NGN），更早用欧洲央行（Frankfurter，无 NGN）；缺数据的币种取最近一天
- 存在 D1 `fx_daily`（USD 基准），cron 每天补记当天实时汇率

## 部署

```bash
npm run db:migrate:remote
npm run deploy
```

- 口令为 secret `OWNER_PASSCODE`，本机副本在 macOS 钥匙串：`security find-generic-password -s calends.example.com -a owner -w`
- 发信走 Cloudflare Email Sending，发件人 `calends@example.com`（example.com 已在账户内验证）
- 汇率来自 open.er-api.com，cron 每 20 小时刷新一次，也可在设置页手动刷新
- `seed/` 含真实订阅数据，已在 .gitignore 中
