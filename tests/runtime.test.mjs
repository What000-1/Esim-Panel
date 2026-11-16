import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { sample } from "./helpers.mjs";

test(
  "workerd: migrations, authentication, concurrent writes, version conflicts and logout",
  { timeout: 30000 },
  async (t) => {
    const bundle = await build({
      entryPoints: ["worker/entry.js"],
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
    });
    let code;
    let webhookSecret;
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-05-31",
        durableObjects: {
          ESIM_STORE: { className: "EsimStore", useSQLite: true },
        },
        kvNamespaces: ["ESIM_DB"],
        bindings: {
          TG_BOT_TOKEN: "local-fixture",
          TG_CHAT_ID: "local-fixture",
        },
        outboundService: async (request) => {
          assert.equal(new URL(request.url).hostname, "api.telegram.org");
          const body = await request.json();
          if (body.secret_token) webhookSecret = body.secret_token;
          if (body.text) code = body.text.match(/验证码：(\d{6})/)?.[1] ?? code;
          return Response.json({ ok: true });
        },
      }),
    );
    t.after(() => mf.dispose());
    const kv = await mf.getKVNamespace("ESIM_DB");
    await kv.put("esim_list", JSON.stringify([sample, null]));
    let token;
    let revision;
    async function request(path, method = "GET", body) {
      return mf.dispatchFetch("https://panel.invalid" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "cf-connecting-ip": "192.0.2.1",
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(revision ? { "If-Match": revision } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    const page = await request("/");
    assert.equal(page.status, 200);
    assert((await page.text()).includes("backupMenuBtn"));
    assert.equal((await request("/api/esims")).status, 401);
    const sent = await request("/api/auth/send", "POST");
    assert.equal(sent.status, 200);
    const { challengeId } = await sent.json();
    assert(code);
    const verified = await request("/api/auth/verify", "POST", {
      challengeId,
      code,
    });
    assert.equal(verified.status, 200);
    token = (await verified.json()).token;
    const initial = await request("/api/esims");
    assert.equal((await initial.json()).length, 1);
    const status = await (await request("/api/esims/status")).json();
    assert.equal(status.quarantineCount, 1);
    const replies = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request("/api/esims", "POST", { ...sample, name: "Concurrent " + i }),
      ),
    );
    assert(replies.every((r) => r.status === 200));
    const loaded = await request("/api/esims");
    revision = loaded.headers.get("ETag");
    assert.equal((await loaded.json()).length, 11);
    assert.equal(
      (await request("/api/esims", "PUT", { id: "one", name: "updated" }))
        .status,
      200,
    );
    assert.equal(
      (await request("/api/esims", "DELETE", { id: "one" })).status,
      409,
    );
    assert.equal(
      (await request("/api/telegram/buttons", "POST", { enabled: true }))
        .status,
      200,
    );
    assert.match(webhookSecret, /^[0-9a-f]{64}$/);
    const press = (secret) =>
      mf.dispatchFetch("https://panel.invalid/api/telegram/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": secret,
        },
        body: JSON.stringify({
          update_id: 1,
          callback_query: {
            id: "q",
            data: "re:20260201:one",
            message: {
              message_id: 1,
              chat: { id: "local-fixture" },
              text: "x",
            },
          },
        }),
      });
    assert.equal((await press("wrong")).status, 401);
    assert.equal((await press(webhookSecret)).status, 200);
    const afterPress = await (await request("/api/esims")).json();
    assert.equal(
      afterPress.find((card) => card.id === "one").expireDate,
      "2026-03-01",
    );
    assert.equal((await request("/api/auth/logout", "POST")).status, 200);
    assert.equal((await request("/api/esims")).status, 401);
    assert.deepEqual(await kv.get("esim_list", { type: "json" }), [
      sample,
      null,
    ]);
  },
);
