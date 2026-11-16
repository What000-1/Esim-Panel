import test from "node:test";
import assert from "node:assert/strict";
import { addCalendarCycle, daysBetween, todayString } from "../shared/dates.js";
import { validateList, validateCard } from "../worker/validation.js";
import {
  splitMessage,
  sendTelegram,
  renewButtons,
  parseRenewCallback,
} from "../worker/telegram.js";
import { fixture, sample } from "./helpers.mjs";

const renewalRecord = {
  renewedAt: "2026-09-21T08:00:00.000Z",
  source: "manual",
  mode: "fromExpiry",
  previousExpireDate: "2026-01-01",
  newExpireDate: "2026-02-01",
  cycle: 1,
  cycleUnit: "month",
};

test("calendar dates clamp month ends, leap days and quarter/year boundaries", () => {
  assert.equal(addCalendarCycle("2026-01-31", 1, "month"), "2026-02-28");
  assert.equal(addCalendarCycle("2024-01-31", 1, "month"), "2024-02-29");
  assert.equal(addCalendarCycle("2024-02-29", 1, "year"), "2025-02-28");
  assert.equal(addCalendarCycle("2026-11-30", 1, "quarter"), "2027-02-28");
  assert.equal(addCalendarCycle("2026-12-31", 1, "day"), "2027-01-01");
  assert.equal(daysBetween("2026-03-08", "2026-03-09"), 1);
  assert.equal(todayString(new Date("2026-09-14T16:00:00Z")), "2026-09-15");
  assert.throws(() => addCalendarCycle("2026-02-30", 1));
  assert.throws(() => addCalendarCycle("9999-12-31", 1));
});
test("shared validation rejects malformed data and duplicates, preserving 0 reminders", () => {
  for (const value of [
    null,
    1,
    {},
    { ...sample, id: "x' onclick='bad" },
    { ...sample, cycle: -1 },
    { ...sample, cycle: 1.5 },
    { ...sample, number: 123 },
    { ...sample, autoRenew: "false" },
    { ...sample, reminderDays: -1 },
    { ...sample, cycleUnit: "decade" },
    { ...sample, expireDate: "2026-02-30" },
    { ...sample, renewalHistory: "invalid" },
    {
      ...sample,
      renewalHistory: [{ ...renewalRecord, source: "unknown" }],
    },
  ])
    assert.throws(() => validateList([value]));
  assert.throws(() => validateList([sample, sample]), /第 2 条/);
  const normalized = validateCard({ ...sample, reminderDays: 0 });
  assert.equal(normalized.reminderDays, 0);
  assert.deepEqual(normalized.renewalHistory, []);
  assert.deepEqual(
    validateCard({ ...sample, renewalHistory: [renewalRecord] }).renewalHistory,
    [renewalRecord],
  );
});
test("no-renewal cards persist without an expiry and never generate reminders", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const response = await f.request("/api/esims", "POST", {
    ...sample,
    brandId: "爱沙尼亚:eSIM Plus",
    noRenewal: true,
    expireDate: null,
    cycle: null,
    autoRenew: true,
  });
  assert.equal(response.status, 200);
  const card = f.store.cards()[0];
  assert.equal(card.brandId, "爱沙尼亚:eSIM Plus");
  assert.equal(card.expireDate, null);
  assert.equal(card.cycle, null);
  assert.equal(card.autoRenew, false);
  assert.equal(
    (
      await f.request("/api/esims", "PUT", {
        id: card.id,
        renewMode: "fromToday",
      })
    ).status,
    400,
  );
  assert.equal((await f.request("/internal/scheduled", "POST")).status, 200);
  assert.equal(f.store.list("notice:").length, 0);
});
test("concurrent inserts retain every record; stale edit/delete/import/batch reject atomically", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      f.request("/api/esims", "POST", { ...sample, name: "Card " + i }),
    ),
  );
  assert(responses.every((r) => r.status === 200));
  assert.equal(f.store.cards().length, 20);
  const revision = `"${f.store.revision()}"`;
  const id = f.store.cards()[0].id;
  assert.equal(
    (await f.request("/api/esims", "PUT", { id, name: "fresh" }, { revision }))
      .status,
    200,
  );
  for (const [path, method, data] of [
    ["/api/esims", "PUT", { id, name: "stale" }],
    ["/api/esims", "DELETE", { id }],
    ["/api/esims/import", "POST", { mode: "overwrite", data: [] }],
    ["/api/esims/batch", "DELETE", { ids: [id] }],
  ])
    assert.equal(
      (await f.request(path, method, data, { revision })).status,
      409,
    );
  assert.equal(f.store.cards()[0].name, "fresh");
  assert.equal(f.store.cards().length, 20);
});
test("revision headers tolerate weak ETags and support a stable custom revision", async (t) => {
  const f = await fixture([sample]);
  t.after(f.close);
  const loaded = await f.request();
  const initialRevision = String(f.store.revision());
  assert.equal(loaded.headers.get("X-Data-Revision"), initialRevision);
  assert.equal(loaded.headers.get("ETag"), `"${initialRevision}"`);
  assert.equal(
    (
      await f.request(
        "/api/esims",
        "PUT",
        { id: "one", name: "weak-etag" },
        { revision: `W/"${initialRevision}"` },
      )
    ).status,
    200,
  );
  const currentRevision = String(f.store.revision());
  const updated = await f.request(
    "/api/esims",
    "PUT",
    { id: "one", name: "custom-header" },
    { revision: null, "X-Data-Revision": currentRevision },
  );
  assert.equal(updated.status, 200);
  assert.equal(
    updated.headers.get("X-Data-Revision"),
    String(f.store.revision()),
  );
  assert.equal(f.store.cards()[0].name, "custom-header");
});

