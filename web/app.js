// API 路由前缀
const WORKER_API_URL = "/api/esims";
let esimData = [];
let dataRevision = null;
let fetchGeneration = 0;
let sessionGeneration = 0;
let mutationBusy = false;
let editingRevision = null;
let importTarget = null;
let countdownInterval;
let editingId = null;
let batchMode = false;
let selectedIds = new Set();
let currentSort = { key: "remainDays", asc: true };
let searchTimer = null;
const cardRenderCache = new Map();
let renewTarget = null; // { id, cycle, cycleUnit, expireDate, name } 或 { isBatch: true, cards, ids, visibleIds, revision }
let renewalHistoryTarget = null;
const LOGIN_BUTTON_LABEL =
  '<i class="fa-solid fa-arrow-right-to-bracket"></i> 登录面板';
const SEND_CODE_LABEL =
  '<i class="fa-brands fa-telegram text-lg"></i> 向 TG 机器人获取验证码';
const IMPORT_BUTTON_LABEL = document.getElementById("importBtn").innerHTML;
let formNoRenewal = false; // 表单当前是否按“无需保号”处理（与界面显示保持一致）
let telegramButtonsEnabled = false; // 服务端是否已为提醒消息启用续期按钮
let statusFilter = "all"; // all | safe | warning | danger | noRenewal | archived
let tagFilter = "";
let notifyMode = "daily";
let customExchangeRates = {};
let quarantineItems = [];

function applyTheme(dark) {
  document.documentElement.classList.toggle("dark", dark);
  document.querySelectorAll(".theme-toggle-btn i").forEach((icon) => {
    icon.className = dark
      ? "fa-solid fa-sun text-amber-400 text-sm"
      : "fa-solid fa-moon text-sm";
  });
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("esim_theme");
  } catch {}
  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved ? saved === "dark" : prefersDark);
}

function toggleTheme() {
  const nextDark = !document.documentElement.classList.contains("dark");
  applyTheme(nextDark);
  try {
    localStorage.setItem("esim_theme", nextDark ? "dark" : "light");
  } catch {}
}

initTheme();

// ================= XSS 防护 =================
function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ================= 周期计算工具函数 =================
function getCycleUnitLabel(unit) {
  const labels = { day: "天", month: "个月", quarter: "季度", year: "年" };
  return labels[unit] || "天";
}

function updateCurrentDate() {
  document.getElementById("current-date").innerText =
    todayString() + "（北京时间）";
}

updateCurrentDate();

window.onload = () => {
  if (sessionStorage.getItem("esim_auth_token")) {
    fetchEsimData();
  }
};

function getAuthHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization:
      "Bearer " + (sessionStorage.getItem("esim_auth_token") || ""),
  };
}
function normalizeRevision(value) {
  if (!value) return null;
  const match = /^(?:W\/)?"(\d+)"$/.exec(value.trim());
  if (match) return match[1];
  return /^\d+$/.test(value.trim()) ? value.trim() : null;
}
async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    if (response.status === 401) await logout(false);
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "操作失败，请稍后重试");
  }
  return response;
}
async function mutate(url, method, body, revision = dataRevision) {
  if (mutationBusy) throw new Error("上一项操作尚未完成，请稍候");
  mutationBusy = true;
  try {
    const normalizedRevision = normalizeRevision(revision);
    return await apiRequest(url, {
      method,
      headers: {
        ...getAuthHeaders(),
        ...(normalizedRevision
          ? {
              "X-Data-Revision": normalizedRevision,
              "If-Match": `"${normalizedRevision}"`,
            }
          : {}),
      },
      body: JSON.stringify(body),
    });
  } finally {
    mutationBusy = false;
  }
}

async function sendAuthCode() {
  const btn = document.getElementById("sendCodeBtn");
  if (btn.disabled) return;
  const generation = sessionGeneration;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> 发送中...';

  try {
    const response = await fetch("/api/auth/send", { method: "POST" });
    const data = await response.json();
    if (generation !== sessionGeneration) return;

    if (response.ok && data.success) {
      sessionStorage.setItem("esim_challenge_id", data.challengeId);
      clearInterval(countdownInterval);
      let timeLeft = 60;
      btn.innerHTML = `<i class="fa-solid fa-clock mr-2"></i> ${timeLeft} 秒后可重发`;
      countdownInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
          clearInterval(countdownInterval);
          btn.disabled = false;
          btn.innerHTML = SEND_CODE_LABEL;
        } else {
          btn.innerHTML = `<i class="fa-solid fa-clock mr-2"></i> ${timeLeft} 秒后可重发`;
        }
      }, 1000);
    } else {
      alert("发送失败: " + (data.message || "后端未配置机器人信息"));
      btn.disabled = false;
      btn.innerHTML = SEND_CODE_LABEL;
    }
  } catch (e) {
    if (generation !== sessionGeneration) return;
    alert("网络错误，发送失败");
    btn.disabled = false;
    btn.innerHTML = SEND_CODE_LABEL;
  }
}

async function verifyCode() {
  const code = document.getElementById("authCode").value.trim();
  const challengeId = sessionStorage.getItem("esim_challenge_id");
  if (!/^\d{6}$/.test(code) || !challengeId)
    return alert("请先获取验证码，并输入 6 位数字");
  const btn = document.getElementById("loginBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = "验证中...";
  try {
    const response = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, challengeId }),
    });
    const data = await response.json();
    if (!response.ok || !data.success)
      throw new Error(data.message || "验证失败");
    sessionStorage.setItem("esim_auth_token", data.token);
    sessionStorage.removeItem("esim_challenge_id");
    document.getElementById("authCode").value = "";
    await fetchEsimData();
  } catch (e) {
    alert(e.message || "网络错误，验证失败");
  } finally {
    btn.disabled = false;
    btn.innerHTML = LOGIN_BUTTON_LABEL;
  }
}

function setBatchButtonVisual(active) {
  const btn = document.getElementById("batchModeBtn");
  const activeClasses = [
    "bg-blue-50",
    "dark:bg-blue-950/70",
    "border-blue-300",
    "dark:border-blue-700",
    "text-blue-700",
    "dark:text-blue-300",
  ];
  const idleClasses = [
    "bg-white/80",
    "dark:bg-slate-800/80",
    "text-slate-700",
    "dark:text-slate-200",
    "border-slate-200/90",
    "dark:border-slate-700",
  ];
  btn.classList.toggle("ring-2", active);
  btn.classList.toggle("ring-blue-500/20", active);
  for (const cls of activeClasses) btn.classList.toggle(cls, active);
  for (const cls of idleClasses) btn.classList.toggle(cls, !active);
}

async function logout(revoke = true) {
  const headers = getAuthHeaders();
  fetchGeneration++;
  sessionGeneration++;
  sessionStorage.removeItem("esim_auth_token");
  sessionStorage.removeItem("esim_challenge_id");
  esimData = [];
  cardRenderCache.clear();
  clearTimeout(searchTimer);
  dataRevision = null;
  selectedIds.clear();
  batchMode = false;
  editingId = null;
  renewTarget = null;
  renewalHistoryTarget = null;
  importTarget = null;
  clearInterval(countdownInterval);
  document.getElementById("login-container").classList.remove("hidden");
  document.getElementById("main-container").classList.add("hidden");
  document.getElementById("main-container").classList.remove("batch-mode");
  document.getElementById("batchBar").classList.remove("show");
  document.getElementById("batchBar").hidden = true;
  document.getElementById("esim-container").replaceChildren();
  document.getElementById("stats-container").replaceChildren();
  document.getElementById("searchInput").value = "";
  document.getElementById("service-status").textContent = "";
  document.getElementById("telegramButtonsBtn").classList.add("hidden");
  telegramButtonsEnabled = false;
  statusFilter = "all";
  tagFilter = "";
  notifyMode = "daily";
  customExchangeRates = {};
  quarantineItems = [];
  document.getElementById("cost-summary").classList.add("hidden");
  document.getElementById("cost-summary").replaceChildren();
  document.getElementById("status-filter-container").replaceChildren();
  document.getElementById("tag-filter-container").replaceChildren();
  setBatchButtonVisual(false);
  for (const id of [
    "addModal",
    "renewModal",
    "renewalHistoryModal",
    "importModal",
    "exportModal",
    "quarantineModal",
    "notifyModal",
    "ratesModal",
  ])
    hideDialog(id);
  document.getElementById("addForm").reset();
  for (const id of [
    "exportPassword",
    "importPassword",
    "importFile",
    "authCode",
  ])
    document.getElementById(id).value = "";
  document.getElementById("loginBtn").disabled = false;
  document.getElementById("loginBtn").innerHTML = LOGIN_BUTTON_LABEL;
  document.getElementById("sendCodeBtn").disabled = false;
  document.getElementById("sendCodeBtn").innerHTML = SEND_CODE_LABEL;
  updateSelectedCount();
  if (revoke && headers.Authorization !== "Bearer ") {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers,
      });
      if (!response.ok && response.status !== 401) throw new Error();
    } catch {
      alert(
        "本机已退出，但服务器会话注销失败。请检查网络；原会话将在到期后失效。",
      );
    }
  }
}

function debouncedFilter() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filterAndRender();
  }, 150);
}

function getCardStatus(sim, today = todayString()) {
  if (sim.archived) return "archived";
  if (sim.noRenewal) return "noRenewal";
  const days = daysBetween(today, sim.expireDate);
  const reminder = sim.reminderDays ?? 15;
  if (days <= reminder) return "danger";
  if (days <= reminder * 3) return "warning";
  return "safe";
}

function setStatusFilter(filter) {
  statusFilter = filter !== "all" && statusFilter === filter ? "all" : filter;
  filterAndRender();
}

function setTagFilter(tag) {
  tagFilter = tagFilter === tag ? "" : tag;
  filterAndRender();
}

