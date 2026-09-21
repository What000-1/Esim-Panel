import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import vm from "node:vm";
import assets from "../worker/generated-ui.js";
import worker from "../worker/entry.js";
import { todayString, addCalendarCycle } from "../shared/dates.js";
import { sample } from "./helpers.mjs";
async function browser(t) {
  const dom = new JSDOM(assets["/"].body, {
    url: "https://panel.invalid",
    runScripts: "dangerously",
  });
  await new Promise((resolve) =>
    dom.window.addEventListener("load", resolve, { once: true }),
  );
  t.after(() => dom.window.close());
  const w = dom.window;
  const alerts = [];
  w.alert = (message) => alerts.push(message);
  w.confirm = () => true;
  w.fetch = async (url) => {
    if (url.endsWith("/verify"))
      return Response.json({ success: true, token: "local" });
    if (url.endsWith("/status"))
      return Response.json({
        quarantineCount: 0,
        pendingNotifications: 0,
        failedNotifications: 0,
      });
    if (url.endsWith("/logout")) return Response.json({ success: true });
    return Response.json([], {
      headers: { ETag: '"1"', "X-Data-Revision": "1" },
    });
  };
  vm.runInContext(assets["/app.js"].body, dom.getInternalVMContext());
  return {
    w,
    d: w.document,
    alerts,
    setCards(cards) {
      w.eval("esimData = " + JSON.stringify(cards) + "; filterAndRender();");
    },
  };
}
test("stored HTML remains text in cards and renewal dialog; IDs use delegated events", async (t) => {
  const { w, d, setCards } = await browser(t);
  const name = '<img src=x onerror="window.reviewMarker=1">';
  setCards([{ ...sample, name }]);
  assert.equal(d.querySelector("#esim-container h2").textContent, name);
  w.openRenewModal("one");
  assert(d.getElementById("renewSimInfo").textContent.includes(name));
  assert.equal(d.querySelector("#renewSimInfo img"), null);
  assert.equal(
    d.querySelector('[data-action="renew"]').getAttribute("onclick"),
    null,
  );
  w.closeRenewModal();
  d.querySelector('[data-action="renew"]').click();
  assert.equal(
    d.getElementById("renewModal").classList.contains("hidden"),
    false,
  );
  assert.equal(w.reviewMarker, undefined);
});
test("statistics use full data through filters and reset to zero after last deletion", async (t) => {
  const { d, setCards, w } = await browser(t);
  setCards([
    {
      ...sample,
      id: "safe",
      name: "safe",
      expireDate: addCalendarCycle(todayString(), 100, "day"),
    },
    { ...sample, id: "danger", name: "danger", expireDate: todayString() },
  ]);
  const stats = d.getElementById("stats-container").textContent;
  d.getElementById("searchInput").value = "no match";
  w.filterAndRender();
  assert.equal(d.getElementById("stats-container").textContent, stats);
  setCards([]);
  assert.deepEqual(
    [...d.querySelectorAll("#stats-container .text-3xl")].map(
      (el) => el.textContent,
    ),
    ["0", "0", "0"],
  );
});
test("successful login then logout restores login button and clears sensitive UI state", async (t) => {
  const { w, d, setCards, alerts } = await browser(t);
  w.sessionStorage.setItem("esim_challenge_id", "challenge");
  d.getElementById("authCode").value = "123456";
  await w.verifyCode();
  assert.equal(d.getElementById("loginBtn").disabled, false);
  setCards([sample]);
  w.toggleBatchMode();
  w.openEditModal("one");
  await w.logout();
  assert.equal(d.getElementById("loginBtn").disabled, false);
  assert.equal(w.sessionStorage.getItem("esim_auth_token"), null);
  assert.equal(d.getElementById("batchBar").classList.contains("show"), false);
  assert.equal(d.getElementById("addModal").classList.contains("hidden"), true);
  assert.equal(d.getElementById("esim-container").textContent, "");
  assert.equal(w.eval("esimData.length"), 0);
  assert.equal(alerts.length, 0);
});
test("backup menu opens by click and Escape restores focus; dialogs trap focus", async (t) => {
  const { w, d } = await browser(t);
  const button = d.getElementById("backupMenuBtn");
  button.click();
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(
    d.getElementById("backupMenu").classList.contains("hidden"),
    false,
  );
  d.dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(button.getAttribute("aria-expanded"), "false");
  assert.equal(d.activeElement, button);
  w.openExportModal();
  const close = d.querySelector("#exportModal button");
  close.focus();
  close.dispatchEvent(
    new w.KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(d.activeElement.id, "exportBtn");
});
test("createdAt ordering does not use UUID and calendar progress uses actual cycle", async (t) => {
  const { w, d, setCards } = await browser(t);
  const cards = [
    { ...sample, id: "z", createdAt: "2026-01-01T00:00:00Z" },
    { ...sample, id: "a", createdAt: "2026-02-01T00:00:00Z" },
    { ...sample, id: "unknown", createdAt: null },
  ];
  w.eval('currentSort = {key:"addTime",asc:true}');
  assert.deepEqual(
    Array.from(w.sortEsims(cards), (c) => c.id),
    ["z", "a", "unknown"],
  );
  setCards([
    {
      ...sample,
      startDate: todayString(),
      expireDate: addCalendarCycle(todayString(), 30, "day"),
      cycle: 30,
      cycleUnit: "day",
      reminderDays: 0,
    },
  ]);
  assert.equal(
    d.querySelector('#esim-container [style*="width"]').style.width,
    "100%",
  );
  assert(
    d.getElementById("esim-container").textContent.includes("提前0天提醒"),
  );
});
test("CORS rejects lookalike domains and public worker cannot reach internal Cron", async () => {
  for (const origin of [
    "https://workers.dev.attacker.invalid",
    "https://other.workers.dev",
    "https://localhost.attacker.invalid",
    "null",
  ]) {
    const response = await worker.fetch(
      new Request("https://panel.invalid/api/esims", {
        headers: { Origin: origin },
      }),
      {},
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
  const options = await worker.fetch(
    new Request("https://panel.invalid/api/esims", {
      method: "OPTIONS",
      headers: { Origin: "https://panel.invalid" },
    }),
    {},
  );
  assert.equal(options.status, 204);
  assert.equal(
    options.headers.get("Access-Control-Allow-Origin"),
    "https://panel.invalid",
  );
  assert.match(
    options.headers.get("Access-Control-Allow-Headers"),
    /X-Data-Revision/,
  );
  assert.match(
    options.headers.get("Access-Control-Expose-Headers"),
    /X-Data-Revision/,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request("https://panel.invalid/internal/scheduled"),
        {},
      )
    ).status,
    404,
  );
});

test("editing sends the stable data revision when an intermediary weakens ETag", async (t) => {
  const { w, d } = await browser(t);
  w.sessionStorage.setItem("esim_auth_token", "local");
  let writeHeaders;
  let card = sample;
  w.fetch = async (url, options = {}) => {
    if (url.endsWith("/status"))
      return Response.json({
        quarantineCount: 0,
        pendingNotifications: 0,
        failedNotifications: 0,
      });
    if (options.method === "PUT") {
      writeHeaders = options.headers;
      card = { ...card, ...JSON.parse(options.body) };
      return Response.json(
        { success: true, revision: 8 },
        { headers: { ETag: 'W/"8"', "X-Data-Revision": "8" } },
      );
    }
    return Response.json([card], {
      headers: { ETag: 'W/"7"', "X-Data-Revision": "7" },
    });
  };
  await w.fetchEsimData();
  assert.equal(w.eval("dataRevision"), "7");
  w.openEditModal("one");
  d.getElementById("simName").value = "Edited";
  await w.submitForm({ preventDefault() {} });
  assert.equal(writeHeaders["X-Data-Revision"], "7");
  assert.equal(writeHeaders["If-Match"], '"7"');
  assert.equal(w.eval("editingRevision"), "7");
});

test("old encrypted backups decode, overwrite requires confirmation, and stale import snapshots remain stale", async (t) => {
  const { w, d, setCards, alerts } = await browser(t);
  w.eval(assets["/crypto-js.js"].body);
  setCards([sample]);
  w.eval('dataRevision = "\\\"10\\\"";');
  w.openImportModal();
  const backup = {
    version: "1.0",
    encrypted: true,
    data: w.CryptoJS.AES.encrypt(
      JSON.stringify([{ ...sample, name: "Restored" }]),
      "fixture-password",
    ).toString(),
  };
  Object.defineProperty(d.getElementById("importFile"), "files", {
    configurable: true,
    value: [{ size: 1000, text: async () => JSON.stringify(backup) }],
  });
  d.getElementById("importPassword").value = "fixture-password";
  d.querySelector('[name="importMode"][value="overwrite"]').checked = true;
  let writes = 0;
  let received;
  let revision;
  w.fetch = async (url, options) => {
    writes++;
    received = JSON.parse(options.body);
    revision = options.headers["If-Match"];
    return Response.json({ message: "conflict" }, { status: 409 });
  };
  w.confirm = () => false;
  await w.importData();
  assert.equal(writes, 0);
  w.confirm = () => true;
  w.eval('dataRevision = "\\\"11\\\"";');
  await w.importData();
  assert.equal(writes, 1);
  assert.equal(received.data[0].name, "Restored");
  assert.equal(received.mode, "overwrite");
  assert.equal(revision, w.eval("importRevision"));
  assert.notEqual(revision, w.eval("dataRevision"));
  assert(alerts.includes("错误: conflict"));
});

test("served HTML has no inline executable handlers and uses local scripts", () => {
  assert(!/\son(?:click|change|input|submit|error)=/i.test(assets["/"].body));
  assert(!assets["/"].body.includes("cdn.tailwindcss.com"));
  assert(!/<script[^>]+src="https?:/.test(assets["/"].body));
});

test("500-card filtering reuses DOM, preserves selection and releases deleted cards", async (t) => {
  const { w, d, setCards } = await browser(t);
  const cards = Array.from({ length: 500 }, (_, i) => ({
    ...sample,
    id: `card-${i}`,
    name: `Card ${i}`,
  }));
  setCards(cards);
  const original = d.querySelector('[data-id="card-42"]');
  const statistic = d.querySelector("#stats-container .glass-card");
  const search = d.getElementById("searchInput");
  search.value = "Card 42";
  w.filterAndRender();
  assert.equal(d.querySelector('[data-id="card-42"]'), original);
  assert.equal(d.querySelectorAll("#esim-container [data-id]").length, 11);
  assert.equal(d.querySelector("#stats-container .glass-card"), statistic);
  const observer = new w.MutationObserver(() => {});
  observer.observe(d.getElementById("esim-container"), { childList: true });
  w.filterAndRender();
  assert.equal(observer.takeRecords().length, 0);
  observer.disconnect();
  w.toggleBatchMode();
  const checkbox = d.querySelector('[data-select-id="card-42"]');
  checkbox.click();
  search.value = "no results";
  w.filterAndRender();
  search.value = "Card 42";
  w.filterAndRender();
  assert.equal(d.querySelector('[data-select-id="card-42"]').checked, true);
  assert(
    d.querySelector('[data-id="card-42"]').classList.contains("card-selected"),
  );
  search.value = "";
  setCards(
    cards.map((card) =>
      card.id === "card-42" ? { ...card, name: "Updated" } : card,
    ),
  );
  assert.equal(
    d.querySelector('[data-id="card-42"] h2').textContent,
    "Updated",
  );
  setCards(cards.filter((card) => card.id !== "card-42"));
  assert.equal(w.eval('cardRenderCache.has("card-42")'), false);
  await w.logout(false);
  assert.equal(w.eval("cardRenderCache.size"), 0);
});