test("invalid import leaves original data intact and missing revision is rejected", async (t) => {
  const f = await fixture([sample]);
  t.after(f.close);
  for (const data of [
    [null],
    [sample, { ...sample, id: "two", expireDate: "bad" }],
    [sample, sample],
  ]) {
    const result = await f.request("/api/esims/import", "POST", {
      mode: "overwrite",
      data,
    });
    assert.equal(result.status, 400);
    assert.equal(f.store.cards().length, 1);
  }
  assert.equal(
    (await f.request("/api/esims", "DELETE", { id: "one" }, { revision: null }))
      .status,
    428,
  );
});
test("creation, update and batch all validate and renew using shared calendar rules", async (t) => {
  const f = await fixture([{ ...sample, expireDate: "2026-01-31" }]);
  t.after(f.close);
  assert.equal(
    (await f.request("/api/esims", "POST", { ...sample, cycle: "30" })).status,
    400,
  );
  assert.equal(
    (await f.request("/api/esims", "PUT", { id: "one", expireDate: "bad" }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/esims/batch", "PUT", {
        ids: ["one"],
        renewMode: "other",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/esims/batch", "PUT", {
        ids: ["one"],
        renewMode: "fromExpiry",
      })
    ).status,
    200,
  );
  assert.equal(f.store.cards()[0].expireDate, "2026-02-28");
  assert.equal(f.store.cards()[0].startDate, "2026-01-31");
  assert.deepEqual(
    f.store.cards()[0].renewalHistory.map((item) => ({
      source: item.source,
      mode: item.mode,
      previousExpireDate: item.previousExpireDate,
      newExpireDate: item.newExpireDate,
    })),
    [
      {
        source: "batch",
        mode: "fromExpiry",
        previousExpireDate: "2026-01-31",
        newExpireDate: "2026-02-28",
      },
    ],
  );
  assert.equal(
    (
      await f.request("/api/esims", "PUT", {
        id: "one",
        renewMode: "fromExpiry",
      })
    ).status,
    200,
  );
  const renewed = f.store.cards()[0];
  assert.equal(renewed.renewalHistory.length, 2);
  assert.equal(renewed.renewalHistory[1].source, "manual");
  assert.equal(renewed.renewalHistory[1].previousExpireDate, "2026-02-28");
  assert.equal(renewed.renewalHistory[1].newExpireDate, "2026-03-28");
  assert.equal(
    (
      await f.request("/api/esims", "PUT", {
        id: "one",
        name: "Renamed",
        renewalHistory: [],
      })
    ).status,
    200,
  );
  assert.equal(f.store.cards()[0].renewalHistory.length, 2);
});

