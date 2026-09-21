import test from "node:test";
import assert from "node:assert/strict";
import { addCalendarCycle, daysBetween, todayString } from "../shared/dates.js";
import { validateList, validateCard } from "../worker/validation.js";
import { splitMessage, sendTelegram } from "../worker/telegram.js";
import { fixture, sample } from "./helpers.mjs";

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
  ])
    assert.throws(() => validateList([value]));
  assert.throws(() => validateList([sample, sample]), /第 2 条/);
  assert.equal(validateCard({ ...sample, reminderDays: 0 }).reminderDays, 0);
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
