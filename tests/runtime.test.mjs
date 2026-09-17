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
          code = body.text.match(/验证码：(\d{6})/)?.[1];
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
    assert.equal((await request("/api/auth/logout", "POST")).status, 200);
    assert.equal((await request("/api/esims")).status, 401);
    assert.deepEqual(await kv.get("esim_list", { type: "json" }), [
      sample,
      null,
    ]);
  },
);