test("renewal history keeps only the newest twenty records", async (t) => {
  const f = await fixture([sample]);
  t.after(f.close);
  let card = validateCard(sample);
  for (let index = 0; index < 25; index++)
    card = f.store.renew(card, "fromExpiry", "manual");
  assert.equal(card.renewalHistory.length, 20);
  assert.equal(card.renewalHistory.at(-1).newExpireDate, card.expireDate);
  assert.equal(card.renewalHistory[0].previousExpireDate, "2026-07-01");
});
test("legacy migration keeps valid rows, quarantines invalid/duplicate rows, and preserves creation history", async (t) => {
  const f = await fixture([
    sample,
    null,
    { ...sample },
    { ...sample, id: "1700000000000", cycle: "3" },
    { ...sample, id: "old-uuid" },
  ]);
  t.after(f.close);
  assert.equal(f.store.cards().length, 3);
  assert.equal(f.store.list("quarantine:").length, 2);
  assert.equal(f.store.cards()[1].createdAt, "2023-11-14T22:13:20.000Z");
  assert.equal(f.store.cards()[2].createdAt, null);
  assert.equal(
    (await (await f.request("/api/esims/status")).json()).quarantineCount,
    2,
  );
});
test("OTP attempts are isolated, fifth wrong code consumes only its own challenge, OTP cannot replay", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  f.store.put("auth:challenge:" + a, {
    code: "123456",
    ip: "192.0.2.1",
    attempts: 0,
    expires: Date.now() + 300000,
  });
  f.store.put("auth:challenge:" + b, {
    code: "654321",
    ip: "192.0.2.2",
    attempts: 0,
    expires: Date.now() + 300000,
  });
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await f.request("/api/auth/verify", "POST", {
          challengeId: a,
          code: "000000",
        })
      ).status,
      401,
    );
  assert.equal(f.store.get("auth:challenge:" + a), null);
  assert(f.store.get("auth:challenge:" + b));
  const replies = await Promise.all(
    [1, 2].map(() =>
      f.request(
        "/api/auth/verify",
        "POST",
        { challengeId: b, code: "654321" },
        { ip: "192.0.2.2" },
      ),
    ),
  );
  assert.deepEqual(
    replies.map((r) => r.status),
    [200, 400],
  );
});
test("auth enforces Bearer syntax, expiry, logout revocation and bounded attempts", async (t) => {
  const f = await fixture();
  t.after(f.close);
  assert.equal(
    (
      await f.request("/api/esims", "GET", undefined, {
        authorization: f.token,
      })
    ).status,
    401,
  );
  f.store.put("auth:attempts:192.0.2.1", {
    count: 10,
    expires: Date.now() + 300000,
  });
  const id = crypto.randomUUID();
  f.store.put("auth:challenge:" + id, {
    code: "123456",
    ip: "192.0.2.2",
    attempts: 0,
    expires: Date.now() + 300000,
  });
  assert.equal(
    (
      await f.request("/api/auth/verify", "POST", {
        challengeId: id,
        code: "000000",
      })
    ).status,
    429,
  );
  assert(f.store.get("auth:challenge:" + id));
  assert.equal((await f.request("/api/auth/logout", "POST")).status, 200);
  assert.equal((await f.request()).status, 401);
});
test("notifications persist with renewal, de-duplicate cron and continue past invalid records", async (t) => {
  const f = await fixture(
    Array.from({ length: 10 }, (_, i) => ({
      ...sample,
      id: "c" + i,
      expireDate: todayString(),
      remark: "备".repeat(500),
      autoRenew: true,
    })),
  );
  t.after(f.close);
  f.store.put("card:bad", null);
  assert.equal((await f.request("/internal/scheduled", "POST")).status, 200);
  assert.equal(f.store.list("notice:").length, 10);
  assert(f.state.alarmAt);
  assert.equal(f.store.get("card:c0").renewalHistory.length, 1);
  assert.equal(f.store.get("card:c0").renewalHistory[0].source, "auto");
  assert.equal(f.store.get("card:c0").renewalHistory[0].mode, "fromToday");
  assert.equal(
    f.store.get("card:c0").expireDate,
    addCalendarCycle(todayString(), 1, "month"),
  );
  await f.request("/internal/scheduled", "POST");
  assert.equal(f.store.list("notice:").length, 10);
  assert(f.store.list("notice:").every((r) => r.value.text.length < 4096));
});
test("notification alarms retry errors, retain failed work and recover after object recreation", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const key = "notice:test";
  f.store.put(key, {
    text: "message",
    part: 0,
    status: "pending",
    attempts: 0,
    nextAt: 0,
    createdAt: Date.now(),
  });
  globalThis.fetch = async () => Response.json({ ok: false }, { status: 400 });
  await f.store.alarm();
  assert.equal(f.store.get(key).attempts, 1);
  assert.equal(f.store.get(key).status, "pending");
  assert(f.state.alarmAt > Date.now());
  for (let i = 1; i < 5; i++) {
    const item = f.store.get(key);
    item.nextAt = 0;
    f.store.put(key, item);
    await f.store.alarm();
  }
  assert.equal(f.store.get(key).status, "failed");
  const item = f.store.get(key);
  f.store.put(key, { ...item, status: "pending", nextAt: 0 });
  const { EsimStore } = await import("../worker/store.js");
  const restarted = new EsimStore(f.ctx, f.store.env);
  await f.state.ready;
  globalThis.fetch = async () => Response.json({ ok: true });
  await restarted.alarm();
  assert.equal(restarted.get(key).status, "sent");
  let sends = 0;
  globalThis.fetch = async () => {
    sends++;
    return Response.json({ ok: true });
  };
  await restarted.alarm();
  assert.equal(sends, 0);
});
test("Telegram checks HTTP and ok, splits unicode text without cutting surrogate pairs", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const text = "😀".repeat(6000);
  const pieces = splitMessage(text);
  assert.equal(pieces.join(""), text);
  assert(pieces.every((p) => p.length <= 3500));
  globalThis.fetch = async () => Response.json({ ok: false }, { status: 200 });
  await assert.rejects(
    sendTelegram({ TG_BOT_TOKEN: "fake", TG_CHAT_ID: "fake" }, "test"),
  );
  globalThis.fetch = async () => Response.json({ ok: true });
  await sendTelegram({ TG_BOT_TOKEN: "fake", TG_CHAT_ID: "fake" }, "test");
});