// 根据当前搜索与筛选条件，计算下一次渲染的卡片。
function filteredEsims() {
  const query = (document.getElementById("searchInput").value || "")
    .trim()
    .toLowerCase();
  const today = todayString();
  return esimData.filter((sim) => {
    const status = getCardStatus(sim, today);
    if (statusFilter === "archived") {
      if (status !== "archived") return false;
    } else {
      if (status === "archived") return false;
      if (statusFilter === "safe" && !["safe", "noRenewal"].includes(status))
        return false;
      if (
        ["warning", "danger", "noRenewal"].includes(statusFilter) &&
        status !== statusFilter
      )
        return false;
    }
    if (tagFilter && !(sim.tags || []).includes(tagFilter)) return false;
    if (!query) return true;
    const name = (sim.name || "").toLowerCase();
    const number = (sim.number || "").toLowerCase();
    const account = (sim.account || "").toLowerCase();
    const remark = (sim.remark || "").toLowerCase();
    const tags = (sim.tags || []).join(" ").toLowerCase();
    const brand = (
      PHONE_CARDS.find((card) => card.id === sim.brandId)?.name || ""
    ).toLowerCase();
    return (
      name.includes(query) ||
      number.includes(query) ||
      brand.includes(query) ||
      account.includes(query) ||
      remark.includes(query) ||
      tags.includes(query)
    );
  });
}

function renderedCardBoxes() {
  return [...document.querySelectorAll("#esim-container .card-select-input")];
}

// Search input can change before the debounced render. Use what is on screen.
function visibleSelectedEsims() {
  const ids = new Set(
    renderedCardBoxes()
      .filter((box) => box.checked)
      .map((box) => box.dataset.selectId),
  );
  return esimData.filter((sim) => ids.has(sim.id));
}

function filterAndRender() {
  renderCards(filteredEsims());
}

function setSort(key) {
  if (currentSort.key === key) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort.key = key;
    currentSort.asc = true;
  }
  // 更新按钮 UI
  document.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.classList.remove("active");
    btn.querySelector(".sort-dir").textContent = "";
  });
  const activeBtn = document.getElementById("sort-" + key);
  if (activeBtn) {
    activeBtn.classList.add("active");
    activeBtn.querySelector(".sort-dir").textContent = currentSort.asc
      ? "↑"
      : "↓";
  }
  filterAndRender();
}

function sortEsims(esims) {
  return [...esims].sort((a, b) => {
    let cmp = 0;
    if (currentSort.key === "remainDays")
      cmp = (a.expireDate || "9999-12-31").localeCompare(
        b.expireDate || "9999-12-31",
      );
    if (currentSort.key === "name") cmp = a.name.localeCompare(b.name, "zh-CN");
    if (currentSort.key === "addTime") {
      if (!a.createdAt || !b.createdAt)
        return !a.createdAt && !b.createdAt ? 0 : !a.createdAt ? 1 : -1;
      cmp = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    }
    return currentSort.asc ? cmp : -cmp;
  });
}

function toggleBatchMode() {
  batchMode = !batchMode;
  selectedIds.clear();
  const container = document.getElementById("main-container");
  const bar = document.getElementById("batchBar");
  bar.hidden = !batchMode;

  if (batchMode) {
    container.classList.add("batch-mode");
    bar.classList.add("show");
  } else {
    container.classList.remove("batch-mode");
    bar.classList.remove("show");
  }
  setBatchButtonVisual(batchMode);
  updateSelectedCount();
  // 重新渲染以显示/隐藏复选框
  filterAndRender();
}

function toggleCardSelection(id, checkbox) {
  if (checkbox.checked) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
  }
  // 更新卡片样式
  const card = checkbox.closest(".glass-card");
  if (card) {
    card.classList.toggle("card-selected", checkbox.checked);
  }
  updateSelectedCount();
}

