import {
  HttpError,
  MAX_CARDS,
  MAX_RENEWAL_HISTORY,
  readJSON,
  validId,
  validateCard,
  validateList,
} from "./validation.js";
import { todayString, addCalendarCycle, daysBetween } from "../shared/dates.js";
import {
  sendTelegram,
  telegramApi,
  telegramConfig,
  splitMessage,
  webhookSecret,
  safeEqual,
  renewButtons,
  parseRenewCallback,
} from "./telegram.js";

const json = (value, status = 200, headers = {}) =>
  Response.json(value, { status, headers });
const now = () => Date.now();
const revisionHeaders = (revision) => ({
  ETag: `"${revision}"`,
  "X-Data-Revision": String(revision),
});
function normalizeRevision(value) {
  if (!value) return null;
  const match = /^(?:W\/)?"(\d+)"$/.exec(value.trim());
  if (match) return match[1];
  return /^\d+$/.test(value.trim()) ? value.trim() : null;
}

// Network awaits permit event interleaving, so every entry point uses this queue.
export class EsimStore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.queue = Promise.resolve();
    this.telegramQueue = Promise.resolve();
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS entries (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
      );
      if (!this.get("initialized")) await this.migrate();
    });
  }
  serial(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  telegramSerial(fn) {
    const result = this.telegramQueue.then(fn);
    this.telegramQueue = result.catch(() => {});
    return result;
  }
  get(key) {
    const rows = this.ctx.storage.sql
      .exec("SELECT v FROM entries WHERE k = ?", key)
      .toArray();
    return rows.length ? JSON.parse(rows[0].v) : null;
  }
  put(key, value) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO entries (k,v) VALUES (?,?)",
      key,
      JSON.stringify(value),
    );
  }
  delete(key) {
    this.ctx.storage.sql.exec("DELETE FROM entries WHERE k = ?", key);
  }
  list(prefix) {
    return this.ctx.storage.sql
      .exec(
        "SELECT k,v FROM entries WHERE substr(k,1,?) = ? ORDER BY rowid",
        prefix.length,
        prefix,
      )
      .toArray()
      .map((row) => ({ key: row.k, value: JSON.parse(row.v) }));
  }
  transaction(fn) {
    return this.ctx.storage.transactionSync(fn);
  }
  cards() {
    return this.list("card:").map((row) => row.value);
  }
  revision() {
    return this.get("revision") || 0;
  }
  saveCards(cards) {
    for (const row of this.list("card:")) this.delete(row.key);
    cards.forEach((card) => this.put("card:" + card.id, card));
    this.put("revision", this.revision() + 1);
  }
  async migrate() {
    // A failed read must not mark an empty migration complete. Retain original KV.
    if (!this.env.ESIM_DB && this.env.FRESH_INSTALL !== "true")
      throw new Error(
        "升级需要绑定原 ESIM_DB；全新安装请显式设置 FRESH_INSTALL=true",
      );
    const legacy = this.env.ESIM_DB
      ? await this.env.ESIM_DB.get("esim_list", { type: "json" })
      : null;
    if (legacy !== null && !Array.isArray(legacy))
      throw new Error("旧 esim_list 格式无效，迁移未执行");
    const cards = [];
    const bad = [];
    const ids = new Set();
    for (const [index, raw] of (legacy || []).entries()) {
      try {
        const card = validateCard(raw, { legacy: true });
        if (ids.has(card.id)) throw new Error("ID 重复");
        if (cards.length >= MAX_CARDS) throw new Error("超出卡片数量上限");
        ids.add(card.id);
        cards.push(card);
      } catch (e) {
        const serialized = JSON.stringify(raw);
        bad.push({
          index: index + 1,
          error: e.message,
          raw:
            serialized.length < 64000
              ? raw
              : "原始记录较大，请从保留的 KV esim_list 导出",
        });
      }
    }
    this.transaction(() => {
      this.saveCards(cards);
      bad.forEach((item, i) => this.put("quarantine:" + i, item));
      this.put("initialized", {
        at: new Date().toISOString(),
        imported: cards.length,
        rejected: bad.length,
      });
    });
  }
  cleanupAuth() {
    for (const row of this.list("auth:"))
      if (row.value.expires <= now()) this.delete(row.key);
  }
  async fetch(request) {
    try {
      return await this.route(request);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error("Request failed", e.name);
      return json(
        {
          success: false,
          message:
            e instanceof HttpError ? e.message : "服务暂时不可用，请重试",
        },
        e.status || 503,
      );
    }
  }
  async route(request) {
    const path = new URL(request.url).pathname;
    if (path === "/internal/scheduled") {
      return this.serial(async () => {
        await this.scheduleNotifications();
        return json({ success: true });
      });
    }
    // Telegram authenticates with the webhook secret header, not a session.
    if (path === "/api/telegram/webhook") return this.telegramWebhook(request);
    if (path.startsWith("/api/auth/")) return this.auth(request, path);
    if (path === "/api/telegram/buttons" && request.method === "POST")
      return this.setTelegramButtons(request);
    if (path === "/api/telegram/test" && request.method === "POST")
      return this.testTelegram(request);
    return this.serial(async () => {
      this.cleanupAuth();
      this.authorize(request);
      if (
        path === "/api/esims/notifications/retry" &&
        request.method === "POST"
      ) {
        const failed = this.list("notice:").filter(
          (row) => row.value.status === "failed",
        );
        if (failed.length) await this.ctx.storage.setAlarm(now() + 1100);
        this.transaction(() => {
          failed.forEach((row) =>
            this.put(row.key, {
              ...row.value,
              status: "pending",
              attempts: 0,
              nextAt: now(),
            }),
          );
        });
        return json({ success: true, count: failed.length });
      }
      if (path === "/api/esims/quarantine" && request.method === "GET")
        return json(this.list("quarantine:").map((row) => row.value));
      if (path === "/api/esims/quarantine" && request.method === "DELETE") {
        const rows = this.list("quarantine:");
        this.transaction(() => {
          for (const row of rows) this.delete(row.key);
        });
        return json({ success: true, cleared: rows.length });
      }
      if (path === "/api/esims/settings" && request.method === "PUT") {
        const body = await readJSON(request);
        if (!["daily", "milestones"].includes(body.notifyMode))
          throw new HttpError(400, "提醒频率设置无效");
        this.put("settings:notifications", { notifyMode: body.notifyMode });
        return json({ success: true, notifyMode: body.notifyMode });
      }
      if (path === "/api/esims/status" && request.method === "GET") {
        const notices = this.list("notice:");
        return json({
          quarantineCount: this.list("quarantine:").length,
          pendingNotifications: notices.filter(
            (row) => row.value.status === "pending",
          ).length,
          failedNotifications: notices.filter(
            (row) => row.value.status === "failed",
          ).length,
          telegramButtons: !!this.get("telegram:webhook"),
          notifyMode: this.notifyMode(),
        });
      }
      if (path === "/api/esims" && request.method === "GET")
        return json(this.cards(), 200, revisionHeaders(this.revision()));
      if (
        !["/api/esims", "/api/esims/import", "/api/esims/batch"].includes(path)
      )
        throw new HttpError(404, "接口不存在");
      if (!["POST", "PUT", "DELETE"].includes(request.method))
        throw new HttpError(405, "请求方法不支持");
      if (!(path === "/api/esims" && request.method === "POST")) {
        const revision =
          request.headers.get("X-Data-Revision") ||
          request.headers.get("If-Match");
        if (!revision) throw new HttpError(428, "请先加载最新数据再保存");
        if (normalizeRevision(revision) !== String(this.revision()))
          throw new HttpError(409, "数据已被其他页面更新，请刷新后重新操作");
      }
      const body = await readJSON(request);
      let cards = this.cards();
      if (path === "/api/esims/import") {
        if (
          request.method !== "POST" ||
          !["merge", "overwrite"].includes(body.mode)
        )
          throw new HttpError(400, "导入模式无效");
        const incoming = validateList(body.data, { legacy: true });
        if (body.mode === "overwrite") cards = incoming;
        else {
          const map = new Map(cards.map((card) => [card.id, card]));
          incoming.forEach((card) => map.set(card.id, card));
          cards = [...map.values()];
        }
      } else if (path === "/api/esims/batch") {
        if (!["PUT", "DELETE"].includes(request.method))
          throw new HttpError(405, "请求方法不支持");
        if (
          !Array.isArray(body.ids) ||
          !body.ids.length ||
          body.ids.length > MAX_CARDS
        )
          throw new HttpError(400, "请选择有效卡片");
        const ids = new Set(body.ids.map(validId));
        if ([...ids].some((id) => !cards.some((card) => card.id === id)))
          throw new HttpError(404, "部分卡片不存在，请刷新");
        cards =
          request.method === "DELETE"
            ? cards.filter((card) => !ids.has(card.id))
            : cards.map((card) =>
                ids.has(card.id)
                  ? card.noRenewal
                    ? card
                    : this.renew(card, body.renewMode, "batch")
                  : card,
              );
      } else if (request.method === "POST") {
        if (!body.startDate) throw new HttpError(400, "请选择开始日期");
        cards.push(
          validateCard({
            ...body,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            renewalHistory: [],
          }),
        );
      } else {
        const id = validId(body.id);
        const index = cards.findIndex((card) => card.id === id);
        if (index < 0) throw new HttpError(404, "未找到记录");
        if (request.method === "DELETE") cards.splice(index, 1);
        else if (body.undoRenew === true)
          cards[index] = this.undoRenew(cards[index]);
        else if (body.renewMode !== undefined) {
          const costOverride =
            body.renewCost !== undefined
              ? { cost: body.renewCost, currency: body.renewCurrency }
              : undefined;
          cards[index] = this.renew(
            cards[index],
            body.renewMode,
            "manual",
            costOverride,
          );
        } else
          cards[index] = validateCard({
            ...cards[index],
            ...body,
            id,
            createdAt: cards[index].createdAt,
            renewalHistory: cards[index].renewalHistory,
          });
      }
      cards = validateList(cards);
      this.transaction(() => this.saveCards(cards));
      return json(
        { success: true, revision: this.revision() },
        200,
        revisionHeaders(this.revision()),
      );
    });
  }
  notifyMode() {
    const mode = this.get("settings:notifications")?.notifyMode;
    return mode === "milestones" ? "milestones" : "daily";
  }
  renew(card, mode, source, costOverride) {
    if (card.noRenewal) throw new HttpError(400, "该卡无需保号，不能续期");
    if (!["fromExpiry", "fromToday"].includes(mode))
      throw new HttpError(400, "续期方式无效");
    if (!["manual", "batch", "auto", "telegram"].includes(source))
      throw new HttpError(400, "续期来源无效");
    const base = mode === "fromExpiry" ? card.expireDate : todayString();
    const newExpireDate = addCalendarCycle(base, card.cycle, card.cycleUnit);
    const cost =
      costOverride && costOverride.cost !== undefined
        ? costOverride.cost
        : card.renewCost;
    const currency =
      costOverride && costOverride.currency !== undefined
        ? costOverride.currency
        : card.renewCurrency;
    const record = {
      renewedAt: new Date().toISOString(),
      source,
      mode,
      previousExpireDate: card.expireDate,
      newExpireDate,
      cycle: card.cycle,
      cycleUnit: card.cycleUnit,
      ...(card.startDate ? { previousStartDate: card.startDate } : {}),
      ...(cost != null ? { cost } : {}),
      ...(cost != null && currency ? { currency } : {}),
    };
    return validateCard({
      ...card,
      startDate: base,
      expireDate: newExpireDate,
      renewalHistory: [...(card.renewalHistory || []), record].slice(
        -MAX_RENEWAL_HISTORY,
      ),
    });
  }
  undoRenew(card) {
    if (card.noRenewal) throw new HttpError(400, "该卡无需保号，不能撤销续期");
    const history = card.renewalHistory || [];
    if (!history.length) throw new HttpError(400, "没有可撤销的续期记录");
    const last = history.at(-1);
    if (card.expireDate !== last.newExpireDate)
      throw new HttpError(409, "卡片到期日已在续期后被修改，请直接编辑日期");
    return validateCard({
      ...card,
      startDate:
        last.previousStartDate !== undefined
          ? last.previousStartDate
          : card.startDate,
      expireDate: last.previousExpireDate,
      renewalHistory: history.slice(0, -1),
    });
  }
  async setTelegramButtons(request) {
    await this.serial(() => {
      this.cleanupAuth();
      this.authorize(request);
    });
    const { enabled } = await readJSON(request);
    if (typeof enabled !== "boolean") throw new HttpError(400, "参数无效");
    const url = enabled
      ? new URL("/api/telegram/webhook", request.url).href
      : null;
    if (enabled && !url.startsWith("https://"))
      throw new HttpError(
        400,
        "Telegram 只接受 HTTPS 地址，请在部署后的面板中启用",
      );
    await this.telegramSerial(async () => {
      try {
        if (enabled) {
          await telegramApi(this.env, "setWebhook", {
            url,
            secret_token: await webhookSecret(this.env),
            allowed_updates: ["callback_query", "message"],
            drop_pending_updates: true,
          });
          await this.serial(() =>
            this.put("telegram:webhook", {
              url,
              enabledAt: new Date().toISOString(),
            }),
          );
        } else {
          await telegramApi(this.env, "deleteWebhook", {});
          await this.serial(() => this.delete("telegram:webhook"));
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(502, "Telegram 设置失败：" + e.message);
      }
    });
    return json({ success: true, enabled });
  }
  formatTelegramCard(card, today) {
    const days = card.noRenewal ? null : daysBetween(today, card.expireDate);
    const status = card.noRenewal
      ? "🟢 无需保号"
      : days < 0
        ? `❌ 已过期 ${-days} 天`
        : days === 0
          ? "🚨 今天到期"
          : days <= card.reminderDays
            ? `⚠️ 剩余 ${days} 天`
            : `✅ 剩余 ${days} 天`;
    return `${status} · ${card.name}\n📞 ${card.number || "未填写"}${card.noRenewal ? "" : `\n📅 到期：${card.expireDate}`}${card.remark ? `\n📝 ${card.remark}` : ""}`;
  }
  async testTelegram(request) {
    await this.serial(() => {
      this.cleanupAuth();
      this.authorize(request);
    });
    const body = await readJSON(request);
    const mode = body.mode === "summary" ? "summary" : "test";
    await telegramConfig(this.env);
    let text;
    if (mode === "test") {
      text = "🔔 eSIM 保号看板测试通知\nTelegram 推送配置正常。";
    } else {
      const today = todayString();
      const cards = await this.serial(() =>
        this.cards()
          .filter((card) => !card.archived && !card.noRenewal)
          .sort((a, b) => a.expireDate.localeCompare(b.expireDate)),
      );
      const due = cards.filter(
        (card) => daysBetween(today, card.expireDate) <= card.reminderDays,
      );
      if (due.length) {
        text =
          `📋 近期到期与过期卡片（共 ${due.length} 张）：\n\n` +
          due.map((card) => this.formatTelegramCard(card, today)).join("\n\n");
      } else if (cards.length) {
        const upcoming = cards.slice(0, 5);
        text =
          `✅ 目前没有即将到期的卡片。最近到期的前 ${upcoming.length} 张：\n\n` +
          upcoming
            .map((card) => this.formatTelegramCard(card, today))
            .join("\n\n");
      } else {
        text = "📭 看板中暂无需要保号的活跃卡片。";
      }
    }
    try {
      const chunks = splitMessage(text);
      for (const chunk of chunks) await sendTelegram(this.env, chunk);
      return json({ success: true, parts: chunks.length });
    } catch (e) {
      throw new HttpError(502, e.message);
    }
  }
  async telegramWebhook(request) {
    if (request.method !== "POST") throw new HttpError(405, "请求方法不支持");
    let expected;
    try {
      expected = await webhookSecret(this.env);
    } catch {
      throw new HttpError(503, "未配置 Telegram 机器人");
    }
    if (
      !safeEqual(
        request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "",
        expected,
      )
    )
      throw new HttpError(401, "Webhook 校验失败");
    const update = await readJSON(request);
    const { chat } = await telegramConfig(this.env);
    if (update.message && typeof update.message.text === "string") {
      await this.handleTelegramCommand(update.message, chat);
      return json({ ok: true });
    }
    const query = update.callback_query;
    // Always 200 for authentic updates so Telegram does not redeliver them.
    if (!query || typeof query.id !== "string") return json({ ok: true });
    const message = query.message;
    const call = (method, payload) =>
      telegramApi(this.env, method, payload).catch((e) =>
        console.error("Telegram callback reply failed", method, e.message),
      );
    if (String(message?.chat?.id) !== String(chat)) {
      await call("answerCallbackQuery", {
        callback_query_id: query.id,
        text: "无权操作此面板",
      });
      return json({ ok: true });
    }
    const { reply, renewed, action } = await this.serial(() => {
      this.cleanupAuth();
      const parsedAction = parseRenewCallback(query.data);
      const card = parsedAction && this.get("card:" + parsedAction.cardId);
      let nextReply;
      let nextRenewed = null;
      if (!this.get("telegram:webhook")) nextReply = "按钮续期已关闭";
      else if (!parsedAction) nextReply = "按钮已失效";
      else if (!card) nextReply = "卡片不存在或已删除";
      else if (card.noRenewal) nextReply = "该卡无需保号";
      else if (card.expireDate !== parsedAction.expireDate)
        nextReply = `该卡已续期，当前到期日 ${card.expireDate}，未重复操作`;
      else {
        try {
          nextRenewed = this.renew(card, parsedAction.mode, "telegram");
        } catch (e) {
          // An error status would make Telegram redeliver the same press.
          nextReply = "续期失败：" + e.message;
        }
        if (nextRenewed) {
          // Rewrite through saveCards so card order and the data revision stay consistent.
          const cards = this.cards().map((item) =>
            item.id === nextRenewed.id ? nextRenewed : item,
          );
          this.transaction(() => this.saveCards(cards));
          nextReply = `已续期，新到期日 ${nextRenewed.expireDate}`;
        }
      }
      return { reply: nextReply, renewed: nextRenewed, action: parsedAction };
    });
    await call("answerCallbackQuery", {
      callback_query_id: query.id,
      text: reply,
    });
    if (message?.message_id) {
      const target = {
        chat_id: message.chat.id,
        message_id: message.message_id,
      };
      const removeButtons = { inline_keyboard: [] };
      if (renewed && typeof message.text === "string")
        await call("editMessageText", {
          ...target,
          text:
            message.text +
            `\n\n✅ 已${action.mode === "fromExpiry" ? "从到期日" : "从今天"}续期，新到期日：${renewed.expireDate}`,
          reply_markup: removeButtons,
        });
      else
        await call("editMessageReplyMarkup", {
          ...target,
          reply_markup: removeButtons,
        });
    }
    return json({ ok: true });
  }
  async handleTelegramCommand(msg, chat) {
    if (String(msg.chat?.id) !== String(chat)) return;
    const match = /^\/([a-zA-Z]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(
      msg.text.trim(),
    );
    if (!match) return;
    const cmd = match[1].toLowerCase();
    const arg = (match[2] || "").trim();
    const today = todayString();
    const snapshot = await this.serial(() => {
      if (!this.get("telegram:webhook")) return null;
      return this.cards();
    });
    if (!snapshot) return;
    const send = (text, extra = {}) =>
      sendTelegram(this.env, text, extra).catch((e) =>
        console.error("Telegram command reply failed", cmd, e.message),
      );
    const sendList = async (header, list) => {
      const text =
        header +
        "\n\n" +
        list.map((card) => this.formatTelegramCard(card, today)).join("\n\n");
      for (const chunk of splitMessage(text)) await send(chunk);
    };
    const active = snapshot
      .filter((card) => !card.archived)
      .sort((a, b) =>
        (a.expireDate || "9999-12-31").localeCompare(
          b.expireDate || "9999-12-31",
        ),
      );
    if (cmd === "start" || cmd === "help") {
      await send(
        "📋 eSIM 保号看板指令：\n/due - 查看已过期与即将到期的卡片（可直接在 TG 内续期）\n/list - 查看全部活跃卡片\n/search 关键词 - 按名称、号码、账号、标签或备注查询",
      );
      return;
    }
    if (cmd === "due") {
      const due = active.filter(
        (card) =>
          !card.noRenewal &&
          daysBetween(today, card.expireDate) <= card.reminderDays,
      );
      if (!due.length) {
        await send("✅ 目前没有即将到期或已过期的卡片。");
        return;
      }
      if (due.length <= 5) {
        for (const card of due) {
          const markup = renewButtons(card.id, card.expireDate);
          await send(
            this.formatTelegramCard(card, today),
            markup ? { reply_markup: markup } : {},
          );
        }
        return;
      }
      await sendList(`⚠️ 共有 ${due.length} 张卡片即将到期或已过期：`, due);
      return;
    }
    if (cmd === "list") {
      if (!active.length) {
        await send("📭 看板中暂无活跃卡片。");
        return;
      }
      await sendList(`📱 全部活跃卡片（共 ${active.length} 张）：`, active);
      return;
    }
    if (cmd === "search" || cmd === "s") {
      if (!arg) {
        await send("请输入搜索关键词，例如：/search giffgaff");
        return;
      }
      const query = arg.toLowerCase();
      const matches = active.filter((card) =>
        [
          card.name,
          card.number,
          card.remark,
          card.account,
          ...(card.tags || []),
        ]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(query)),
      );
      if (!matches.length) {
        await send(`未找到匹配“${arg}”的活跃卡片。`);
        return;
      }
      if (matches.length <= 3) {
        for (const card of matches) {
          const markup =
            !card.noRenewal && renewButtons(card.id, card.expireDate);
          await send(
            this.formatTelegramCard(card, today),
            markup ? { reply_markup: markup } : {},
          );
        }
        return;
      }
      await sendList(`🔍 搜索“${arg}”找到 ${matches.length} 张卡片：`, matches);
    }
  }
  authorize(request) {
    const match = /^Bearer ([a-f0-9-]{36})$/i.exec(
      request.headers.get("Authorization") || "",
    );
    const session = match && this.get("auth:session:" + match[1]);
    if (!session || session.expires <= now())
      throw new HttpError(401, "登录已过期，请重新验证");
    return match[1];
  }
  async auth(request, path) {
    if (request.method !== "POST") throw new HttpError(405, "请求方法不支持");
    if (path === "/api/auth/logout") {
      return this.serial(() => {
        this.cleanupAuth();
        const token = this.authorize(request);
        this.delete("auth:session:" + token);
        return json({ success: true });
      });
    }
    const ip = request.headers.get("cf-connecting-ip") || "local";
    if (path === "/api/auth/send") {
      const rateKey = "auth:send:" + ip;
      await this.serial(() => {
        this.cleanupAuth();
        if (this.get(rateKey))
          throw new HttpError(429, "请等待 60 秒后再获取验证码");
        const global = this.get("auth:send-global");
        if (global && global.expires > now() && global.count >= 60)
          throw new HttpError(429, "本小时验证码发送次数已达上限");
      });
      await telegramConfig(this.env);
      const { code, challengeId } = await this.serial(() => {
        this.cleanupAuth();
        if (this.get(rateKey))
          throw new HttpError(429, "请等待 60 秒后再获取验证码");
        let global = this.get("auth:send-global");
        if (!global || global.expires <= now())
          global = { count: 0, expires: now() + 3600000 };
        if (global.count >= 60)
          throw new HttpError(429, "本小时验证码发送次数已达上限");
        const buffer = new Uint32Array(1);
        let value;
        do {
          crypto.getRandomValues(buffer);
          value = buffer[0];
        } while (value >= 4294000000);
        const generatedCode = String(value % 1000000).padStart(6, "0");
        const id = crypto.randomUUID();
        this.put(rateKey, { expires: now() + 60000 });
        this.put("auth:send-global", { ...global, count: global.count + 1 });
        return { code: generatedCode, challengeId: id };
      });
      await sendTelegram(
        this.env,
        `🔐 eSIM 看板登录验证码：${code}\n有效期 5 分钟，最多尝试 5 次。\n请求 IP：${ip}\n如非本人操作，请忽略。`,
      );
      await this.serial(() => {
        this.put("auth:challenge:" + challengeId, {
          code,
          ip,
          attempts: 0,
          expires: now() + 300000,
        });
      });
      return json({ success: true, challengeId });
    }
    if (path === "/api/auth/verify") {
      const { code, challengeId } = await readJSON(request);
      if (
        typeof code !== "string" ||
        !/^\d{6}$/.test(code) ||
        typeof challengeId !== "string" ||
        !/^[a-f0-9-]{36}$/i.test(challengeId)
      )
        throw new HttpError(400, "请输入 6 位验证码并先获取验证请求");
      return this.serial(() => {
        this.cleanupAuth();
        const rateKey = "auth:attempts:" + ip;
        const rate = this.get(rateKey) || { count: 0, expires: now() + 300000 };
        if (rate.count >= 10)
          throw new HttpError(429, "验证过于频繁，请稍后再试");
        const key = "auth:challenge:" + challengeId;
        const challenge = this.get(key);
        if (!challenge || challenge.expires <= now() || challenge.ip !== ip) {
          this.put(rateKey, { ...rate, count: rate.count + 1 });
          throw new HttpError(400, "验证请求已失效，请重新获取");
        }
        if (challenge.code !== code) {
          challenge.attempts++;
          this.put(rateKey, { ...rate, count: rate.count + 1 });
          if (challenge.attempts >= 5) this.delete(key);
          else this.put(key, challenge);
          throw new HttpError(
            401,
            `验证码错误，剩余 ${Math.max(0, 5 - challenge.attempts)} 次机会`,
          );
        }
        const token = crypto.randomUUID();
        this.transaction(() => {
          this.delete(key);
          this.delete(rateKey);
          const sessions = this.list("auth:session:");
          if (sessions.length >= 100) this.delete(sessions[0].key);
          this.put("auth:session:" + token, { expires: now() + 30 * 86400000 });
        });
        return json({ success: true, token });
      });
    }
    throw new HttpError(404, "接口不存在");
  }
  async scheduleNotifications() {
    const today = todayString();
    const notifyMode = this.notifyMode();
    const cards = this.cards();
    const validCards = [];
    const notices = [];
    const bad = [];
    let changed = false;
    for (const [index, raw] of cards.entries()) {
      try {
        const card = validateCard(raw);
        validCards.push(card);
        if (card.noRenewal || card.archived) continue;
        const days = daysBetween(today, card.expireDate);
        const detail = `📱 ${card.name}\n📞 ${card.number || "未填写"}\n${card.remark ? "📝 " + card.remark + "\n" : ""}`;
        let message;
        const noticeKey = `notice:${today}:${card.id}`;
        if (this.get(noticeKey)) continue;
        let renewed = null;
        if (days <= 0 && card.autoRenew) {
          // A failed renewal must not quarantine a card that is already kept.
          try {
            renewed = this.renew(card, "fromToday", "auto");
          } catch (e) {
            console.error("Auto renewal failed", index, e.message);
          }
        }
        const shouldNotifyUpcoming =
          days > 0 &&
          days <= card.reminderDays &&
          (notifyMode === "daily" ||
            days === card.reminderDays ||
            [7, 3, 1].includes(days));
        if (renewed) {
          validCards[validCards.length - 1] = renewed;
          changed = true;
          if (!card.muteReminders)
            message = `🔄 看板自动延期\n${detail}新到期日：${renewed.expireDate}\n请确认已完成实际保号操作（短信、充值等）。`;
        } else if (card.muteReminders) {
          continue;
        } else if (days <= 0 && card.autoRenew)
          message = `⚠️ 自动延期失败\n${detail}到期：${card.expireDate}\n请手动检查周期设置并完成保号操作。`;
        else if (days === 0)
          message = `🚨 今天到期\n${detail}请立即处理保号操作。`;
        else if (shouldNotifyUpcoming)
          message = `⚠️ 保号提醒\n${detail}到期：${card.expireDate}\n剩余 ${days} 天。`;
        else if (days < 0 && Math.abs(days) % 7 === 0)
          message = `❌ 已过期 ${-days} 天\n${detail}`;
        if (message)
          notices.push({
            key: noticeKey,
            value: {
              text: message,
              status: "pending",
              attempts: 0,
              nextAt: now(),
              createdAt: now(),
              part: 0,
              // Reminders can be renewed from Telegram; auto-renewal results cannot.
              ...(days <= 0 && card.autoRenew
                ? {}
                : { renew: { cardId: card.id, expireDate: card.expireDate } }),
            },
          });
      } catch (e) {
        changed = true;
        bad.push({ index: index + 1, raw, error: e.message });
        console.error("Skipped invalid card", index, e.message);
      }
    }
    if (notices.length) await this.ctx.storage.setAlarm(now() + 1100);
    this.transaction(() => {
      if (changed) this.saveCards(validCards);
      bad.forEach((row) => this.put("quarantine:" + crypto.randomUUID(), row));
      notices.forEach((row) => this.put(row.key, row.value));
      // Failed notices are kept for retry, but not forever.
      for (const row of this.list("notice:"))
        if (
          row.value.status !== "pending" &&
          row.value.createdAt < now() - 35 * 86400000
        )
          this.delete(row.key);
    });
    // Persist an alarm before outbound I/O; dates and pending notices commit together.
    await this.arm();
  }
  // Buttons are decided at send time: only with the webhook on and the card unrenewed.
  renewMarkup(notice) {
    if (!notice.renew || !this.get("telegram:webhook")) return {};
    const card = this.get("card:" + notice.renew.cardId);
    if (!card || card.noRenewal || card.expireDate !== notice.renew.expireDate)
      return {};
    const markup = renewButtons(card.id, card.expireDate);
    return markup ? { reply_markup: markup } : {};
  }
  async arm() {
    const pending = this.list("notice:").filter(
      (row) => row.value.status === "pending",
    );
    if (pending.length) {
      await this.ctx.storage.setAlarm(
        Math.max(
          now() + 1100,
          Math.min(...pending.map((row) => row.value.nextAt)),
        ),
      );
    } else if (typeof this.ctx.storage.deleteAlarm === "function") {
      await this.ctx.storage.deleteAlarm();
    }
  }
  async alarm() {
    const pending = await this.serial(async () => {
      let item;
      while (true) {
        item = this.list("notice:").find(
          (row) => row.value.status === "pending" && row.value.nextAt <= now(),
        );
        if (!item) {
          await this.arm();
          return null;
        }
        // Scheduled keys are notice:<date>:<cardId>; drop reminders for deleted cards.
        const cardId = /^notice:\d{4}-\d{2}-\d{2}:(.+)$/.exec(item.key)?.[1];
        if (cardId && !this.get("card:" + cardId)) {
          this.delete(item.key);
          continue;
        }
        break;
      }
      const notice = item.value;
      const chunks = splitMessage(notice.text);
      const extra =
        notice.part === chunks.length - 1 ? this.renewMarkup(notice) : {};
      notice.nextAt = now() + 60000;
      this.put(item.key, notice);
      await this.arm();
      return {
        key: item.key,
        text: chunks[notice.part],
        chunkCount: chunks.length,
        extra,
      };
    });
    if (!pending) return;
    let sendError = null;
    try {
      await sendTelegram(this.env, pending.text, pending.extra);
    } catch (e) {
      sendError = e;
    }
    await this.serial(async () => {
      const notice = this.get(pending.key);
      if (!notice || notice.status !== "pending") {
        await this.arm();
        return;
      }
      if (!sendError) {
        notice.part++;
        notice.attempts = 0;
        notice.status = notice.part >= pending.chunkCount ? "sent" : "pending";
        notice.nextAt = now() + 1100;
      } else {
        notice.attempts++;
        notice.status = notice.attempts >= 5 ? "failed" : "pending";
        notice.nextAt =
          now() +
          Math.max(
            60000 * 2 ** (notice.attempts - 1),
            (sendError.retryAfter || 0) * 1000,
          );
        notice.error = sendError.message;
        console.error(
          "Notification delivery failed",
          pending.key,
          notice.attempts,
        );
      }
      this.put(pending.key, notice);
      await this.arm();
    });
  }
}