test("OTP send rate limits do not overwrite active challenges, failures issue no usable challenge", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const messages = [];
  globalThis.fetch = async (url, options) => {
    messages.push(JSON.parse(options.body).text);
    return Response.json({ ok: true });
  };
  const first = await f.request("/api/auth/send", "POST");
  assert.equal(first.status, 200);
  const a = await first.json();
  const code = messages[0].match(/验证码：(\d{6})/)[1];
  assert.equal((await f.request("/api/auth/send", "POST")).status, 429);
  const second = await f.request("/api/auth/send", "POST", undefined, {
    ip: "192.0.2.2",
  });
  assert.equal(second.status, 200);
  assert(f.store.get("auth:challenge:" + a.challengeId));
  assert.equal(
    (
      await f.request("/api/auth/verify", "POST", {
        challengeId: a.challengeId,
        code,
      })
    ).status,
    200,
  );
  globalThis.fetch = async () => Response.json({ ok: false }, { status: 400 });
  const count = f.store.list("auth:challenge:").length;
  assert.equal(
    (await f.request("/api/auth/send", "POST", undefined, { ip: "192.0.2.3" }))
      .status,
    503,
  );
  assert.equal(f.store.list("auth:challenge:").length, count);
});

test("explicit fresh install is required without KV; failed reads never initialize an empty store", async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.store.delete("initialized");
  f.store.env.ESIM_DB = undefined;
  await assert.rejects(f.store.migrate(), /ESIM_DB/);
  assert.equal(f.store.get("initialized"), null);
  f.store.env.ESIM_DB = {
    get: async () => {
      throw new Error("read failure");
    },
  };
  await assert.rejects(f.store.migrate(), /read failure/);
  assert.equal(f.store.get("initialized"), null);
  f.store.env.ESIM_DB = undefined;
  f.store.env.FRESH_INSTALL = "true";
  await f.store.migrate();
  assert(f.store.get("initialized"));
});

