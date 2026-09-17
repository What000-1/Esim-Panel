import { DatabaseSync } from "node:sqlite";
import { EsimStore } from "../worker/store.js";
export const sample = {
  id: "one",
  name: "Test SIM",
  number: "+1 234",
  startDate: "2026-01-01",
  expireDate: "2026-02-01",
  cycle: 1,
  cycleUnit: "month",
  reminderDays: 15,
  autoRenew: false,
  remark: "",
};
export async function fixture(legacy = [], env = {}) {
  const db = new DatabaseSync(":memory:");
  const state = { alarmAt: null };
  const ctx = {
    storage: {
      sql: {
        exec(query, ...params) {
          const stmt = db.prepare(query);
          const rows = stmt.all(...params);
          return { toArray: () => rows };
        },
      },
      transactionSync(fn) {
        db.exec("BEGIN");
        try {
          const result = fn();
          db.exec("COMMIT");
          return result;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
      async setAlarm(time) {
        state.alarmAt = time;
      },
    },
    blockConcurrencyWhile(fn) {
      state.ready = fn();
    },
  };
  const kv = {
    async get(key) {
      return key === "esim_list" ? structuredClone(legacy) : null;
    },
  };
  const store = new EsimStore(ctx, {
    ESIM_DB: kv,
    TG_BOT_TOKEN: "fixture",
    TG_CHAT_ID: "fixture",
    ...env,
  });
  await state.ready;
  const token = crypto.randomUUID();
  store.put("auth:session:" + token, { expires: Date.now() + 600000 });
  async function request(
    path = "/api/esims",
    method = "GET",
    body,
    {
      revision = `"${store.revision()}"`,
      ip = "192.0.2.1",
      authorization = "Bearer " + token,
      ...headers
    } = {},
  ) {
    return store.fetch(
      new Request("https://local.invalid" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
          "cf-connecting-ip": ip,
          ...(revision ? { "If-Match": revision } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }
  return { store, request, token, state, db, ctx, close: () => db.close() };
}
