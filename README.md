# eSIM 保号看板

使用 Cloudflare Workers 和 SQLite Durable Object 管理 eSIM / 实体卡的到期日期，通过 Telegram 验证码登录和接收到期提醒。基于 [原项目](https://github.com/GeniusZeroTwo/Number-preservation) 改进。

> **从旧版升级：首次部署前必须绑定原来的 `ESIM_DB` KV namespace。** 新版会一次性迁移卡片到 Durable Object，之后不再向 KV 写入卡片。请先导出备份，保留原 KV，升级后重新登录。不要在旧站点仍持续写入时切换版本。

## 功能与约定

- 周期支持天、月、季度和年；手动续期可选择从原到期日或今天开始。
- 页面和定时任务统一按北京时间计算日历日期。按月/季度/年增加周期时，目标月份没有对应日期则取月末，例如 `2026-01-31 + 1 月 = 2026-02-28`；下一次从新的到期日继续计算，不保留最初的“31 日”锚点。
- 提前提醒默认为 15 天，可设为 0–3650 天；0 表示只在到期当天及过期后提醒。过期后每 7 天提醒。
- 自动延期只修改看板日期，**不会替你充值或发送保号短信**。到期当天或已过期时，以执行当天为基准增加一个周期。
- 支持名称/号码搜索、批量续期与删除、加密备份的合并或覆盖导入。
- 手动续期、批量续期和自动延期都会写入续期记录，记录操作时间、来源、计算方式以及新旧到期日；每张卡片保留最近 20 条。
- 总览统计始终基于全部卡片；添加时间按 `createdAt` 排序。没有可靠添加时间的旧 UUID 记录排在最后并保留相对顺序。
- 每个面板最多 500 张卡片；周期为 1–36500 的整数。名称最多 100 字、号码 50 字、备注 500 字。

## 从旧版升级

1. 在旧版面板导出加密备份，并保留密码。暂停其他标签页上的编辑操作。
2. 安装 Node.js 22 或以上版本，拉取新版源码，在项目根目录执行：

   ```sh
   npm ci
   npm test
   ```

3. 修改 `wrangler.toml`，保留已有的 Worker 名称，并取消末尾 KV 配置的注释，填入**原 namespace 的 ID**：

   ```toml
   [[kv_namespaces]]
   binding = "ESIM_DB"
   id = "这里填原有的 namespace ID"
   ```

   Namespace ID 是标识符，不是访问凭据。不要新建空 namespace 替代原库；仅在控制台绑定但配置文件未声明的绑定，可能在 CLI 部署时被覆盖。

4. 保留 `ESIM_STORE` Durable Object 绑定和 `v2-sqlite-store` 迁移声明。已有其他迁移时，追加该迁移，不能删除旧迁移历史。
5. Telegram 配置可继续从原 KV 的 `TG_BOT_TOKEN` / `TG_CHAT_ID` 读取，也可以改为 Worker Secrets：

   ```sh
   npx wrangler secret put TG_BOT_TOKEN
   npx wrangler secret put TG_CHAT_ID
   ```

6. 先检查打包结果，再部署：

   ```sh
   npx wrangler deploy --dry-run
   npm run deploy
   ```

7. 用 TG 验证码重新登录。核对卡片数量、日期、备注和自动延期设置。迁移时无法通过校验的记录会隔离，面板提示数量，可下载待修正记录；下载内容是明文，请妥善保存。原始 `esim_list` 仍留在原 KV，便于对照和恢复。

迁移只在 Durable Object 首次初始化时执行。KV 读取失败或缺少绑定时会停止初始化，避免把旧数据误判为空库。**不要在升级环境设置 `FRESH_INSTALL=true`**。升级后的旧会话不会继承。

回退旧代码前，先在新版导出最新备份；原 KV 不会自动包含升级后的修改。旧版无法保证并发写入安全，不能与新版同时使用。

## 全新部署

1. 创建 Telegram Bot，主动向机器人发送消息以允许接收通知。
2. 在 `wrangler.toml` 顶层增加以下配置，明确这是新面板：

   ```toml
   [vars]
   FRESH_INSTALL = "true"
   ```

3. 运行 `npm ci`，设置上面的两个 Worker Secrets，再执行 `npm run deploy`。
4. 打开 Worker 地址，获取验证码并登录。新部署不需要 KV；卡片、登录挑战、会话及通知记录都存于 Durable Object。

也可以使用 Cloudflare Git 构建：依赖安装使用 `npm ci`，部署命令使用 `npm run deploy`，Wrangler 会自动执行构建。不要直接把单个 JS 文件复制进网页编辑器。资源使用受 Cloudflare 账户配额和计费规则约束。

## 本地开发与检查

```sh
npm ci
npm run dev
npm test
npm run check
```

本地创建 `.dev.vars`，填入 `FRESH_INSTALL=true` 和测试机器人的配置；不要提交该文件。`npm run dev` 使用本地存储，但填写真实机器人配置后，获取验证码和定时通知会实际发送 TG 消息。

自动化测试完全使用本地数据和模拟 Telegram 响应，不会发送真实消息。`npm test` 包括日期边界、字段校验、并发与版本冲突、验证码隔离、迁移、通知重试、DOM 交互以及 workerd 集成测试。`npm run check` 还会执行 Wrangler dry-run，不上传代码。

依赖由 `package-lock.json` 固定。Miniflare 版本与锁定的 Wrangler 所用运行时一致；升级工具链时应同步更新并重新运行测试。

## 存储、认证与提醒

所有请求使用固定名称 `esim-panel-v2` 的 Durable Object。修改经过同一个串行队列，卡片列表更新使用 SQLite 事务。编辑、删除、导入和批量操作携带稳定的 `X-Data-Revision`，并保留 `If-Match` 兼容；基于旧快照的修改返回 409。独立版本头不会因中间层将 ETag 弱化为 `W/` 前缀而误报冲突。新增是独立插入，不会覆盖其他卡片。不要随意更换对象名称或移除绑定，否则会访问不同的数据空间。

验证码有效期 5 分钟，每个独立挑战最多输错 5 次，绑定请求 IP；网络变化后需重新获取。每 IP 60 秒可发送一次，面板每小时最多发送 60 次；验证另有 IP 频控。成功后验证码立即消费。会话最多有效 30 天，保存在浏览器 `sessionStorage`，退出会注销服务端会话并清理页面数据。

每天 UTC 02:00（北京时间 10:00），Cron 计算提醒并将通知与自动延期结果一起持久化。Alarm 逐条发送通知，文本按安全长度分段，并检查 HTTP 状态和 Telegram `ok` 字段。失败后退避重试，单个片段最多尝试 5 次；达到上限后保留失败记录并在面板中显示。正常响应已确认的通知不会再次发送；网络结果不明或进程在发送成功后中断时，仍可能出现重复消息，因为 Telegram 没有为此请求提供端到端幂等保证。

通知按“卡片 + 北京日期”去重，成功历史保留 35 天。失败记录不会自动丢弃；修复机器人配置后，点击面板中的“重试失败提醒”重新入队。

## 备份与数据模型

备份在浏览器中使用 AES 加密，密码不发送给服务端，兼容旧版 `version: "1.0"` 备份。恢复时解密后的卡片数据会通过当前站点的 API 保存到服务端。请选择足够强的备份密码并保存好；这不等于服务端卡片数据采用用户密码端到端加密。

| 字段               | 类型          | 说明                                                       |
| ------------------ | ------------- | ---------------------------------------------------------- |
| `id`               | string        | 新记录使用 UUID；兼容旧时间戳 ID                           |
| `name`             | string        | 必填名称                                                   |
| `number`、`remark` | string        | 选填号码和备注                                             |
| `startDate`        | string / null | `YYYY-MM-DD`；旧记录可能缺失，新建必填                     |
| `expireDate`       | string        | 必须为真实日历日期                                         |
| `cycle`            | integer       | 正整数周期                                                 |
| `cycleUnit`        | string        | `day` / `month` / `quarter` / `year`                       |
| `reminderDays`     | integer       | 默认为 15，可为 0                                          |
| `autoRenew`        | boolean       | 默认为 false                                               |
| `createdAt`        | string / null | 新增时由服务端写入；旧时间戳 ID 可恢复，否则保留 null      |
| `renewalHistory`   | array         | 最近 20 条续期记录，包含时间、来源、方式、周期及新旧到期日 |

导入先验证全部记录，再一次性保存；错误包含记录序号。合并模式覆盖同 ID 并追加新 ID；完全覆盖模式需要确认替换数量。导入不接受重复 ID 或无效模式。

## 源码结构

| 路径                                         | 职责                                       |
| -------------------------------------------- | ------------------------------------------ |
| `web/index.html`、`web/styles.css`           | 页面与样式                                 |
| `web/app.js`、`web/flags.js`                 | 页面交互、备份与国旗显示                   |
| `shared/dates.js`                            | 前后端共享的日期规则                       |
| `worker/entry.js`                            | HTTP 入口、静态资源、同源规则与 Cron 入口  |
| `worker/store.js`                            | Durable Object、迁移、认证、事务与通知状态 |
| `worker/validation.js`、`worker/telegram.js` | 输入校验与消息投递                         |
| `scripts/build.mjs`                          | 生成本地 CSS 与静态资源模块                |
| `tests/`                                     | 回归及 Workers 运行时测试                  |

HTML 中的静态事件声明在构建时转换为外部脚本监听器，部署页面不包含行内脚本；卡片事件使用委托监听器，用户字段按文本渲染。CSS 和备份库随 Worker 提供，图标字体和国旗图片仍从第三方 CDN 加载。

## 许可

[MIT](LICENSE)。请保留原作者与许可证信息。