test("failed notification retry is authenticated and restores persistent pending work", async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.store.put("notice:failed", {
    text: "test",
    status: "failed",
    attempts: 5,
    nextAt: 0,
    part: 0,
    createdAt: Date.now(),
  });
  assert.equal(
    (
      await f.request(
        "/api/esims/notifications/retry",
        "POST",
        {},
        { authorization: "" },
      )
    ).status,
    401,
  );
  assert.equal(f.store.get("notice:failed").status, "failed");
  assert.equal(
    (await f.request("/api/esims/notifications/retry", "POST", {})).status,
    200,
  );
  assert.equal(f.store.get("notice:failed").status, "pending");
  assert.equal(f.store.get("notice:failed").attempts, 0);
  assert(f.state.alarmAt);
});

test("legacy records with null optional text fields, null flags, empty createdAt and string numbers import cleanly", () => {
  const card = validateCard(
    {
      ...sample,
      number: null,
      remark: null,
      brandId: null,
      noRenewal: null,
      autoRenew: null,
      createdAt: "",
      cycle: " 30 ",
      reminderDays: "7",
    },
    { legacy: true },
  );
  assert.equal(card.number, "");
  assert.equal(card.remark, "");
  assert.equal(card.brandId, "");
  assert.equal(card.noRenewal, false);
  assert.equal(card.autoRenew, false);
  assert.equal(card.createdAt, null);
  assert.equal(card.cycle, 30);
  assert.equal(card.reminderDays, 7);
  assert.throws(() =>
    validateCard({ ...sample, noRenewal: null }, { legacy: false }),
  );
});

test("failed auto renewal keeps the card out of quarantine and still notifies", async (t) => {
  const f = await fixture([
    {
      ...sample,
      startDate: "1900-01-01",
      expireDate: todayString(),
      cycle: 8000,
      cycleUnit: "year",
      autoRenew: true,
    },
  ]);
  t.after(f.close);
  assert.equal((await f.request("/internal/scheduled", "POST")).status, 200);
  assert.equal(f.store.list("quarantine:").length, 0);
  assert.equal(f.store.cards().length, 1);
  assert.equal(f.store.cards()[0].expireDate, todayString());
  const [notice] = f.store.list("notice:");
  assert.match(notice.value.text, /自动延期失败/);
});

test("reminders for deleted cards are dropped and old failed notices are cleaned", async (t) => {
  const f = await fixture([sample]);
  t.after(f.close);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let sent = 0;
  globalThis.fetch = async () => {
    sent++;
    return Response.json({ ok: true });
  };
  const notice = {
    text: "message",
    part: 0,
    status: "pending",
    attempts: 0,
    nextAt: 0,
    createdAt: Date.now(),
  };
  f.store.put("notice:2026-01-01:gone", notice);
  f.store.put("notice:2026-01-02:gone2", notice);
  await f.store.alarm();
  assert.equal(sent, 0);
  assert.equal(f.store.get("notice:2026-01-01:gone"), null);
  assert.equal(f.store.get("notice:2026-01-02:gone2"), null);
  assert.equal(f.state.alarmAt, null);
  f.store.put("notice:2026-01-01:one", {
    ...notice,
    status: "failed",
    createdAt: Date.now() - 40 * 86400000,
  });
  await f.request("/internal/scheduled", "POST");
  assert.equal(f.store.get("notice:2026-01-01:one"), null);
});

