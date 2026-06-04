# 📱 eSIM-Tracker：单体全栈保号看板

> 基于 Cloudflare Workers + KV 构建的 **零成本、高颜值、极度安全** 的 eSIM / 实体卡保号管理面板。
> 前端展示、后端 API、定时提醒逻辑，全部浓缩在一个文件内。无需服务器，依托 Cloudflare 免费网络运行！
> 基于原项目 https://github.com/GeniusZeroTwo/Number-preservation

---

## ✨ 核心功能

| 功能 | 说明 |
|:---|:---|
| 🆓 **零成本部署** | 无需 VPS，完美白嫖 Cloudflare 生态（Workers 托管 + KV 持久化） |
| 🎨 **高颜值 UI** | 基于 TailwindCSS 的 Glassmorphism 毛玻璃质感界面，手机 / PC 完美自适应 |
| 🛡️ **Telegram OTP 登录** | 动态 6 位验证码登录，5 分钟有效，连续输错 5 次自动作废，防爆破机制 |
| 📅 **开始日期 + 保号周期 → 自动推算到期日** | 选择开始日期并输入保号天数，系统自动计算到期日期，无需手动推算 |
| 🔄 **到期后自动延期** | 开关式控制，开启后到期当天系统自动顺延一个保号周期，并通过 TG 通知 |
| 🔁 **一键手动续期** | 点击续期按钮，以今天为基准顺延一个保号周期 |
| ⏰ **智能 TG 提醒** | CF Cron 定时任务：到期前 15 天开始提醒、到期当天紧急告警、过期后每周推送 |
| 🌍 **智能国旗匹配** | 内置 60+ 国家区号字典，录入带区号的号码自动显示对应国旗 |
| 📝 **备注功能** | 可记录每张卡的保号要求（如"发送短信到某号码"），提醒推送同步包含 |

---

## 🔒 安全特性


- **安全身份验证**：采用严格的 `Bearer Token` 验证，配合密码学安全的随机数发生器（CSPRG）生成动态登录验证码。
- **XSS & 注入防护**：全局采用 HTML 实体转义渲染与数据类型校验，抵御任何形式的跨站脚本攻击（XSS）。
- **防爆破设计**：针对 OTP 获取及登录验证双重 API 均部署了独立 IP 维度的频控与错次熔断机制，配合强随机数确保无法被穷举攻击。
- **隐私级本地存储**：前端基于更安全的 `sessionStorage` 机制进行凭据暂存，无惧多标签页的数据残留风险。
- **严格跨域策略**：抛弃宽泛的 `*` 跨域响应，引入动态来源校验，从根源阻断跨站请求伪造（CSRF）。

---

## 📸 界面预览

