import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import vm from "node:vm";
import assets from "../worker/generated-ui.js";
import worker from "../worker/entry.js";
import { todayString, addCalendarCycle } from "../shared/dates.js";
import { sample } from "./helpers.mjs";
import { PHONE_CARDS } from "../shared/phone-cards.js";
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
test("stored HTML remains text in cards and renewal dialogs; IDs use delegated events", async (t) => {
  const { w, d, setCards } = await browser(t);
  const name = '<img src=x onerror="window.reviewMarker=1">';
  const injected = '<img src=x onerror="window.historyMarker=1">';
  setCards([
    {
      ...sample,
      name,
      renewalHistory: [
        {
          renewedAt: "2026-09-21T08:00:00.000Z",
          source: injected,
          mode: "fromExpiry",
          previousExpireDate: "2026-02-01",
          newExpireDate: "2026-03-01",
          cycle: 1,
          cycleUnit: "month",
        },
      ],
    },
  ]);
  assert.equal(d.querySelector("#esim-container h2").textContent, name);
  const historyButton = d.querySelector('[data-action="history"]');
  assert.equal(historyButton.title, "查看续期记录（1）");
  assert.equal(historyButton.querySelector("span").textContent, "1");
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
  w.closeRenewModal();
  d.querySelector('[data-action="history"]').click();
  assert.equal(
    d.getElementById("renewalHistoryModal").classList.contains("hidden"),
    false,
  );
  assert(d.getElementById("renewalHistoryTitle").textContent.includes(name));
  assert(d.getElementById("renewalHistoryList").textContent.includes(injected));
  assert.equal(d.querySelector("#renewalHistoryList img"), null);
  assert.equal(w.reviewMarker, undefined);
  assert.equal(w.historyMarker, undefined);
});
test("BankNav phone card selection fills known rules and keeps unknown cycles manual", async (t) => {
  const { w, d, setCards } = await browser(t);
  assert.equal(PHONE_CARDS.length, 98);
  assert.equal(
    new Set(PHONE_CARDS.map((card) => card.id)).size,
    PHONE_CARDS.length,
  );
  for (const id of [
    "英国:Three",
    "英国:Vodafone",
    "英国:Asda Mobile",
    "德国:O2",
    "荷兰:Simyo",
    "奥地利:Yesss",
    "瑞士:Swisscom",
    "越南:VNSKY",
    "香港:CLS 香港电讯",
    "日本:Cuniq",
    "波兰:Play",
    "捷克:kaktus",
    "奥地利:Lidl eSIM",
    "冰岛:Nova",
    "马耳他:Melita",
    "意大利:Spusu",
    "加拿大:Fizz",
    "塞尔维亚:Yettel",
    "马其顿:Telekom",
    "哈萨克斯坦:Tele2",
    "捷克:O2",
    "乌拉圭:Antel",
    "巴林:STC",
    "萨摩亚:Digicell",
    "巴西:Vivo",
    "波黑:Novotel",
    "斯洛文尼亚:Telekom",
    "斯里兰卡:Dialog",
    "西班牙:Llamaya",
  ]) {
    assert(
      PHONE_CARDS.some((card) => card.id === id),
      `${id} missing`,
    );
  }
  assert(
    !PHONE_CARDS.some((card) =>
      [
        "CodSIM",
        "Red BulI",
        "kiteSim",
        "Roamless",
        "Eskimo",
        "Firsty",
        "esimfan",
      ].includes(card.name),
    ),
  );
  w.openModal();
  const select = d.getElementById("simBrand");
  const search = d.getElementById("simBrandSearch");
  const filter = (query) => {
    search.value = query;
    search.dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const choose = (id) => {
    select.value = id;
    select.dispatchEvent(new w.Event("change", { bubbles: true }));
  };
  filter("荷兰 simyo");
  assert.deepEqual(
    [...select.options].map((option) => option.value),
    ["", "荷兰:Simyo"],
  );
  assert.match(
    d.getElementById("simBrandSearchStatus").textContent,
    /1 个品牌/,
  );
  choose("荷兰:Simyo");
  assert.equal(search.value, "");
  assert.equal(select.options.length, PHONE_CARDS.length + 1);
  filter("不存在的品牌");
  assert.equal(select.value, "荷兰:Simyo");
  assert.equal(select.options.length, 2);
  assert.match(
    d.getElementById("simBrandSearchStatus").textContent,
    /没有匹配/,
  );
  filter("");
  choose("英国:giffgaff");
  assert.equal(d.getElementById("simName").value, "giffgaff");
  assert.equal(d.getElementById("simCycle").value, "180");
  assert.equal(d.getElementById("simCycleUnit").value, "day");
  assert.match(d.getElementById("simRemark").value, /余额变动/);
  assert.equal(
    d.getElementById("simExpire").value,
    addCalendarCycle(todayString(), 180, "day"),
  );
  choose("荷兰:Simyo");
  assert.equal(d.getElementById("simCycle").value, "180");
  assert.match(d.getElementById("simRemark").value, /发一条短信/);
  assert.equal(
    d.getElementById("simBrandSource").href,
    "https://www.banknav.com/sites/5445.html",
  );
  filter("波兰 play");
  assert.deepEqual(
    [...select.options].map((option) => option.value),
    ["", "荷兰:Simyo", "波兰:Play"],
  );
  choose("波兰:Play");
  assert.equal(d.getElementById("simName").value, "Play");
  assert.equal(d.getElementById("simCycle").value, "365");
  assert.equal(d.getElementById("simCycleUnit").value, "day");
  assert.match(d.getElementById("simRemark").value, /充值 5 PLN 保号 365 天/);
  assert.equal(
    d.getElementById("simExpire").value,
    addCalendarCycle(todayString(), 365, "day"),
  );
  assert.equal(
    d.getElementById("simBrandSource").href,
    "https://www.banknav.com/sites/14697.html",
  );
  choose("新西兰:One NZ");
  assert.equal(d.getElementById("simCycle").value, "1");
  assert.equal(
    d.getElementById("simExpire").value,
    addCalendarCycle(todayString(), 4, "year"),
  );
  choose("英国:CMLink UK");
  assert.equal(d.getElementById("simCycle").value, "");
  assert.equal(d.getElementById("simExpire").value, "");
  assert.match(d.getElementById("simBrandHint").textContent, /手动填写/);
  choose("巴西:Vivo");
  assert.equal(d.getElementById("simCycle").value, "");
  assert.match(d.getElementById("simRemark").value, /30–90 天/);
  choose("爱沙尼亚:eSIM Plus");
  assert.equal(d.getElementById("simCycle").required, false);
  assert(d.getElementById("simCycleGroup").classList.contains("hidden"));
  setCards([
    {
      ...sample,
      id: "free",
      name: "eSIM Plus",
      brandId: "爱沙尼亚:eSIM Plus",
      noRenewal: true,
      cycle: null,
      expireDate: null,
    },
  ]);
  assert.match(d.querySelector("#esim-container").textContent, /无需保号/);
  assert.equal(d.querySelector('[data-action="renew"]'), null);
  w.openEditModal("free");
  assert.equal(select.value, "爱沙尼亚:eSIM Plus");
  assert.equal(search.value, "");
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

test("editing a stored no-renewal card with a custom brand keeps it no-renewal", async (t) => {
  const { w, d, setCards } = await browser(t);
  const requests = [];
  const originalFetch = w.fetch;
  w.fetch = async (url, options = {}) => {
    if (options.body) requests.push(JSON.parse(options.body));
    return originalFetch(url, options);
  };
  w.eval('dataRevision = "1"');
  setCards([
    { ...sample, brandId: "", noRenewal: true, cycle: null, expireDate: null },
  ]);
  w.openEditModal("one");
  assert.equal(
    d.getElementById("simCycleGroup").classList.contains("hidden"),
    true,
  );
  d.getElementById("addForm").requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(requests.at(-1).noRenewal, true);
  assert.equal(requests.at(-1).cycle, null);
});

test("batch actions and select-all only affect cards visible in the search", async (t) => {
  const { w, d, setCards } = await browser(t);
  const requests = [];
  const originalFetch = w.fetch;
  w.fetch = async (url, options = {}) => {
    if (options.body) requests.push(JSON.parse(options.body));
    return originalFetch(url, options);
  };
  w.eval('dataRevision = "1"');
  setCards([
    { ...sample, id: "a", name: "Alpha" },
    { ...sample, id: "b", name: "Beta" },
  ]);
  w.toggleBatchMode();
  d.querySelector('[data-select-id="a"]').click();
  d.getElementById("searchInput").value = "beta";
  w.filterAndRender();
  assert.equal(d.getElementById("selectedCount").textContent, "0");
  w.toggleSelectAll(true);
  assert.equal(d.getElementById("selectedCount").textContent, "1");
  await w.batchDelete();
  assert.deepEqual(requests.at(-1).ids, ["b"]);
  assert.equal(w.eval('selectedIds.has("a")'), true);
  w.toggleSelectAll(false);
  assert.equal(w.eval('selectedIds.has("a")'), true);
});

test("logout restores the Telegram icon on the send-code button", async (t) => {
  const { w, d } = await browser(t);
  await w.logout(false);
  assert(d.querySelector("#sendCodeBtn .fa-telegram"));
});

test("panel toggles Telegram renew buttons and labels Telegram renewals", async (t) => {
  const { w, d, setCards } = await browser(t);
  const requests = [];
  const originalFetch = w.fetch;
  w.fetch = async (url, options = {}) => {
    if (options.body) requests.push({ url, body: JSON.parse(options.body) });
    return originalFetch(url, options);
  };
  w.sessionStorage.setItem("esim_challenge_id", "challenge");
  d.getElementById("authCode").value = "123456";
  await w.verifyCode();
  const button = d.getElementById("telegramButtonsBtn");
  assert.equal(button.classList.contains("hidden"), false);
  assert.equal(
    d.getElementById("telegramButtonsLabel").textContent,
    "启用 TG 按钮续期",
  );
  await w.toggleTelegramButtons();
  assert.deepEqual(requests.at(-1), {
    url: "/api/telegram/buttons",
    body: { enabled: true },
  });
  assert.equal(
    d.getElementById("telegramButtonsLabel").textContent,
    "关闭 TG 按钮续期",
  );
  setCards([
    {
      ...sample,
      renewalHistory: [
        {
          renewedAt: "2026-09-21T08:00:00.000Z",
          source: "telegram",
          mode: "fromToday",
          previousExpireDate: "2026-02-01",
          newExpireDate: "2026-03-01",
          cycle: 1,
          cycleUnit: "month",
        },
      ],
    },
  ]);
  w.openRenewalHistory("one");
  assert.match(
    d.getElementById("renewalHistoryList").textContent,
    /TG 按钮续期/,
  );
  await w.logout(false);
  assert.equal(button.classList.contains("hidden"), true);
});

test("renew modal handles overflow dates, edit preserves unknown brands and One NZ uses 1-year cycle after renewal", async (t) => {
  const { w, d, setCards } = await browser(t);
  setCards([
    {
      ...sample,
      id: "overflow",
      name: "Far Future",
      startDate: "9500-01-01",
      expireDate: "9999-01-01",
      cycle: 10,
      cycleUnit: "year",
    },
    {
      ...sample,
      id: "unknown-brand",
      brandId: "旧地区:已下线品牌",
    },
    {
      ...sample,
      id: "one-nz-renewed",
      brandId: "新西兰:One NZ",
      startDate: "2030-01-01",
      expireDate: "2031-01-01",
      cycle: 1,
      cycleUnit: "year",
      renewalHistory: [
        {
          renewedAt: "2030-01-01T00:00:00.000Z",
          source: "manual",
          mode: "fromExpiry",
          previousExpireDate: "2030-01-01",
          newExpireDate: "2031-01-01",
          cycle: 1,
          cycleUnit: "year",
        },
      ],
    },
    {
      ...sample,
      id: "custom-norenew",
      brandId: "",
      noRenewal: true,
      cycle: null,
      expireDate: null,
    },
  ]);

  w.openRenewModal("overflow");
  assert.equal(
    d.getElementById("renewModal").classList.contains("hidden"),
    false,
  );
  assert.match(
    d.getElementById("renewPreviewExpiry").textContent,
    /无法计算新到期日/,
  );
  w.closeRenewModal();

  w.openEditModal("unknown-brand");
  assert.equal(d.getElementById("simBrand").value, "旧地区:已下线品牌");
  w.closeModal();

  w.openEditModal("one-nz-renewed");
  d.getElementById("simStartDate").value = "2030-02-01";
  d.getElementById("simStartDate").dispatchEvent(
    new w.Event("change", { bubbles: true }),
  );
  assert.equal(d.getElementById("simExpire").value, "2031-02-01");
  w.closeModal();

  w.openEditModal("custom-norenew");
  d.getElementById("simStartDate").value = "2026-05-01";
  d.getElementById("simStartDate").dispatchEvent(
    new w.Event("change", { bubbles: true }),
  );
  assert.equal(d.getElementById("expireHint").textContent, "");
  w.closeModal();
});

test("filters, archived exclusion, cost summary, batch renew modal, undo renew, quarantine and notify modals", async (t) => {
  const { w, d, setCards } = await browser(t);
  const requests = [];
  const originalFetch = w.fetch;
  w.fetch = async (url, options = {}) => {
    if (
      url.endsWith("/quarantine") &&
      (!options.method || options.method === "GET")
    ) {
      return Response.json([
        {
          index: 1,
          error: "日期无效",
          raw: { name: "Broken SIM", cycle: "30" },
        },
      ]);
    }
    if (options.body)
      requests.push({
        url,
        method: options.method,
        body: JSON.parse(options.body),
      });
    else if (options.method === "DELETE")
      requests.push({ url, method: options.method });
    return originalFetch(url, options);
  };
  w.eval('dataRevision = "1"');
  const today = todayString();
  setCards([
    {
      ...sample,
      id: "safe1",
      name: "Safe UK",
      number: "+44 123",
      expireDate: addCalendarCycle(today, 100, "day"),
      cycle: 1,
      cycleUnit: "year",
      renewCost: 1,
      renewCurrency: "GBP",
      tags: ["iPhone"],
      account: "uk@example.com",
      balance: "£5",
    },
    {
      ...sample,
      id: "danger1",
      name: "Due HK",
      expireDate: today,
      cycle: 30,
      cycleUnit: "day",
      tags: ["主力"],
      renewalHistory: [
        {
          renewedAt: "2026-09-21T08:00:00.000Z",
          source: "manual",
          mode: "fromExpiry",
          previousExpireDate: "2026-08-21",
          newExpireDate: today,
          cycle: 30,
          cycleUnit: "day",
          cost: 6,
          currency: "HKD",
        },
      ],
    },
    {
      ...sample,
      id: "arch1",
      name: "Archived Old",
      expireDate: today,
      archived: true,
    },
  ]);

  // Archived excluded from active stats and default list
  assert.deepEqual(
    [...d.querySelectorAll("#stats-container .text-3xl")].map(
      (el) => el.textContent,
    ),
    ["1", "0", "1"],
  );
  assert.equal(d.querySelectorAll("#esim-container [data-id]").length, 2);
  assert.match(d.getElementById("cost-summary").textContent, /GBP 1/);
  assert.match(d.getElementById("cost-summary").textContent, /HKD 6/);

  // Stat card click filters to danger, second click resets
  d.querySelector('#stats-container [data-status-filter="danger"]').click();
  assert.deepEqual(
    [...d.querySelectorAll("#esim-container [data-id]")].map(
      (el) => el.dataset.id,
    ),
    ["danger1"],
  );
  d.querySelector('#stats-container [data-status-filter="danger"]').click();
  assert.equal(d.querySelectorAll("#esim-container [data-id]").length, 2);

  // Tag & archived filters
  d.querySelector('[data-tag-filter="iPhone"]').click();
  assert.deepEqual(
    [...d.querySelectorAll("#esim-container [data-id]")].map(
      (el) => el.dataset.id,
    ),
    ["safe1"],
  );
  d.querySelector('[data-tag-filter="iPhone"]').click();
  d.querySelector('#filter-bar [data-status-filter="archived"]').click();
  assert.deepEqual(
    [...d.querySelectorAll("#esim-container [data-id]")].map(
      (el) => el.dataset.id,
    ),
    ["arch1"],
  );
  d.querySelector('#filter-bar [data-status-filter="all"]').click();

  // Unified batch renew modal
  w.toggleBatchMode();
  d.querySelector('[data-select-id="danger1"]').click();
  w.batchRenew();
  assert.equal(
    d.getElementById("renewModal").classList.contains("hidden"),
    false,
  );
  assert.equal(
    d.getElementById("renewBatchPreview").classList.contains("hidden"),
    false,
  );
  d.querySelector('input[name="renewMode"][value="fromToday"]').checked = true;
  await w.confirmRenew();
  assert.equal(requests.at(-1).url, "/api/esims/batch");
  assert.equal(requests.at(-1).body.renewMode, "fromToday");

  // Undo latest renewal from history modal
  w.openRenewalHistory("danger1");
  const undoBtn = d.querySelector('[data-undo-renew="danger1"]');
  assert(undoBtn);
  undoBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(requests.at(-1), {
    url: "/api/esims",
    method: "PUT",
    body: { id: "danger1", undoRenew: true },
  });

  // Quarantine modal repair & clear
  await w.openQuarantineModal();
  assert.equal(
    d.getElementById("quarantineModal").classList.contains("hidden"),
    false,
  );
  d.querySelector('[data-repair-quarantine="0"]').click();
  assert.equal(
    d.getElementById("addModal").classList.contains("hidden"),
    false,
  );
  assert.equal(d.getElementById("simName").value, "Broken SIM");
  w.closeModal();
  await w.clearQuarantine();
  assert.deepEqual(requests.at(-1), {
    url: "/api/esims/quarantine",
    method: "DELETE",
    body: {},
  });

  // Notify settings & test push
  w.openNotifyModal();
  d.querySelector('input[name="notifyMode"][value="milestones"]').checked =
    true;
  await w.saveNotifySettings();
  assert.deepEqual(requests.at(-1), {
    url: "/api/esims/settings",
    method: "PUT",
    body: { notifyMode: "milestones" },
  });
  await w.sendTelegramTest("test");
  assert.deepEqual(requests.at(-1), {
    url: "/api/telegram/test",
    method: "POST",
    body: { mode: "test" },
  });

  // CNY conversion and exchange rates modal
  assert.match(d.getElementById("cost-summary").textContent, /折合 CNY ¥/);
  w.openRatesModal();
  assert.equal(
    d.getElementById("ratesModal").classList.contains("hidden"),
    false,
  );
  const gbpInput = d.querySelector('#ratesList [data-rate-code="GBP"]');
  gbpInput.value = "10";
  d.getElementById("newRateCode").value = "TRY";
  d.getElementById("newRateValue").value = "0.21";
  w.addRateRow();
  assert(d.querySelector('#ratesList [data-rate-code="TRY"]'));
  await w.saveRatesSettings();
  assert.deepEqual(requests.at(-1), {
    url: "/api/esims/settings",
    method: "PUT",
    body: { exchangeRates: { GBP: 10, TRY: 0.21 } },
  });
  assert.match(d.getElementById("cost-summary").textContent, /CNY ¥10/);
});