test("Telegram renew buttons renew once, only for the configured chat and secret", async (t) => {
  const expireDate = addCalendarCycle(todayString(), 3, "day");
  const f = await fixture([{ ...sample, expireDate }]);
  t.after(f.close);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      method: String(url).split("/").pop(),
      body: JSON.parse(options.body),
    });
    return Response.json({ ok: true, result: true });
  };
  const last = (method) => calls.filter((c) => c.method === method).at(-1);

  assert.equal(
    (await f.request("/api/telegram/buttons", "POST", { enabled: true }))
      .status,
    200,
  );
  const setup = last("setWebhook").body;
  assert.equal(setup.url, "https://local.invalid/api/telegram/webhook");
  assert.deepEqual(setup.allowed_updates, ["callback_query", "message"]);
  assert.match(setup.secret_token, /^[0-9a-f]{64}$/);
  assert.equal(
    (await (await f.request("/api/esims/status")).json()).telegramButtons,
    true,
  );

  await f.request("/internal/scheduled", "POST");
  await f.store.alarm();
  const sent = last("sendMessage").body;
  const [fromExpiry, fromToday] = sent.reply_markup.inline_keyboard[0];
  assert.deepEqual(parseRenewCallback(fromExpiry.callback_data), {
    mode: "fromExpiry",
    expireDate,
    cardId: "one",
  });

  const press = (
    data,
    { chat = "fixture", secret = setup.secret_token, id = "q" } = {},
  ) =>
    f.request(
      "/api/telegram/webhook",
      "POST",
      {
        update_id: 1,
        callback_query: {
          id,
          data,
          message: { message_id: 7, chat: { id: chat }, text: sent.text },
        },
      },
      {
        authorization: "",
        revision: null,
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
    );
  const revision = f.store.revision();
  assert.equal(
    (await press(fromExpiry.callback_data, { secret: "wrong" })).status,
    401,
  );
  assert.equal(
    (await press(fromExpiry.callback_data, { chat: "intruder" })).status,
    200,
  );
  assert.match(last("answerCallbackQuery").body.text, /无权/);
  assert.equal(f.store.revision(), revision);

  assert.equal((await press(fromExpiry.callback_data)).status, 200);
  const renewed = f.store.get("card:one");
  assert.equal(renewed.expireDate, addCalendarCycle(expireDate, 1, "month"));
  assert.equal(renewed.renewalHistory.at(-1).source, "telegram");
  assert.equal(renewed.renewalHistory.at(-1).mode, "fromExpiry");
  assert.equal(f.store.revision(), revision + 1);
  const edited = last("editMessageText").body;
  assert.match(edited.text, /新到期日/);
  assert.deepEqual(edited.reply_markup.inline_keyboard, []);

  // A redelivered update or the second button must not renew again.
  await press(fromToday.callback_data, { id: "q2" });
  assert.equal(f.store.get("card:one").expireDate, renewed.expireDate);
  assert.equal(f.store.revision(), revision + 1);
  assert.match(last("answerCallbackQuery").body.text, /未重复操作/);
  assert(last("editMessageReplyMarkup"));

  assert.equal(
    (await f.request("/api/telegram/buttons", "POST", { enabled: false }))
      .status,
    200,
  );
  assert(last("deleteWebhook"));
  await press(fromToday.callback_data, { id: "q3" });
  assert.equal(f.store.get("card:one").expireDate, renewed.expireDate);
  assert.match(last("answerCallbackQuery").body.text, /已关闭/);
  f.store.put("notice:" + todayString() + ":one", {
    text: "again",
    status: "pending",
    attempts: 0,
    nextAt: 0,
    createdAt: Date.now(),
    part: 0,
    renew: { cardId: "one", expireDate: renewed.expireDate },
  });
  await f.store.alarm();
  assert.equal(last("sendMessage").body.text, "again");
  assert.equal(last("sendMessage").body.reply_markup, undefined);
  assert.equal(f.state.alarmAt, null);
});

test("slow Telegram network requests do not block card reads", async (t) => {
  const f = await fixture([sample]);
  t.after(f.close);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let releaseTelegram;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      releaseTelegram = () => resolve(Response.json({ ok: true }));
    });
  const sendPromise = f.request("/api/auth/send", "POST");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const readResponse = await f.request("/api/esims");
  assert.equal(readResponse.status, 200);
  assert.equal((await readResponse.json()).length, 1);
  releaseTelegram();
  assert.equal((await sendPromise).status, 200);
});