![界面截图](https://github.com/GeniusZeroTwo/Number-preservation/blob/7519ab70a15dce64f548c1262441710369c5fed1/IMG/%E6%88%AA%E5%B1%8F2026-06-01%2017.56.37.png)

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────┐
│            Cloudflare Workers               │
│  ┌───────────────────────────────────────┐   │
│  │          worker/worker.js             │   │
│  │  ┌─────────┐  ┌─────────┐  ┌──────┐  │   │
│  │  │ 前端 UI │  │ REST API│  │ Cron │  │   │
│  │  │ (HTML)  │  │ (CRUD)  │  │ 定时 │  │   │
│  │  └─────────┘  └─────────┘  └──────┘  │   │
│  └───────────────────────────────────────┘   │
│                     │                        │
│              ┌──────┴──────┐                 │
│              │  KV 数据库   │                 │
│              │  (ESIM_DB)  │                 │
│              └──────┬──────┘                 │
│                     │                        │
│          ┌──────────┴──────────┐              │
│          │  Telegram Bot API  │              │
│          └────────────────────┘              │
└─────────────────────────────────────────────┘
```

---

## 📊 数据模型

每张 eSIM 卡片存储以下字段：

| 字段 | 类型 | 必填 | 说明 |
|:---|:---|:---|:---|
| `id` | string | 自动生成 | 时间戳 ID |
| `name` | string | ✅ | 卡片名称，如 "KnowRoaming" |
| `number` | string | ❌ | 带区号的手机号码，如 "+44 7911 123456" |
| `startDate` | string | ✅ | 开始日期（YYYY-MM-DD），默认今天 |
| `cycle` | number | ✅ | 保号周期（天），如 180 |
| `expireDate` | string | ✅ | 到期日期（YYYY-MM-DD），由开始日期 + 周期自动计算 |
| `remark` | string | ❌ | 备注 / 保号要求 |
| `autoRenew` | boolean | ❌ | 是否到期后自动延期，默认关闭 |

---

## 🛠️ 部署指南

部署全程在网页端完成，5 分钟搞定。

### 准备工作

1. 准备一个 [Cloudflare](https://dash.cloudflare.com/) 账号
2. 准备一个 Telegram 账号：
   - 搜索 **@BotFather**，发送 `/newbot` 创建机器人，记录 **Bot Token**
   - 搜索 **@userinfobot**，发送任意消息，记录你的数字 **Chat ID**
   - **主动给你刚建的机器人发送一条消息激活它**（机器人不能主动发起会话）

### 步骤 1：创建 KV 数据库

1. 登录 Cloudflare 控制台 → **Workers & Pages** → **KV**
2. 点击 **Create a namespace**，命名为 `esim_db`
*(无需再复制 ID 写入文件，我们将在之后的图形界面中直接绑定，彻底杜绝 ID 泄漏风险)*

### 步骤 2：Fork 仓库

1. **Fork** 本项目到你自己的 GitHub 账号（为保护隐私，建议将 Fork 后的仓库设置为 **Private**）

### 步骤 3：在 Cloudflare 部署并绑定 KV

1. 进入 **Workers & Pages** → **Overview** → **Create Application**
2. 选择 **Workers** → **Connect to Git**，授权并选择你 Fork 的仓库
3. 在构建向导页面，关键配置如下：
   | 配置项 | 值 |
   |:---|:---|
   | Root directory | 留空 |
   | Build command | 留空 |
   | Entry point | `worker/worker.js` |
4. 点击 **Save and Deploy** 
5. 部署完成后，进入该 Worker 的详情页，点击顶部菜单的 **Settings (设置)** → **Variables (变量)**。
6. 往下滚动找到 **KV Namespace Bindings**，点击 **Add binding**：
   - **Variable name** 必须严格填入：`ESIM_DB`
   - **KV namespace** 下拉选择你刚才创建的 `esim_db`
7. 点击 **Deploy** 或 **Save** 使得绑定生效。

### 步骤 4：添加 TG 密钥到 KV

1. 回到 **Workers & Pages** → **KV** → 进入 `esim_db`
2. 在 **KV Entries** 选项卡中添加两条记录：

   | Key | Value |
   |:---|:---|
   | `TG_BOT_TOKEN` | 你的机器人 Token |
   | `TG_CHAT_ID` | 你的数字 Chat ID |

### 步骤 5：开始使用 🎉

访问 Cloudflare 分配的 Worker 域名（如 `https://esim-api.xxx.workers.dev`），点击"向 TG 机器人获取验证码"即可登录使用。配置存入 KV 后**立即生效**，无需等待。

---


## ⏰ 定时任务说明

通过 `wrangler.toml` 配置的 Cron 触发器，默认为每天 **UTC 02:00（北京时间 10:00）** 执行：

```toml
[triggers]
crons = ["0 2 * * *"]
```

执行逻辑：

1. **自动延期**：检测到已过期且开启了 `autoRenew` 的卡片 → 自动顺延一个周期 → 更新 KV → 发送 TG 通知
2. **到期前 15 天**：发送 ⚠️ 保号提醒
3. **到期当天**：发送 🚨 紧急提醒
4. **过期后每 7 天**：发送 ❌ 停机警告

---

## 🙋 常见问题

<details>
<summary><b>Q1：访问网页报错 404？</b></summary>

检查 Cloudflare 的 Entry point 是否设置为 `worker/worker.js`。项目中不存在 `index.html`，所有前端代码都集成在 `worker.js` 中。如果仓库中有 `wrangler.jsonc` 文件，请删除它。
</details>

<details>
<summary><b>Q2：提示"发送失败: 环境缺失"？</b></summary>

系统没有找到 TG 配置密钥。请检查 KV 数据库中 `TG_BOT_TOKEN` 和 `TG_CHAT_ID` 是否拼写正确、有无多余空格。
</details>

<details>
<summary><b>Q3：如何绑定自定义域名？</b></summary>

在 Worker 详情页 → **Triggers** → **Custom Domains**，输入你托管在 Cloudflare 的域名即可，自带 HTTPS。
</details>

<details>
<summary><b>Q4：到期后自动延期是怎么工作的？</b></summary>

在卡片的编辑面板中开启「到期后自动延期」开关。当定时任务检测到卡片已过期且开启了此选项时，系统会自动将到期日顺延一个保号周期，并通过 Telegram 发送通知。注意：这只是看板上的日期延期，你仍需手动完成实际的保号操作（如发短信、充值等）。
</details>

<details>
<summary><b>Q5：开始日期和到期日是什么关系？</b></summary>

到期日 = 开始日期 + 保号周期（天数）。新增卡片时开始日期默认为今天，也可以手动修改。输入保号周期后到期日会自动计算，你也可以手动覆盖。
</details>

---

## 📜 许可协议

本项目基于 [MIT License](LICENSE) 开源。自由使用、修改和分发，但请保留原作者信息。

如果觉得好用，请点个 ⭐ Star 支持一下！
