import {
  HttpError,
  MAX_CARDS,
  readJSON,
  validId,
  validateCard,
  validateList,
} from "./validation.js";
import { todayString, addCalendarCycle, daysBetween } from "../shared/dates.js";
import { sendTelegram, telegramConfig, splitMessage } from "./telegram.js";

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
  fetch(request) {
    return this.serial(async () => {
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
    });
  }
  async route(request) {
    const path = new URL(request.url).pathname;
    if (path === "/internal/scheduled") {
      await this.scheduleNotifications();
      return json({ success: true });
    }
    this.cleanupAuth();
    if (path.startsWith("/api/auth/")) return this.auth(request, path);
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
    if (path === "/api/esims/status" && request.method === "GET")
      return json({
        quarantineCount: this.list("quarantine:").length,
        pendingNotifications: this.list("notice:").filter(
          (row) => row.value.status === "pending",
        ).length,
        failedNotifications: this.list("notice:").filter(
          (row) => row.value.status === "failed",
        ).length,
      });
    if (path === "/api/esims" && request.method === "GET")
      return json(this.cards(), 200, revisionHeaders(this.revision()));
    if (!["/api/esims", "/api/esims/import", "/api/esims/batch"].includes(path))
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
              ids.has(card.id) ? this.renew(card, body.renewMode) : card,
            );
    } else if (request.method === "POST") {
      if (!body.startDate) throw new HttpError(400, "请选择开始日期");
      cards.push(
        validateCard({
          ...body,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        }),
      );
    } else {
      const id = validId(body.id);
      const index = cards.findIndex((card) => card.id === id);
      if (index < 0) throw new HttpError(404, "未找到记录");
      if (request.method === "DELETE") cards.splice(index, 1);
      else if (body.renewMode !== undefined)
        cards[index] = this.renew(cards[index], body.renewMode);
      else
        cards[index] = validateCard({
          ...cards[index],
          ...body,
          id,
          createdAt: cards[index].createdAt,
        });
    }
    cards = validateList(cards);
    this.transaction(() => this.saveCards(cards));
    return json(
      { success: true, revision: this.revision() },
      200,
      revisionHeaders(this.revision()),
    );
  }
  renew(card, mode) {
    if (!["fromExpiry", "fromToday"].includes(mode))
      throw new HttpError(400, "续期方式无效");
    const base = mode === "fromExpiry" ? card.expireDate : todayString();
    return validateCard({
      ...card,
      startDate: base,
      expireDate: addCalendarCycle(base, card.cycle, card.cycleUnit),
    });
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
      const token = this.authorize(request);
      this.delete("auth:session:" + token);
      return json({ success: true });
    }
    const ip = request.headers.get("cf-connecting-ip") || "local";
    if (path === "/api/auth/send") {
      const rateKey = "auth:send:" + ip;
      if (this.get(rateKey))
        throw new HttpError(429, "请等待 60 秒后再获取验证码");
      const global = this.get("auth:send-global") || {
        count: 0,
        expires: now() + 3600000,
      };
      if (global.count >= 60)
        throw new HttpError(429, "本小时验证码发送次数已达上限");
      await telegramConfig(this.env);
      const buffer = new Uint32Array(1);
      let value;
      do {
        crypto.getRandomValues(buffer);
        value = buffer[0];
      } while (value >= 4294000000);
      const code = String(value % 1000000).padStart(6, "0");
      const challengeId = crypto.randomUUID();
      this.put(rateKey, { expires: now() + 60000 });
      this.put("auth:send-global", { ...global, count: global.count + 1 });
      await sendTelegram(
        this.env,
        `🔐 eSIM 看板登录验证码：${code}\n有效期 5 分钟，最多尝试 5 次。\n请求 IP：${ip}\n如非本人操作，请忽略。`,
      );
      this.put("auth:challenge:" + challengeId, {
        code,
        ip,
        attempts: 0,
        expires: now() + 300000,
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
    }
    throw new HttpError(404, "接口不存在");
  }
  async scheduleNotifications() {
    const today = todayString();
    const cards = this.cards();
    const validCards = [];
    const notices = [];
    const bad = [];
    let changed = false;
    for (const [index, raw] of cards.entries()) {
      try {
        const card = validateCard(raw);
        validCards.push(card);
        const days = daysBetween(today, card.expireDate);
        const detail = `📱 ${card.name}\n📞 ${card.number || "未填写"}\n${card.remark ? "📝 " + card.remark + "\n" : ""}`;
        let message;
        const noticeKey = `notice:${today}:${card.id}`;
        if (this.get(noticeKey)) continue;
        if (days <= 0 && card.autoRenew) {
          const renewed = this.renew(card, "fromToday");
          validCards[validCards.length - 1] = renewed;
          changed = true;
          message = `🔄 看板自动延期\n${detail}新到期日：${renewed.expireDate}\n请确认已完成实际保号操作（短信、充值等）。`;
        } else if (days === 0)
          message = `🚨 今天到期\n${detail}请立即处理保号操作。`;
        else if (days > 0 && days <= card.reminderDays)
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
      for (const row of this.list("notice:"))
        if (
          row.value.status === "sent" &&
          row.value.createdAt < now() - 35 * 86400000
        )
          this.delete(row.key);
    });
    // Persist an alarm before outbound I/O; dates and pending notices commit together.
    await this.arm();
  }
  async arm() {
    const pending = this.list("notice:").filter(
      (row) => row.value.status === "pending",
    );
    if (pending.length)
      await this.ctx.storage.setAlarm(
        Math.max(
          now() + 1100,
          Math.min(...pending.map((row) => row.value.nextAt)),
        ),
      );
  }
  alarm() {
    return this.serial(async () => {
      const item = this.list("notice:").find(
        (row) => row.value.status === "pending" && row.value.nextAt <= now(),
      );
      if (!item) {
        await this.arm();
        return;
      }
      const notice = item.value;
      notice.nextAt = now() + 60000;
      this.put(item.key, notice);
      await this.arm();
      try {
        const chunks = splitMessage(notice.text);
        await sendTelegram(this.env, chunks[notice.part]);
        notice.part++;
        notice.attempts = 0;
        notice.status = notice.part === chunks.length ? "sent" : "pending";
        notice.nextAt = now() + 1100;
      } catch (e) {
        notice.attempts++;
        notice.status = notice.attempts >= 5 ? "failed" : "pending";
        notice.nextAt =
          now() +
          Math.max(
            60000 * 2 ** (notice.attempts - 1),
            (e.retryAfter || 0) * 1000,
          );
        notice.error = e.message;
        console.error(
          "Notification delivery failed",
          item.key,
          notice.attempts,
        );
      }
      this.put(item.key, notice);
      await this.arm();
    });
  }
}