test("undo renewal, cost tracking, tags, quarantine clear, milestones, mute/archive, and TG commands", async (t) => {
  const today = todayString();
  const in5Days = addCalendarCycle(today, 5, "day");
  const in20Days = addCalendarCycle(today, 20, "day");
  const f = await fixture([
    null,
    {
      ...sample,
      id: "due1",
      name: "UK Card",
      number: "+44 7700",
      startDate: "2026-01-01",
      expireDate: in5Days,
      reminderDays: 15,
      renewCost: 0.1,
      renewCurrency: "gbp",
      tags: ["iPhone", "主力"],
      account: "test@example.com",
      balance: "£5.00",
    },
    {
      ...sample,
      id: "archived1",
      name: "Old Card",
      expireDate: today,
      archived: true,
      autoRenew: true,
    },
    {
      ...sample,
      id: "muted1",
      name: "Muted Card",
      expireDate: today,
      muteReminders: true,
      autoRenew: true,
    },
    {
      ...sample,
      id: "milestone1",
      name: "Milestone Card",
      expireDate: in5Days,
      reminderDays: 15,
    },
    {
      ...sample,
      id: "safe20",
      name: "Safe Card",
      expireDate: in20Days,
      reminderDays: 15,
    },
  ]);
  t.after(f.close);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      method: String(url).split("/").pop(),
      body: JSON.parse(options.body),
    });
    return Response.json({ ok: true, result: true });
  };

  assert.equal(
    (await (await f.request("/api/esims/status")).json()).quarantineCount,
    1,
  );
  assert.equal(
    (await f.request("/api/esims/quarantine", "DELETE")).status,
    200,
  );
  assert.equal(
    (await (await f.request("/api/esims/status")).json()).quarantineCount,
    0,
  );

  // Renew with cost & undo
  assert.equal(
    (
      await f.request("/api/esims", "PUT", {
        id: "due1",
        renewMode: "fromExpiry",
        renewCost: 0.5,
        renewCurrency: "GBP",
      })
    ).status,
    200,
  );
  const renewed = f.store.get("card:due1");
  assert.equal(renewed.expireDate, addCalendarCycle(in5Days, 1, "month"));
  assert.equal(renewed.renewalHistory.at(-1).cost, 0.5);
  assert.equal(renewed.renewalHistory.at(-1).currency, "GBP");
  assert.equal(renewed.renewalHistory.at(-1).previousStartDate, "2026-01-01");

  assert.equal(
    (await f.request("/api/esims", "PUT", { id: "due1", undoRenew: true }))
      .status,
    200,
  );
  const undone = f.store.get("card:due1");
  assert.equal(undone.expireDate, in5Days);
  assert.equal(undone.startDate, "2026-01-01");
  assert.equal(undone.renewalHistory.length, 0);

  // Switch to milestones mode and run Cron
  assert.equal(
    (
      await f.request("/api/esims/settings", "PUT", {
        notifyMode: "milestones",
      })
    ).status,
    200,
  );
  await f.request("/internal/scheduled", "POST");
  // Archived card does not auto-renew or notify; muted card auto-renews silently;
  // due1 & milestone1 are at 5 days (not in [15, 7, 3, 1, 0]) so skipped under milestones.
  assert.equal(f.store.get("card:archived1").expireDate, today);
  assert.equal(
    f.store.get("card:muted1").expireDate,
    addCalendarCycle(today, 1, "month"),
  );
  assert.equal(f.store.list("notice:").length, 0);

  // Enable webhook and test TG commands + test push
  assert.equal(
    (await f.request("/api/telegram/buttons", "POST", { enabled: true }))
      .status,
    200,
  );
  const secret = calls.find((c) => c.method === "setWebhook").body.secret_token;
  const cmd = (text, chat = "fixture") =>
    f.request(
      "/api/telegram/webhook",
      "POST",
      {
        update_id: 2,
        message: { message_id: 10, chat: { id: chat }, text },
      },
      {
        authorization: "",
        revision: null,
        "X-Telegram-Bot-Api-Secret-Token": secret,
      },
    );
  assert.equal((await cmd("/due", "intruder")).status, 200);
  assert.equal(calls.filter((c) => c.method === "sendMessage").length, 0);

  assert.equal((await cmd("/due")).status, 200);
  const dueMsgs = calls.filter((c) => c.method === "sendMessage");
  assert.equal(dueMsgs.length, 2);
  assert(dueMsgs[0].body.reply_markup.inline_keyboard[0][0].callback_data);

  assert.equal((await cmd("/search UK")).status, 200);
  assert.match(calls.at(-1).body.text, /UK Card/);

  assert.equal((await cmd("/list")).status, 200);
  assert.match(calls.at(-1).body.text, /全部活跃卡片（共 4 张）/);

  assert.equal(
    (await f.request("/api/telegram/test", "POST", { mode: "summary" })).status,
    200,
  );
  assert.match(calls.at(-1).body.text, /近期到期与过期卡片/);
});

test("renew buttons are omitted when callback data would exceed 64 bytes", () => {
  assert.equal(renewButtons("x".repeat(80), "2026-01-01"), null);
  assert(renewButtons("1700000000000", "2026-01-01"));
  assert.equal(parseRenewCallback("rx:20260101:one"), null);
});