function toggleSelectAll(checked) {
  // 只增删当前显示的卡片，被搜索隐藏的选择保持不变
  for (const box of renderedCardBoxes()) {
    if (checked) selectedIds.add(box.dataset.selectId);
    else selectedIds.delete(box.dataset.selectId);
    box.checked = checked;
    box.closest(".glass-card")?.classList.toggle("card-selected", checked);
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  const boxes = renderedCardBoxes();
  const selected = boxes.filter((cb) => cb.checked).length;
  // 计数与批量操作范围一致：只统计当前可见的已选卡片
  document.getElementById("selectedCount").textContent = selected;
  const all = document.getElementById("selectAllCheckbox");
  all.checked = boxes.length > 0 && selected === boxes.length;
  all.indeterminate = selected > 0 && selected < boxes.length;
}

function batchRenew() {
  const visible = visibleSelectedEsims();
  if (!visible.length) return alert("请先选择要续期的卡片");
  const selected = visible.filter((s) => !s.noRenewal);
  if (!selected.length) return alert("选中的卡片均无需保号，无需续期");
  openBatchRenewModal(selected, visible);
}

async function batchDelete() {
  const ids = visibleSelectedEsims().map((s) => s.id);
  if (
    !ids.length ||
    !confirm("确定删除选中的 " + ids.length + " 张卡片？此操作不可撤销。")
  )
    return;
  try {
    await mutate(WORKER_API_URL + "/batch", "DELETE", { ids });
    ids.forEach((id) => selectedIds.delete(id));
    await fetchEsimData();
  } catch (e) {
    alert(e.message);
  }
}

async function fetchEsimData() {
  const generation = ++fetchGeneration;
  const container = document.getElementById("esim-container");
  try {
    const response = await apiRequest(WORKER_API_URL, {
      headers: getAuthHeaders(),
    });
    const cards = await response.json();
    if (
      generation !== fetchGeneration ||
      !sessionStorage.getItem("esim_auth_token")
    )
      return;
    esimData = cards;
    dataRevision = normalizeRevision(
      response.headers.get("X-Data-Revision") || response.headers.get("ETag"),
    );
    selectedIds = new Set(
      [...selectedIds].filter((id) => cards.some((card) => card.id === id)),
    );
    document.getElementById("login-container").classList.add("hidden");
    document.getElementById("main-container").classList.remove("hidden");
    filterAndRender();
    const statusResponse = await apiRequest(WORKER_API_URL + "/status", {
      headers: getAuthHeaders(),
    });
    const status = await statusResponse.json();
    if (generation !== fetchGeneration) return;
    const messages = [];
    if (status.quarantineCount)
      messages.push(status.quarantineCount + " 条旧记录需修正，原数据已保留。");
    if (status.pendingNotifications)
      messages.push(status.pendingNotifications + " 条提醒等待发送或重试。");
    if (status.failedNotifications)
      messages.push(
        status.failedNotifications + " 条提醒发送失败，请检查 Telegram 配置。",
      );
    document.getElementById("service-status").textContent = messages.join(" ");
    document
      .getElementById("quarantineBtn")
      .classList.toggle("hidden", !status.quarantineCount);
    document
      .getElementById("retryNotificationsBtn")
      .classList.toggle("hidden", !status.failedNotifications);
    notifyMode = status.notifyMode === "milestones" ? "milestones" : "daily";
    customExchangeRates =
      status.exchangeRates && typeof status.exchangeRates === "object"
        ? status.exchangeRates
        : {};
    renderCostSummary();
    setTelegramButtonsState(!!status.telegramButtons);
  } catch (e) {
    if (generation !== fetchGeneration) return;
    if (sessionStorage.getItem("esim_auth_token")) {
      document.getElementById("login-container").classList.add("hidden");
      document.getElementById("main-container").classList.remove("hidden");
      document.getElementById("service-status").textContent =
        e.message + "，可点击刷新重试。";
      if (!esimData.length) container.textContent = "暂时无法加载数据。";
    }
  }
}

function renderFilterBars() {
  const statusContainer = document.getElementById("status-filter-container");
  const tagContainer = document.getElementById("tag-filter-container");
  const today = todayString();
  const counts = {
    all: 0,
    safe: 0,
    warning: 0,
    danger: 0,
    noRenewal: 0,
    archived: 0,
  };
  const allTags = new Set();
  for (const sim of esimData) {
    const status = getCardStatus(sim, today);
    if (status === "archived") {
      counts.archived++;
    } else {
      counts.all++;
      if (status === "noRenewal") {
        counts.noRenewal++;
        counts.safe++;
      } else {
        counts[status]++;
      }
    }
    for (const tag of sim.tags || []) allTags.add(tag);
  }
  if (tagFilter && !allTags.has(tagFilter)) tagFilter = "";
  const pills = [
    { key: "all", label: `全部活跃 (${counts.all})`, dot: "bg-blue-500" },
    {
      key: "danger",
      label: `告警/过期 (${counts.danger})`,
      dot: "bg-rose-500",
    },
    {
      key: "warning",
      label: `建议关注 (${counts.warning})`,
      dot: "bg-amber-400",
    },
    { key: "safe", label: `安全 (${counts.safe})`, dot: "bg-emerald-500" },
    ...(counts.noRenewal
      ? [
          {
            key: "noRenewal",
            label: `无需保号 (${counts.noRenewal})`,
            dot: "bg-teal-500",
          },
        ]
      : []),
    ...(counts.archived
      ? [
          {
            key: "archived",
            label: `已归档 (${counts.archived})`,
            dot: "bg-slate-400",
          },
        ]
      : []),
  ];
  statusContainer.innerHTML = pills
    .map(
      (pill) =>
        `<button type="button" data-status-filter="${pill.key}" class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-semibold border transition-all tabular-nums ${
          statusFilter === pill.key
            ? "bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/20"
            : "bg-white dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 hover:text-blue-600 dark:hover:text-blue-300"
        }"><span class="w-1.5 h-1.5 rounded-full ${statusFilter === pill.key ? "bg-white" : pill.dot}"></span>${escapeHTML(pill.label)}</button>`,
    )
    .join("");
  if (allTags.size) {
    tagContainer.innerHTML = [...allTags]
      .sort((a, b) => a.localeCompare(b, "zh-CN"))
      .map(
        (tag) =>
          `<button type="button" data-tag-filter="${escapeHTML(tag)}" class="px-2.5 py-1 rounded-full font-semibold border transition-all ${
            tagFilter === tag
              ? "bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-600/20"
              : "bg-indigo-50/80 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200/70 dark:border-indigo-800/70 hover:bg-indigo-100 dark:hover:bg-indigo-900/70"
          }"># ${escapeHTML(tag)}</button>`,
      )
      .join("");
  } else {
    tagContainer.replaceChildren();
  }
}

function renderCostSummary() {
  const el = document.getElementById("cost-summary");
  const summary = summarizeCosts(esimData, {
    getCycleDays: cycleDays,
    rates: customExchangeRates,
  });
  if (!summary.annual.byCurrency.size && !summary.spent.byCurrency.size) {
    el.classList.add("hidden");
    el.replaceChildren();
    return;
  }
  const fmt = (bucket) => {
    const items = `<span class="font-mono font-semibold tabular-nums">${[
      ...bucket.byCurrency.entries(),
    ]
      .map(([cur, val]) => `${escapeHTML(cur)} ${Number(val.toFixed(2))}`)
      .join(" + ")}</span>`;
    if (bucket.totalCny === null) return items;
    const unmappedNote = bucket.unmapped.length
      ? `，未含 ${bucket.unmapped.map(escapeHTML).join("、")}`
      : "";
    return `${items} <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-100/80 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 font-semibold tabular-nums">折合 CNY ¥${bucket.totalCny}${unmappedNote}</span>`;
  };
  const parts = [];
  if (summary.annual.byCurrency.size)
    parts.push(
      `<span class="inline-flex flex-wrap items-center gap-1.5"><i class="fa-solid fa-coins text-amber-500"></i><strong class="text-slate-600 dark:text-slate-300">预估年保号成本：</strong>${fmt(summary.annual)}</span>`,
    );
  if (summary.spent.byCurrency.size)
    parts.push(
      `<span class="inline-flex flex-wrap items-center gap-1.5"><i class="fa-solid fa-receipt text-indigo-500 dark:text-indigo-400"></i><strong class="text-slate-600 dark:text-slate-300">已记录续期支出：</strong>${fmt(summary.spent)}</span>`,
    );
  parts.push(
    `<button type="button" data-open-rates class="ml-auto inline-flex items-center gap-1.5 bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-700 text-indigo-600 dark:text-indigo-300 font-semibold px-3 py-1.5 rounded-xl border border-slate-200/80 dark:border-slate-700 transition-colors shadow-sm"><i class="fa-solid fa-sliders"></i>汇率设置</button>`,
  );
  el.innerHTML = parts.join("");
  el.classList.remove("hidden");
}

function renderCards(esims) {
  const container = document.getElementById("esim-container");

  updateCurrentDate();
  renderStats();
  renderCostSummary();
  renderFilterBars();

  // Keep filtered-out cards reusable, but release deleted cards and old sessions.
  const liveIds = new Set(esimData.map((sim) => sim.id));
  for (const id of cardRenderCache.keys())
    if (!liveIds.has(id)) cardRenderCache.delete(id);

  const today = todayString();

  if (esims.length === 0) {
    container.innerHTML = `
      <div class="col-span-full text-center py-16 px-4 rounded-2xl border border-dashed border-slate-300/80 dark:border-slate-700 bg-white/40 dark:bg-slate-900/30">
        <div class="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center mx-auto mb-3 text-2xl">
          <i class="fa-solid fa-sim-card"></i>
        </div>
        <p class="text-slate-700 dark:text-slate-200 font-semibold text-sm">没有匹配的号码记录</p>
        <p class="text-slate-400 dark:text-slate-500 text-xs mt-1">尝试清除搜索关键词、切换筛选条件或点击右上角「添加号码」</p>
      </div>`;
    updateSelectedCount();
    return;
  }

  // 排序
  const sorted = sortEsims(esims);

  const cardNodes = [];

  sorted.forEach((sim) => {
    const noRenewal = sim.noRenewal === true;
    const archived = sim.archived === true;
    const trackExpiry = !noRenewal && !archived;
    const diffDays = trackExpiry ? daysBetween(today, sim.expireDate) : 0;
    const reminderDays = sim.reminderDays ?? 15;

    let accentBar = "from-emerald-400 to-teal-500";
    let statusColor = "bg-gradient-to-r from-emerald-400 to-teal-500";
    let statusText = "状态安全";
    let badgeClass =
      "bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/70";
    let icon = "fa-circle-check text-emerald-500";

    if (archived) {
      accentBar =
        "from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-700";
      statusColor = "bg-slate-400";
      statusText = "已归档";
      badgeClass =
        "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700";
      icon = "fa-box-archive text-slate-400";
    } else if (noRenewal) {
      accentBar = "from-teal-400 to-cyan-500";
      statusText = "无需保号";
      badgeClass =
        "bg-teal-50 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300 border-teal-200/80 dark:border-teal-800/70";
      icon = "fa-infinity text-teal-500";
    } else if (diffDays <= 0) {
      accentBar = "from-rose-600 to-red-700";
      statusColor = "bg-rose-600";
      statusText = diffDays === 0 ? "今日到期" : "已过期";
      badgeClass =
        "bg-rose-100 dark:bg-rose-950/90 text-rose-800 dark:text-rose-200 border-rose-300/80 dark:border-rose-800";
      icon = "fa-circle-exclamation text-rose-600 dark:text-rose-400";
    } else if (diffDays <= reminderDays) {
      accentBar = "from-rose-500 to-orange-500";
      statusColor = "bg-gradient-to-r from-rose-500 to-orange-500";
      statusText = "即将过期";
      badgeClass =
        "bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/70";
      icon = "fa-triangle-exclamation text-rose-500";
    } else if (diffDays <= reminderDays * 3) {
      accentBar = "from-amber-400 to-orange-400";
      statusColor = "bg-gradient-to-r from-amber-400 to-orange-400";
      statusText = "建议关注";
      badgeClass =
        "bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/70";
      icon = "fa-bell text-amber-500";
    }

    const percent = trackExpiry
      ? Math.min(Math.max((diffDays / cycleDays(sim)) * 100, 0), 100)
      : 0;
    const flagEmoji = getCountryFlag(sim.number);

    // 备注/保号规则区域
    const remarkHTML = sim.remark
      ? `<div class="bg-blue-50/55 dark:bg-blue-950/30 rounded-xl px-3 py-2 mb-3 text-xs text-slate-600 dark:text-slate-300 border border-blue-100/80 dark:border-blue-900/50 break-words leading-relaxed"><i class="fa-regular fa-comment-dots mr-1.5 text-blue-500 dark:text-sky-400"></i>${escapeHTML(sim.remark)}</div>`
      : "";

    const accountHTML = sim.account
      ? `<div class="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300 mb-2.5 bg-slate-50/80 dark:bg-slate-800/60 rounded-xl px-3 py-1.5 border border-slate-200/60 dark:border-slate-700/60"><span class="truncate"><i class="fa-regular fa-user mr-1.5 text-slate-400"></i>${escapeHTML(sim.account)}</span><button type="button" data-action="copy" data-copy-text="${escapeHTML(sim.account)}" class="text-slate-400 hover:text-blue-600 dark:hover:text-sky-400 flex-shrink-0 transition-colors" title="复制账号/载体"><i class="fa-regular fa-copy"></i></button></div>`
      : "";

    const metaChips = [];
    if (sim.balance)
      metaChips.push(
        `<span class="bg-emerald-50/90 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 px-2 py-0.5 rounded-md tabular-nums">余额: ${escapeHTML(sim.balance)}</span>`,
      );
    if (sim.renewCost != null)
      metaChips.push(
        `<span class="bg-indigo-50/90 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/60 px-2 py-0.5 rounded-md tabular-nums">每次: ${escapeHTML(sim.renewCost)}${sim.renewCurrency ? " " + escapeHTML(sim.renewCurrency) : ""}</span>`,
      );
    for (const tag of sim.tags || [])
      metaChips.push(
        `<span class="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/70 dark:border-slate-700 px-2 py-0.5 rounded-md"># ${escapeHTML(tag)}</span>`,
      );
    const metaHTML = metaChips.length
      ? `<div class="flex flex-wrap gap-1.5 mb-3 text-[11px] font-medium">${metaChips.join("")}</div>`
      : "";

    const renewalHistoryCount = Array.isArray(sim.renewalHistory)
      ? sim.renewalHistory.length
      : 0;
    const renewalHistoryCounter = renewalHistoryCount
      ? `<span class="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-violet-600 text-white text-[9px] font-bold flex items-center justify-center shadow-sm">${renewalHistoryCount}</span>`
      : "";

    // 自动延期、静音与自定义提醒天数微标签
    const statusSubBadges = [];
    if (!noRenewal && !archived && sim.autoRenew)
      statusSubBadges.push(
        '<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 whitespace-nowrap"><i class="fa-solid fa-arrows-rotate mr-0.5"></i>自动延期</span>',
      );
    if (!noRenewal && !archived && sim.muteReminders)
      statusSubBadges.push(
        '<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/60 whitespace-nowrap"><i class="fa-solid fa-bell-slash mr-0.5"></i>已静音</span>',
      );
    if (!noRenewal && reminderDays !== 15)
      statusSubBadges.push(
        `<span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50/90 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/60 whitespace-nowrap">提前${escapeHTML(reminderDays)}天提醒</span>`,
      );

    // 周期显示
    const cycleUnit = sim.cycleUnit || "day";
    const cycleLabel = noRenewal
      ? "无需保号"
      : sim.cycle
        ? sim.cycle + " " + getCycleUnitLabel(cycleUnit)
        : "-";
    const brand = PHONE_CARDS.find((card) => card.id === sim.brandId);
    const brandHTML = brand
      ? `<p class="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">${escapeHTML(brand.region)} · ${escapeHTML(brand.name)}</p>`
      : "";

    // 批量模式复选框
    const isSelected = selectedIds.has(sim.id);
    const checkboxHTML = `<div class="card-checkbox absolute top-5 left-4 z-20">
            <input type="checkbox" class="card-select-input w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" ${isSelected ? "checked" : ""} data-select-id="${escapeHTML(sim.id)}" aria-label="选择 ${escapeHTML(sim.name)}">
        </div>`;

    const timingHTML = noRenewal
      ? `<div class="flex items-center justify-between text-xs py-1">
           <span class="font-semibold text-teal-700 dark:text-teal-300"><i class="fa-solid fa-circle-check mr-1.5 text-teal-500"></i>无需设置保号期限</span>
           ${sim.startDate ? `<span class="text-slate-400 font-mono tabular-nums">启用: ${escapeHTML(sim.startDate)}</span>` : ""}
         </div>`
      : archived
        ? `<div class="flex items-center justify-between text-xs py-1 text-slate-500 dark:text-slate-400">
             <span><i class="fa-solid fa-box-archive mr-1.5 text-slate-400"></i>卡片已归档停用</span>
             <span class="font-mono tabular-nums">到期日: ${escapeHTML(sim.expireDate)}</span>
           </div>`
        : `<div class="flex justify-between items-baseline text-xs mb-1.5">
             <span class="text-slate-500 dark:text-slate-400 font-medium">剩余时间</span>
             <span class="font-mono text-sm font-bold tabular-nums ${diffDays <= reminderDays ? "text-rose-600 dark:text-rose-400" : "text-slate-900 dark:text-white"}">${diffDays < 0 ? "0" : diffDays} <span class="text-xs font-sans font-semibold">天</span></span>
           </div>
           <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 mb-2 overflow-hidden">
             <div class="${statusColor} h-2 rounded-full transition-all duration-700" style="width: ${percent}%"></div>
           </div>
           <div class="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 font-medium">
             <span><i class="fa-solid fa-arrows-rotate mr-1 text-slate-400"></i>周期: ${escapeHTML(cycleLabel)}</span>
             <span class="font-mono tabular-nums">到期日: ${escapeHTML(sim.expireDate)}</span>
           </div>`;

    const copyNumberBtn = sim.number
      ? `<button type="button" data-action="copy" data-copy-text="${escapeHTML(sim.number)}" class="text-slate-400 hover:text-blue-600 dark:hover:text-sky-400 flex-shrink-0 transition-colors ml-0.5" title="复制号码"><i class="fa-regular fa-copy text-xs"></i></button>`
      : "";

    const subBadgesHTML = statusSubBadges.length
      ? `<div class="flex flex-wrap gap-1.5 mb-2.5">${statusSubBadges.join("")}</div>`
      : "";

    const cardHTML = `
            <div class="glass-card rounded-2xl relative overflow-hidden group flex flex-col h-full ${isSelected ? "card-selected" : ""} ${archived ? "opacity-80" : ""}" data-id="${escapeHTML(sim.id)}">
                <div class="h-1 w-full bg-gradient-to-r ${accentBar}"></div>
                ${checkboxHTML}

                <div class="p-5 flex flex-col flex-1">
                    <!-- 顶部标题与状态胶囊 -->
                    <div class="flex items-start justify-between gap-2.5 mb-3 ${batchMode ? "pl-6" : ""}">
                        <div class="min-w-0 flex-1">
                            <h2 class="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate leading-snug" title="${escapeHTML(sim.name)}">${escapeHTML(sim.name)}</h2>
                            ${brandHTML}
                        </div>
                        <span class="px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap flex-shrink-0 inline-flex items-center gap-1 ${badgeClass}">
                            <i class="fa-solid ${icon}"></i>${statusText}
                        </span>
                    </div>

                    <!-- 号码胶囊栏 -->
                    <div class="mb-2.5">
                        <div class="inline-flex items-center gap-2 max-w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/70">
                            ${flagEmoji}
                            <span class="font-mono text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 truncate">${escapeHTML(sim.number || "未登记号码")}</span>
                            ${copyNumberBtn}
                        </div>
                    </div>

                    ${subBadgesHTML}
                    ${accountHTML}
                    ${metaHTML}
                    ${remarkHTML}

                    <!-- 底部进度与操作栏 -->
                    <div class="mt-auto pt-3 border-t border-slate-100 dark:border-slate-700/60">
                        ${timingHTML}
                        <div class="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between gap-2">
                            <div>
                                ${
                                  noRenewal
                                    ? '<span class="text-[11px] text-slate-400 dark:text-slate-500 font-medium">长期免保号卡片</span>'
                                    : `<button data-action="renew" data-card-id="${escapeHTML(sim.id)}" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/70 hover:bg-blue-600 dark:hover:bg-blue-600 text-blue-600 dark:text-sky-400 hover:text-white text-xs font-semibold transition-colors" title="续期">
                                        <i class="fa-solid fa-rotate-right text-[11px]"></i> 续期
                                    </button>`
                                }
                            </div>
                            <div class="flex items-center gap-1">
                                <button data-action="edit" data-card-id="${escapeHTML(sim.id)}" class="w-8 h-8 rounded-lg text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors" title="编辑卡片资料">
                                    <i class="fa-solid fa-pen text-xs"></i>
                                </button>
                                <button data-action="history" data-card-id="${escapeHTML(sim.id)}" class="relative w-8 h-8 rounded-lg text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/50 flex items-center justify-center transition-colors" title="查看续期记录（${renewalHistoryCount}）">
                                    <i class="fa-solid fa-clock-rotate-left text-xs"></i>
                                    ${renewalHistoryCounter}
                                </button>
                                <button data-action="delete" data-card-id="${escapeHTML(sim.id)}" class="w-8 h-8 rounded-lg text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 flex items-center justify-center transition-colors" title="删除号码">
                                    <i class="fa-solid fa-trash-can text-xs"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    let cached = cardRenderCache.get(sim.id);
    if (!cached || cached.html !== cardHTML) {
      const template = document.createElement("template");
      template.innerHTML = cardHTML;
      cached = { html: cardHTML, node: template.content.firstElementChild };
      cardRenderCache.set(sim.id, cached);
    }
    // Selection can change directly through a checkbox without rebuilding HTML.
    cached.node.classList.toggle("card-selected", isSelected);
    cached.node.querySelector(".card-select-input").checked = isSelected;
    cardNodes.push(cached.node);
  });

  // An unchanged filter result should not disturb focus or trigger layout again.
  if (
    container.children.length !== cardNodes.length ||
    cardNodes.some((node, index) => container.children[index] !== node)
  )
    container.replaceChildren(...cardNodes);

  updateSelectedCount();
}

async function submitForm(e) {
  e.preventDefault();
  const btn = document.getElementById("submitBtn");
  btn.disabled = true;
  btn.textContent = "保存中...";
  const tags = (document.getElementById("simTags").value || "")
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const renewCostRaw = document.getElementById("simRenewCost").value;
  const payload = {
    brandId: document.getElementById("simBrand").value,
    // Submit what the form shows: brand changes and the stored card both set it.
    noRenewal: formNoRenewal,
    archived: document.getElementById("simArchived").checked,
    muteReminders:
      document.getElementById("simMuteReminders").checked &&
      !document.getElementById("simMuteReminders").disabled,
    name: document.getElementById("simName").value,
    number: document.getElementById("simNumber").value,
    account: document.getElementById("simAccount").value,
    balance: document.getElementById("simBalance").value,
    renewCost: renewCostRaw === "" ? null : Number(renewCostRaw),
    renewCurrency: document.getElementById("simRenewCurrency").value.trim(),
    tags,
    startDate: document.getElementById("simStartDate").value || null,
    expireDate: document.getElementById("simExpire").value || null,
    cycle:
      document.getElementById("simCycle").value === ""
        ? null
        : Number(document.getElementById("simCycle").value),
    cycleUnit: document.getElementById("simCycleUnit").value,
    reminderDays:
      document.getElementById("simReminderDays").value === ""
        ? 15
        : Number(document.getElementById("simReminderDays").value),
    remark: document.getElementById("simRemark").value,
    autoRenew:
      document.getElementById("simAutoRenew").checked &&
      !document.getElementById("simAutoRenew").disabled,
    ...(editingId ? { id: editingId } : {}),
  };
  try {
    await mutate(
      WORKER_API_URL,
      editingId ? "PUT" : "POST",
      payload,
      editingId ? editingRevision : dataRevision,
    );
    closeModal();
    await fetchEsimData();
  } catch (e) {
    alert(e.message);
  } finally {
    btn.textContent = "保存并监控";
    btn.disabled = false;
  }
}

function previewRenewDate(base, cycle, unit) {
  try {
    return "新到期日：" + addCalendarCycle(base, cycle, unit);
  } catch (e) {
    return "无法计算新到期日：" + e.message;
  }
}

function openRenewModal(id) {
  const sim = esimData.find((s) => s.id === id);
  if (!sim) return;
  renewTarget = { ...sim, isBatch: false, revision: dataRevision };
  document.getElementById("renewSimInfo").textContent =
    sim.name + " | 周期: " + sim.cycle + " " + getCycleUnitLabel(sim.cycleUnit);
  document.getElementById("renewPreviewExpiry").textContent = previewRenewDate(
    sim.expireDate,
    sim.cycle,
    sim.cycleUnit,
  );
  document.getElementById("renewPreviewToday").textContent = previewRenewDate(
    todayString(),
    sim.cycle,
    sim.cycleUnit,
  );
  document.getElementById("renewBatchPreview").classList.add("hidden");
  document.getElementById("renewCostBox").classList.remove("hidden");
  document.getElementById("renewCostInput").value = sim.renewCost ?? "";
  document.getElementById("renewCurrencyInput").value = sim.renewCurrency || "";
  document.querySelector(
    'input[name="renewMode"][value="fromExpiry"]',
  ).checked = true;
  showDialog("renewModal");
}

function openBatchRenewModal(selected, visible) {
  renewTarget = {
    isBatch: true,
    cards: selected,
    ids: selected.map((s) => s.id),
    visibleIds: visible.map((s) => s.id),
    revision: dataRevision,
  };
  document.getElementById("renewSimInfo").textContent =
    `批量续期已选中的 ${selected.length} 张卡片`;
  document.getElementById("renewPreviewExpiry").textContent =
    "将按各卡原到期日顺延一个周期";
  document.getElementById("renewPreviewToday").textContent =
    "将按今天日期重新计算一个周期";
  document.getElementById("renewCostBox").classList.add("hidden");
  document.querySelector(
    'input[name="renewMode"][value="fromExpiry"]',
  ).checked = true;
  updateRenewPreview();
  showDialog("renewModal");
}

function updateRenewPreview() {
  if (!renewTarget?.isBatch) return;
  const mode = document.querySelector('input[name="renewMode"]:checked').value;
  const today = todayString();
  const box = document.getElementById("renewBatchPreview");
  box.innerHTML = renewTarget.cards
    .map((card) => {
      const base = mode === "fromExpiry" ? card.expireDate : today;
      let next;
      try {
        next = addCalendarCycle(base, card.cycle, card.cycleUnit);
      } catch (e) {
        next = e.message;
      }
      return `<div class="flex justify-between gap-2"><span class="font-semibold text-slate-700 dark:text-slate-200 truncate">${escapeHTML(card.name)}</span><span class="text-blue-600 dark:text-sky-400 font-mono tabular-nums flex-shrink-0">${escapeHTML(card.expireDate)} → ${escapeHTML(next)}</span></div>`;
    })
    .join("");
  box.classList.remove("hidden");
}

function closeRenewModal() {
  hideDialog("renewModal");
  renewTarget = null;
}

async function confirmRenew() {
  const target = renewTarget;
  if (!target) return;
  const generation = sessionGeneration;
  const mode = document.querySelector('input[name="renewMode"]:checked').value;
  const btn = document.getElementById("confirmRenewBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    if (target.isBatch) {
      await mutate(
        WORKER_API_URL + "/batch",
        "PUT",
        {
          ids: target.ids,
          renewMode: mode,
        },
        target.revision,
      );
    } else {
      const costRaw = document.getElementById("renewCostInput").value;
      const currency = document
        .getElementById("renewCurrencyInput")
        .value.trim();
      await mutate(
        WORKER_API_URL,
        "PUT",
        {
          id: target.id,
          renewMode: mode,
          ...(costRaw !== "" || target.renewCost != null
            ? {
                renewCost: costRaw === "" ? null : Number(costRaw),
                renewCurrency: currency,
              }
            : {}),
        },
        target.revision,
      );
    }
    if (generation !== sessionGeneration) return;
    if (target.isBatch)
      target.visibleIds.forEach((id) => selectedIds.delete(id));
    if (renewTarget === target) closeRenewModal();
    await fetchEsimData();
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

function formatRenewalTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function openRenewalHistory(id) {
  const sim = esimData.find((item) => item.id === id);
  if (!sim) return;
  renewalHistoryTarget = { id, revision: dataRevision };
  const history = Array.isArray(sim.renewalHistory)
    ? [...sim.renewalHistory].reverse()
    : [];
  const sourceLabels = {
    manual: "手动续期",
    batch: "批量续期",
    auto: "自动延期",
    telegram: "TG 按钮续期",
  };
  const modeLabels = {
    fromExpiry: "基于原到期日",
    fromToday: "基于续期当天",
  };
  document.getElementById("renewalHistoryTitle").textContent =
    sim.name + " · 续期记录";
  document.getElementById("renewalHistorySummary").textContent = history.length
    ? `共 ${history.length} 条续期记录，最多保留最近 20 条`
    : "尚无续期记录";
  document.getElementById("renewalHistoryList").innerHTML = history.length
    ? history
        .map(
          (record, index) => `
            <article class="relative pl-8 pb-5 last:pb-0">
              <span class="absolute left-1 top-1.5 w-3 h-3 rounded-full bg-violet-500 ring-4 ring-violet-100 dark:ring-violet-950"></span>
              <span class="absolute left-[9px] top-5 bottom-0 w-px bg-violet-100 dark:bg-violet-900/60 ${index === history.length - 1 ? "hidden" : ""}"></span>
              <div class="rounded-2xl border border-violet-100 dark:border-violet-900/60 bg-violet-50/50 dark:bg-violet-950/30 p-4">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                  <span class="text-xs font-bold text-violet-700 dark:text-violet-300 bg-white dark:bg-slate-800 border border-violet-100 dark:border-violet-800/70 rounded-full px-2.5 py-0.5">${escapeHTML(sourceLabels[record.source] || record.source)}</span>
                  <time class="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">${escapeHTML(formatRenewalTimestamp(record.renewedAt))}</time>
                </div>
                <div class="flex items-center gap-2 text-sm font-mono font-semibold text-slate-800 dark:text-slate-100 break-all tabular-nums">
                  <span>${escapeHTML(record.previousExpireDate)}</span>
                  <i class="fa-solid fa-arrow-right text-violet-400 text-xs"></i>
                  <span class="text-violet-700 dark:text-violet-300">${escapeHTML(record.newExpireDate)}</span>
                </div>
                <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">${escapeHTML(modeLabels[record.mode] || record.mode)} · 周期 ${escapeHTML(record.cycle)} ${escapeHTML(getCycleUnitLabel(record.cycleUnit))}${record.source !== "auto" && record.cost != null ? ` · 花费 ${escapeHTML(record.cost)}${record.currency ? " " + escapeHTML(record.currency) : ""}` : ""}</p>
                ${
                  index === 0 &&
                  !sim.noRenewal &&
                  sim.expireDate === record.newExpireDate
                    ? `<div class="mt-3 pt-2.5 border-t border-violet-100 dark:border-violet-900/50 flex justify-end"><button type="button" data-undo-renew="${escapeHTML(sim.id)}" class="text-xs font-semibold text-amber-700 dark:text-amber-300 hover:text-amber-900 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/70 px-3 py-1 rounded-lg border border-amber-200 dark:border-amber-800 transition-colors"><i class="fa-solid fa-rotate-left mr-1"></i>撤销此次续期</button></div>`
                    : ""
                }
              </div>
            </article>`,
        )
        .join("")
    : `<div class="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 px-4 py-10 text-center text-slate-500 dark:text-slate-400">
         <i class="fa-regular fa-clock text-3xl text-slate-300 dark:text-slate-600 mb-3"></i>
         <p class="font-semibold text-slate-700 dark:text-slate-200 text-sm">还没有续期记录</p>
         <p class="text-xs mt-1">完成手动、批量或自动续期后会显示在这里</p>
       </div>`;
  showDialog("renewalHistoryModal");
}

async function undoLastRenewal(id) {
  const target = renewalHistoryTarget;
  if (!target || target.id !== id) return;
  if (target.revision !== dataRevision)
    return alert("续期记录已更新，请关闭后重新打开。");
  if (!confirm("确定撤销最近一次续期并恢复原到期日？")) return;
  const generation = sessionGeneration;
  try {
    await mutate(
      WORKER_API_URL,
      "PUT",
      { id, undoRenew: true },
      target.revision,
    );
    if (generation !== sessionGeneration) return;
    if (renewalHistoryTarget === target) closeRenewalHistoryModal();
    await fetchEsimData();
  } catch (e) {
    if (renewalHistoryTarget === target) alert(e.message);
  }
}

function closeRenewalHistoryModal() {
  renewalHistoryTarget = null;
  hideDialog("renewalHistoryModal");
}
async function deleteEsim(id) {
  if (!confirm("确定删除这个号码记录？")) return;
  try {
    await mutate(WORKER_API_URL, "DELETE", { id });
    await fetchEsimData();
  } catch (e) {
    alert(e.message);
  }
}

function shouldUseInitialCycle(preset, cycle, unit, cycleWasEdited) {
  if (!preset?.initialCycle || cycleWasEdited) return false;
  if (cycle !== preset.cycle || unit !== preset.unit) return false;
  if (!editingId) return true;
  const editingCard = esimData.find((s) => s.id === editingId);
  if (!editingCard || editingCard.brandId !== preset.id) return true;
  if (editingCard.renewalHistory?.length) return false;
  if (editingCard.startDate && editingCard.expireDate) {
    try {
      return (
        editingCard.expireDate ===
        addCalendarCycle(
          editingCard.startDate,
          preset.initialCycle,
          preset.initialUnit,
        )
      );
    } catch {
      return false;
    }
  }
  return false;
}

function autoCalcExpireDate(trigger) {
  if (formNoRenewal) return;
  const cycle = Number(document.getElementById("simCycle").value);
  const unit = document.getElementById("simCycleUnit").value;
  const startInput = document.getElementById("simStartDate");
  const start = startInput.value;
  if (!start && !startInput.required) {
    document.getElementById("expireHint").textContent =
      "未填写开始日期，请手动核对或修改到期日。";
    return;
  }
  const preset = selectedPhoneCard();
  const cycleWasEdited = ["simCycle", "simCycleUnit"].includes(
    trigger?.target?.id,
  );
  const useInitial = shouldUseInitialCycle(preset, cycle, unit, cycleWasEdited);
  try {
    document.getElementById("simExpire").value = addCalendarCycle(
      start,
      useInitial ? preset.initialCycle : cycle,
      useInitial ? preset.initialUnit : unit,
    );
    document.getElementById("expireHint").textContent = useInitial
      ? "初始有效期按 4 年计算，后续按每年续期。"
      : "已按日历计算，月末取目标月最后一天。";
  } catch {
    document.getElementById("expireHint").textContent =
      "请填写有效的开始日期和正整数周期。";
  }
}

function selectedPhoneCard() {
  return PHONE_CARDS.find(
    (card) => card.id === document.getElementById("simBrand").value,
  );
}

function setNoRenewalFields(noRenewal) {
  formNoRenewal = noRenewal;
  for (const id of [
    "simCycleGroup",
    "simExpireGroup",
    "simReminderGroup",
    "simAutoRenewGroup",
    "simMuteGroup",
  ])
    document.getElementById(id).classList.toggle("hidden", noRenewal);
  document.getElementById("simCycle").required = !noRenewal;
  document.getElementById("simExpire").required = !noRenewal;
  document.getElementById("simAutoRenew").disabled = noRenewal;
  document.getElementById("simMuteReminders").disabled = noRenewal;
  if (noRenewal) {
    document.getElementById("simCycle").value = "";
    document.getElementById("simExpire").value = "";
    document.getElementById("simAutoRenew").checked = false;
    document.getElementById("simMuteReminders").checked = false;
  }
}

function updatePhoneCardHint() {
  const preset = selectedPhoneCard();
  const hint = document.getElementById("simBrandHint");
  const source = document.getElementById("simBrandSource");
  hint.textContent = preset
    ? preset.rule +
      (!preset.cycle && !preset.noRenewal ? " 请手动填写保号周期。" : "")
    : "选择后填入名称、保号周期和规则；可自行调整。";
  source.classList.toggle("hidden", !preset);
  if (preset) source.href = preset.sourceUrl;
  else source.removeAttribute("href");
  setNoRenewalFields(!!preset?.noRenewal);
}

function applyPhoneCardPreset() {
  const preset = selectedPhoneCard();
  document.getElementById("simBrandSearch").value = "";
  populatePhoneCards();
  const name = document.getElementById("simName");
  const previous = PHONE_CARDS.find(
    (card) => card.id === name.dataset.presetBrand,
  );
  if (preset && (!name.value || name.value === previous?.name))
    name.value = preset.name;
  name.dataset.presetBrand = preset?.id || "";
  updatePhoneCardHint();
  if (!preset) return;
  document.getElementById("simRemark").value = preset.rule;
  document.getElementById("simCycle").value = preset.cycle ?? "";
  document.getElementById("simCycleUnit").value = preset.unit || "day";
  document.getElementById("simExpire").value = "";
  document.getElementById("expireHint").textContent = "";
  if (preset.cycle) autoCalcExpireDate();
}

function normalizePhoneCardSearch(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function populatePhoneCards(
  query = "",
  preservedId = document.getElementById("simBrand").value,
) {
  const select = document.getElementById("simBrand");
  const selectedId = preservedId;
  const search = normalizePhoneCardSearch(query);
  const matches = PHONE_CARDS.filter((card) =>
    normalizePhoneCardSearch(card.region + card.name).includes(search),
  );
  const visibleCards = PHONE_CARDS.filter(
    (card) => matches.includes(card) || card.id === selectedId,
  );
  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent = "自定义 / 未列出";
  select.replaceChildren(custom);
  if (selectedId && !PHONE_CARDS.some((card) => card.id === selectedId)) {
    const saved = document.createElement("option");
    saved.value = selectedId;
    saved.textContent = `已保存品牌（${selectedId}）`;
    select.append(saved);
  }
  const groups = new Map();
  for (const card of visibleCards) {
    let group = groups.get(card.region);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = card.region;
      select.append(group);
      groups.set(card.region, group);
    }
    const option = document.createElement("option");
    option.value = card.id;
    option.textContent = card.name;
    option.dataset.noRenewal = String(!!card.noRenewal);
    group.append(option);
  }
  select.value = selectedId;
  const status = document.getElementById("simBrandSearchStatus");
  status.textContent = search
    ? matches.length
      ? `找到 ${matches.length} 个品牌${selectedId && !matches.some((card) => card.id === selectedId) ? "；当前已选品牌仍保留" : ""}`
      : "没有匹配的品牌；可选择“自定义 / 未列出”"
    : "";
}

function getTodayStr() {
  return todayString();
}

function setStartDateField(startDate, isNew = false) {
  const input = document.getElementById("simStartDate");
  input.required = isNew || !!startDate;
  input.value = startDate || (isNew ? getTodayStr() : "");
  document.getElementById("simStartDateLabel").textContent = input.required
    ? "开始日期 (必填)"
    : "开始日期 (选填)";
  document.getElementById("simStartDateHint").textContent = isNew
    ? "默认为今天，可自行修改"
    : input.required
      ? "可自行修改"
      : "旧记录未填写，可保留空白";
}

function openModal() {
  editingId = null;
  document.getElementById("modalTitle").innerHTML =
    '<i class="fa-solid fa-file-circle-plus text-blue-600"></i> 新增 eSIM';
  document.getElementById("addForm").reset();
  document.getElementById("simBrandSearch").value = "";
  populatePhoneCards();
  document.getElementById("simName").dataset.presetBrand = "";
  updatePhoneCardHint();
  setStartDateField(null, true);
  document.getElementById("simCycleUnit").value = "day";
  document.getElementById("simAutoRenew").checked = false;
  document.getElementById("simMuteReminders").checked = false;
  document.getElementById("simArchived").checked = false;
  document.getElementById("simReminderDays").value = "";
  document.getElementById("simAccount").value = "";
  document.getElementById("simTags").value = "";
  document.getElementById("simBalance").value = "";
  document.getElementById("simRenewCost").value = "";
  document.getElementById("simRenewCurrency").value = "";
  document.getElementById("expireHint").innerHTML = "";

  showDialog("addModal");
}

function openEditModal(id) {
  const sim = esimData.find((s) => s.id === id);
  if (!sim) return;

  editingId = id;
  editingRevision = dataRevision;
  document.getElementById("modalTitle").innerHTML =
    '<i class="fa-solid fa-pen-to-square text-green-600"></i> 编辑 eSIM';

  document.getElementById("simBrandSearch").value = "";
  populatePhoneCards("", sim.brandId || "");
  document.getElementById("simName").value = sim.name || "";
  document.getElementById("simBrand").value = sim.brandId || "";
  document.getElementById("simName").dataset.presetBrand = sim.brandId || "";
  updatePhoneCardHint();
  document.getElementById("simNumber").value = sim.number || "";
  document.getElementById("simAccount").value = sim.account || "";
  document.getElementById("simTags").value = (sim.tags || []).join(", ");
  document.getElementById("simBalance").value = sim.balance || "";
  document.getElementById("simRenewCost").value = sim.renewCost ?? "";
  document.getElementById("simRenewCurrency").value = sim.renewCurrency || "";
  setStartDateField(sim.startDate);
  document.getElementById("simCycle").value = sim.cycle ?? "";
  document.getElementById("simCycleUnit").value = sim.cycleUnit || "day";
  document.getElementById("simRemark").value = sim.remark || "";
  document.getElementById("simExpire").value = sim.expireDate || "";
  document.getElementById("simAutoRenew").checked = !!sim.autoRenew;
  document.getElementById("simMuteReminders").checked = !!sim.muteReminders;
  document.getElementById("simArchived").checked = !!sim.archived;
  document.getElementById("simReminderDays").value = sim.reminderDays ?? "";
  document.getElementById("expireHint").innerHTML = "";
  // The stored flag wins over the brand preset until the user picks a brand.
  setNoRenewalFields(!!sim.noRenewal);

  showDialog("addModal");
}

function closeModal() {
  hideDialog("addModal");
  editingId = null;
}

function openExportModal() {
  document.getElementById("exportPassword").value = "";
  toggleBackupMenu(false);
  showDialog("exportModal");
}

function closeExportModal() {
  hideDialog("exportModal");
  document.getElementById("exportPassword").value = "";
}

function setImportBusy(busy) {
  const btn = document.getElementById("importBtn");
  btn.disabled = busy;
  btn.innerHTML = busy
    ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i>导入中...'
    : IMPORT_BUTTON_LABEL;
}

function openImportModal() {
  importTarget = { revision: dataRevision };
  setImportBusy(false);
  document.getElementById("importFile").value = "";
  document.getElementById("importPassword").value = "";
  toggleBackupMenu(false);
  showDialog("importModal");
}

function closeImportModal() {
  importTarget = null;
  setImportBusy(false);
  hideDialog("importModal");
  document.getElementById("importPassword").value = "";
  document.getElementById("importFile").value = "";
}

function exportData() {
  if (!dataRevision) return alert("请先成功加载卡片列表，再导出备份。");
  const pwd = document.getElementById("exportPassword").value;
  if (!pwd) return alert("请输入加密密码！");

  const btn = document.getElementById("exportBtn");
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>处理中...';
  btn.disabled = true;

  try {
    const dataStr = JSON.stringify(esimData);
    const encrypted = CryptoJS.AES.encrypt(dataStr, pwd).toString();

    const exportObj = {
      version: "1.0",
      encrypted: true,
      data: encrypted,
    };
    const jsonStr = JSON.stringify(exportObj, null, 2);

    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const d = new Date();
    const dStr =
      d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0");
    a.download = "esim_backup_" + dStr + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    closeExportModal();
  } catch (e) {
    console.error(e);
    alert("导出失败：" + e.message);
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}

async function importData() {
  const target = importTarget;
  if (!target || document.getElementById("importBtn").disabled) return;
  if (!target.revision) return alert("请先成功加载卡片列表，再导入备份。");
  const generation = sessionGeneration;
  const fileInput = document.getElementById("importFile");
  const pwd = document.getElementById("importPassword").value;
  const mode = document.querySelector('input[name="importMode"]:checked').value;

  if (!fileInput.files || fileInput.files.length === 0)
    return alert("请选择备份文件！");
  if (!pwd) return alert("请输入解密密码！");

  setImportBusy(true);

  try {
    const file = fileInput.files[0];
    if (file.size > 12 * 1024 * 1024) throw new Error("备份文件超过 12 MB");
    const text = await file.text();
    // A closed or replaced dialog cannot submit its pending file.
    if (importTarget !== target) return;

    let importObj;
    try {
      importObj = JSON.parse(text);
    } catch (e) {
      throw new Error("无效的 JSON 备份文件！");
    }

    if (!importObj.encrypted || !importObj.data) {
      throw new Error("不是有效的加密备份文件！");
    }

    const encrypted = importObj.data;
    const bytes = CryptoJS.AES.decrypt(encrypted, pwd);
    const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
    if (!decryptedStr) throw new Error("密码错误，解密失败！");

    let parsed;
    try {
      parsed = JSON.parse(decryptedStr);
    } catch (e) {
      throw new Error("备份数据格式异常！");
    }

    if (!Array.isArray(parsed)) throw new Error("备份数据无效！");
    if (
      mode === "overwrite" &&
      !confirm(
        "将用备份中的 " +
          parsed.length +
          " 条记录替换当前 " +
          esimData.length +
          " 条记录，是否继续？",
      )
    )
      return;

    // 发送给后端
    await mutate(
      WORKER_API_URL + "/import",
      "POST",
      {
        mode,
        data: parsed,
      },
      target.revision,
    );

    if (generation !== sessionGeneration) return;
    if (importTarget === target) {
      alert("导入成功！");
      closeImportModal();
    }
    await fetchEsimData();
  } catch (e) {
    if (importTarget === target) {
      console.error(e);
      alert("错误: " + e.message);
    }
  } finally {
    if (importTarget === target) setImportBusy(false);
  }
}

function renderStats() {
  let safeCount = 0,
    warningCount = 0,
    dangerCount = 0;
  const today = todayString();
  for (const sim of esimData) {
    if (sim.archived) continue;
    if (sim.noRenewal) {
      safeCount++;
      continue;
    }
    const days = daysBetween(today, sim.expireDate);
    const reminder = sim.reminderDays ?? 15;
    if (days <= reminder) dangerCount++;
    else if (days <= reminder * 3) warningCount++;
    else safeCount++;
  }
  // 统计区域（基于全部活跃数据，而非过滤后的）
  const container = document.getElementById("stats-container");
  const counts = [safeCount, warningCount, dangerCount];
  const keys = ["safe", "warning", "danger"];
  const current = [...container.querySelectorAll(".text-3xl")];
  if (current.length === 3) {
    current.forEach((node, index) => {
      if (node.textContent !== String(counts[index]))
        node.textContent = String(counts[index]);
      const card = node.closest("[data-status-filter]");
      if (card) {
        const active = statusFilter === keys[index];
        card.classList.toggle("ring-2", active);
        card.classList.toggle("ring-blue-500", active);
      }
    });
    return;
  }
  container.innerHTML = `
        <div role="button" tabindex="0" data-status-filter="safe" class="glass-card cursor-pointer rounded-2xl p-4 sm:p-5 flex items-center justify-between relative overflow-hidden ${statusFilter === "safe" ? "ring-2 ring-blue-500" : ""}">
            <div class="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-emerald-400 to-teal-500"></div>
            <div class="pl-2">
                <p class="text-slate-500 dark:text-slate-400 text-xs font-bold tracking-wide">安全卡片</p>
                <p class="text-3xl font-extrabold text-slate-900 dark:text-white mt-1 tabular-nums">${safeCount}</p>
                <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">有效期充裕或免保号</p>
            </div>
            <div class="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 border border-emerald-200/70 dark:border-emerald-800/60 flex items-center justify-center flex-shrink-0">
                <i class="fa-solid fa-shield-halved text-lg"></i>
            </div>
        </div>
        <div role="button" tabindex="0" data-status-filter="warning" class="glass-card cursor-pointer rounded-2xl p-4 sm:p-5 flex items-center justify-between relative overflow-hidden ${statusFilter === "warning" ? "ring-2 ring-blue-500" : ""}">
            <div class="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-amber-400 to-orange-400"></div>
            <div class="pl-2">
                <p class="text-slate-500 dark:text-slate-400 text-xs font-bold tracking-wide">建议关注</p>
                <p class="text-3xl font-extrabold text-slate-900 dark:text-white mt-1 tabular-nums">${warningCount}</p>
                <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">临近提前关注窗口</p>
            </div>
            <div class="w-11 h-11 rounded-2xl bg-amber-50 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 border border-amber-200/70 dark:border-amber-800/60 flex items-center justify-center flex-shrink-0">
                <i class="fa-solid fa-clock text-lg"></i>
            </div>
        </div>
        <div role="button" tabindex="0" data-status-filter="danger" class="glass-card cursor-pointer rounded-2xl p-4 sm:p-5 flex items-center justify-between relative overflow-hidden ${statusFilter === "danger" ? "ring-2 ring-blue-500" : ""}">
            <div class="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-rose-500 to-red-600"></div>
            <div class="pl-2">
                <p class="text-slate-500 dark:text-slate-400 text-xs font-bold tracking-wide">告警 / 过期</p>
                <p class="text-3xl font-extrabold text-slate-900 dark:text-white mt-1 tabular-nums">${dangerCount}</p>
                <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">需尽快完成保号续期</p>
            </div>
            <div class="w-11 h-11 rounded-2xl bg-rose-50 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 border border-rose-200/70 dark:border-rose-800/60 flex items-center justify-center flex-shrink-0">
                <i class="fa-solid fa-triangle-exclamation text-lg"></i>
            </div>
        </div>
    `;
}
const dialogFocus = new Map();
function showDialog(id) {
  dialogFocus.set(id, document.activeElement);
  const modal = document.getElementById(id);
  modal.classList.remove("hidden");
  modal.firstElementChild.classList.remove("scale-95", "opacity-0");
  modal.firstElementChild.classList.add("scale-100", "opacity-100");
  document.body.style.overflow = "hidden";
  for (const background of ["login-container", "main-container", "batchBar"])
    document.getElementById(background).inert = true;
  modal.querySelector("input,button,select,textarea")?.focus();
}
function hideDialog(id) {
  document.getElementById(id).classList.add("hidden");
  if (!document.querySelector('[role="dialog"]:not(.hidden)')) {
    document.body.style.overflow = "";
    for (const background of ["login-container", "main-container", "batchBar"])
      document.getElementById(background).inert = false;
  }
  const target = dialogFocus.get(id);
  if (target?.isConnected && !target.closest(".hidden")) target.focus();
  dialogFocus.delete(id);
}
function toggleBackupMenu(force) {
  const button = document.getElementById("backupMenuBtn");
  const open = force ?? button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(open));
  document.getElementById("backupMenu").classList.toggle("hidden", !open);
}
async function downloadQuarantine() {
  try {
    const response = await apiRequest(WORKER_API_URL + "/quarantine", {
      headers: getAuthHeaders(),
    });
    const blob = new Blob([JSON.stringify(await response.json(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "esim-records-to-repair.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    alert(e.message);
  }
}
async function retryNotifications() {
  try {
    await mutate(WORKER_API_URL + "/notifications/retry", "POST", {});
    await fetchEsimData();
  } catch (e) {
    alert(e.message);
  }
}
function setTelegramButtonsState(enabled) {
  telegramButtonsEnabled = enabled;
  document.getElementById("telegramButtonsBtn").classList.remove("hidden");
  const dot = document.getElementById("telegramButtonsDot");
  if (dot) {
    dot.className = enabled
      ? "w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50"
      : "w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600";
  }
  document.getElementById("telegramButtonsLabel").textContent = enabled
    ? "关闭 TG 按钮续期"
    : "启用 TG 按钮续期";
}
async function openQuarantineModal() {
  try {
    const response = await apiRequest(WORKER_API_URL + "/quarantine", {
      headers: getAuthHeaders(),
    });
    quarantineItems = await response.json();
    const list = document.getElementById("quarantineList");
    list.innerHTML = quarantineItems.length
      ? quarantineItems
          .map(
            (item, idx) => `
          <div class="rounded-2xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/50 dark:bg-amber-950/30 p-3.5 text-xs">
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="font-bold text-amber-800 dark:text-amber-300">第 ${escapeHTML(item.index ?? idx + 1)} 条 · ${escapeHTML(item.error)}</span>
              ${
                item.raw && typeof item.raw === "object"
                  ? `<button type="button" data-repair-quarantine="${idx}" class="bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded-lg font-semibold transition-colors">填入表单修复</button>`
                  : ""
              }
            </div>
            <pre class="overflow-x-auto bg-white/90 dark:bg-slate-900/80 rounded-xl p-2.5 text-[11px] font-mono text-slate-700 dark:text-slate-300 border border-amber-100 dark:border-slate-800">${escapeHTML(JSON.stringify(item.raw, null, 2))}</pre>
          </div>`,
          )
          .join("")
      : '<p class="text-sm text-slate-500 dark:text-slate-400 text-center py-6">当前没有待修正记录</p>';
    showDialog("quarantineModal");
  } catch (e) {
    alert(e.message);
  }
}

function closeQuarantineModal() {
  hideDialog("quarantineModal");
}

function repairQuarantineItem(idx) {
  const item = quarantineItems[idx];
  if (!item?.raw || typeof item.raw !== "object") return;
  const raw = item.raw;
  closeQuarantineModal();
  openModal();
  if (typeof raw.name === "string")
    document.getElementById("simName").value = raw.name;
  if (typeof raw.number === "string")
    document.getElementById("simNumber").value = raw.number;
  if (typeof raw.remark === "string")
    document.getElementById("simRemark").value = raw.remark;
  if (typeof raw.account === "string")
    document.getElementById("simAccount").value = raw.account;
  if (
    typeof raw.startDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate)
  )
    document.getElementById("simStartDate").value = raw.startDate;
  if (
    typeof raw.expireDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.expireDate)
  )
    document.getElementById("simExpire").value = raw.expireDate;
  if (raw.cycle != null && /^\d+$/.test(String(raw.cycle)))
    document.getElementById("simCycle").value = String(raw.cycle);
  if (["day", "month", "quarter", "year"].includes(raw.cycleUnit))
    document.getElementById("simCycleUnit").value = raw.cycleUnit;
}

async function clearQuarantine() {
  if (!confirm("确定清空所有待修正记录提示？请确认已完成备份下载或重新录入。"))
    return;
  try {
    await mutate(WORKER_API_URL + "/quarantine", "DELETE", {});
    quarantineItems = [];
    closeQuarantineModal();
    await fetchEsimData();
  } catch (e) {
    alert(e.message);
  }
}

function openNotifyModal() {
  const input = document.querySelector(
    `input[name="notifyMode"][value="${notifyMode}"]`,
  );
  if (input) input.checked = true;
  showDialog("notifyModal");
}

function closeNotifyModal() {
  hideDialog("notifyModal");
}

async function saveNotifySettings() {
  const selected =
    document.querySelector('input[name="notifyMode"]:checked')?.value ||
    "daily";
  try {
    await mutate(WORKER_API_URL + "/settings", "PUT", {
      notifyMode: selected,
    });
    notifyMode = selected;
    alert("通知频率设置已保存");
    closeNotifyModal();
  } catch (e) {
    alert(e.message);
  }
}

async function sendTelegramTest(mode = "test") {
  try {
    await mutate("/api/telegram/test", "POST", { mode });
    alert(
      mode === "summary"
        ? "已向 Telegram 发送到期汇总"
        : "测试消息已发送，请检查 Telegram",
    );
  } catch (e) {
    alert(e.message);
  }
}

let editingRatesDraft = {};

function openRatesModal() {
  const effective = resolveCnyRates(customExchangeRates);
  const used = new Set(["USD", "HKD", "GBP", "EUR", "JPY"]);
  for (const sim of esimData) {
    if (sim.renewCurrency) used.add(sim.renewCurrency.toUpperCase());
    for (const rec of sim.renewalHistory || []) {
      if (rec.currency) used.add(rec.currency.toUpperCase());
    }
  }
  for (const code of Object.keys(customExchangeRates || {})) used.add(code);
  used.delete("CNY");
  used.delete("RMB");
  editingRatesDraft = {};
  for (const code of [...used].sort()) {
    if (effective[code]) editingRatesDraft[code] = effective[code];
  }
  renderRatesEditor();
  document.getElementById("newRateCode").value = "";
  document.getElementById("newRateValue").value = "";
  showDialog("ratesModal");
}

function closeRatesModal() {
  hideDialog("ratesModal");
}

function renderRatesEditor() {
  const container = document.getElementById("ratesList");
  const entries = Object.entries(editingRatesDraft).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  container.innerHTML = entries
    .map(
      ([code, val]) => `
      <div class="flex items-center gap-2 text-xs bg-slate-50/80 dark:bg-slate-800/50 px-3 py-1.5 rounded-xl border border-slate-200/70 dark:border-slate-700/70">
        <span class="w-14 font-mono font-bold text-slate-700 dark:text-slate-200">${escapeHTML(code)}</span>
        <span class="text-slate-400">1 ${escapeHTML(code)} =</span>
        <input type="number" min="0.000001" max="100000" step="any" data-rate-code="${escapeHTML(code)}" value="${escapeHTML(val)}" aria-label="${escapeHTML(code)} 汇率" class="input-field min-w-0 flex-1 px-2.5 py-1 rounded-lg font-mono text-slate-900 dark:text-white" />
        <span class="text-slate-500 dark:text-slate-400 font-mono">CNY</span>
      </div>`,
    )
    .join("");
}

function collectRatesDraftInputs() {
  for (const input of document.querySelectorAll(
    "#ratesList [data-rate-code]",
  )) {
    const val = Number(input.value);
    if (Number.isFinite(val) && val > 0)
      editingRatesDraft[input.dataset.rateCode] = val;
  }
}

function addRateRow() {
  collectRatesDraftInputs();
  const code = (document.getElementById("newRateCode").value || "")
    .trim()
    .toUpperCase();
  const val = Number(document.getElementById("newRateValue").value);
  if (!/^[A-Z0-9]{1,10}$/.test(code))
    return alert("请输入 1–10 位字母或数字的币种代码");
  if (!Number.isFinite(val) || val <= 0 || val > 100000)
    return alert("请输入大于 0 的有效汇率数字");
  editingRatesDraft[code] = val;
  document.getElementById("newRateCode").value = "";
  document.getElementById("newRateValue").value = "";
  renderRatesEditor();
}

function resetDefaultRates() {
  for (const code of Object.keys(editingRatesDraft)) {
    if (DEFAULT_CNY_RATES[code])
      editingRatesDraft[code] = DEFAULT_CNY_RATES[code];
    else delete editingRatesDraft[code];
  }
  renderRatesEditor();
}

async function saveRatesSettings() {
  collectRatesDraftInputs();
  const overrides = {};
  for (const [code, val] of Object.entries(editingRatesDraft)) {
    if (!Number.isFinite(val) || val <= 0 || val > 100000)
      return alert(`${code} 汇率无效`);
    if (DEFAULT_CNY_RATES[code] !== val) overrides[code] = val;
  }
  try {
    const response = await mutate(WORKER_API_URL + "/settings", "PUT", {
      exchangeRates: overrides,
    });
    const data = await response.json();
    customExchangeRates = data.exchangeRates || overrides;
    renderCostSummary();
    closeRatesModal();
  } catch (e) {
    alert(e.message);
  }
}

async function copyCardText(text, button) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    const icon = button.querySelector("i");
    if (icon) {
      icon.className = "fa-solid fa-check text-green-600";
      setTimeout(() => {
        icon.className = "fa-regular fa-copy";
      }, 1200);
    }
  } catch {
    alert("复制失败，请手动复制");
  }
}

async function toggleTelegramButtons() {
  const enable = !telegramButtonsEnabled;
  const question = enable
    ? "启用后，Telegram 提醒消息下会显示「从到期日续期」「从今天续期」按钮，点击即可在看板中续期。\n\n启用会为机器人设置 Webhook，此后无法再用 getUpdates 查询 Chat ID。是否继续？"
    : "关闭后，之后的提醒消息不再带续期按钮，已发出的按钮也会失效。是否继续？";
  if (!confirm(question)) return;
  try {
    await mutate("/api/telegram/buttons", "POST", { enabled: enable });
    setTelegramButtonsState(enable);
    alert(enable ? "已启用 TG 按钮续期" : "已关闭 TG 按钮续期");
  } catch (e) {
    alert(e.message);
  }
}
populatePhoneCards();
document.getElementById("simBrandSearch").addEventListener("input", (event) => {
  populatePhoneCards(event.target.value);
});
document
  .getElementById("simBrandSearch")
  .addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("simBrand").focus();
    }
  });
document
  .getElementById("simBrand")
  .addEventListener("change", applyPhoneCardPreset);
document.getElementById("esim-container").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "copy") {
    copyCardText(button.dataset.copyText || "", button);
    return;
  }
  const actions = {
    edit: openEditModal,
    renew: openRenewModal,
    history: openRenewalHistory,
    delete: deleteEsim,
  };
  actions[button.dataset.action]?.(button.dataset.cardId);
});
document
  .getElementById("renewalHistoryList")
  .addEventListener("click", (event) => {
    const button = event.target.closest("[data-undo-renew]");
    if (button) undoLastRenewal(button.dataset.undoRenew);
  });
document.getElementById("quarantineList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-repair-quarantine]");
  if (button) repairQuarantineItem(Number(button.dataset.repairQuarantine));
});
document
  .getElementById("stats-container")
  .addEventListener("click", (event) => {
    const card = event.target.closest("[data-status-filter]");
    if (card) setStatusFilter(card.dataset.statusFilter);
  });
document
  .getElementById("stats-container")
  .addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      const card = event.target.closest("[data-status-filter]");
      if (card) {
        event.preventDefault();
        setStatusFilter(card.dataset.statusFilter);
      }
    }
  });
document.getElementById("filter-bar").addEventListener("click", (event) => {
  const statusBtn = event.target.closest("[data-status-filter]");
  if (statusBtn) setStatusFilter(statusBtn.dataset.statusFilter);
  const tagBtn = event.target.closest("[data-tag-filter]");
  if (tagBtn) setTagFilter(tagBtn.dataset.tagFilter);
});
document.getElementById("cost-summary").addEventListener("click", (event) => {
  if (event.target.closest("[data-open-rates]")) openRatesModal();
});
document
  .getElementById("esim-container")
  .addEventListener("change", (event) => {
    if (event.target.matches("[data-select-id]"))
      toggleCardSelection(event.target.dataset.selectId, event.target);
  });
document.getElementById("authCode").addEventListener("keydown", (event) => {
  if (event.key === "Enter") verifyCode();
});
document.addEventListener("click", (event) => {
  if (!event.target.closest("#backupControls")) toggleBackupMenu(false);
});
document.addEventListener("keydown", (event) => {
  const modal = document.querySelector('[role="dialog"]:not(.hidden)');
  if (event.key === "Escape") {
    if (modal) {
      const closers = {
        addModal: closeModal,
        renewModal: closeRenewModal,
        renewalHistoryModal: closeRenewalHistoryModal,
        importModal: closeImportModal,
        exportModal: closeExportModal,
        quarantineModal: closeQuarantineModal,
        notifyModal: closeNotifyModal,
        ratesModal: closeRatesModal,
      };
      closers[modal.id]();
    } else if (
      document.getElementById("backupMenuBtn").getAttribute("aria-expanded") ===
      "true"
    ) {
      toggleBackupMenu(false);
      document.getElementById("backupMenuBtn").focus();
    }
  }
  if (event.key === "Tab" && modal) {
    const items = [
      ...modal.querySelectorAll('button,input,select,textarea,[tabindex="0"]'),
    ].filter(
      (el) => !el.disabled && el.type !== "hidden" && !el.closest(".hidden"),
    );
    const first = items[0],
      last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
});
