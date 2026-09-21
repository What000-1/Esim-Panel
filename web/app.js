// API 路由前缀
const WORKER_API_URL = "/api/esims";
let esimData = [];
let dataRevision = null;
let fetchGeneration = 0;
let sessionGeneration = 0;
let mutationBusy = false;
let editingRevision = null;
let importRevision = null;
let countdownInterval;
let editingId = null;
let batchMode = false;
let selectedIds = new Set();
let currentSort = { key: "remainDays", asc: true };
let searchTimer = null;
const cardRenderCache = new Map();
let renewTarget = null; // { id, cycle, cycleUnit, expireDate, name } - 当前续期目标

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

document.getElementById("current-date").innerText =
  todayString() + "（北京时间）";

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
          btn.innerHTML =
            '<i class="fa-brands fa-telegram text-xl mr-2"></i> 向 TG 机器人获取验证码';
        } else {
          btn.innerHTML = `<i class="fa-solid fa-clock mr-2"></i> ${timeLeft} 秒后可重发`;
        }
      }, 1000);
    } else {
      alert("发送失败: " + (data.message || "后端未配置机器人信息"));
      btn.disabled = false;
      btn.innerHTML =
        '<i class="fa-brands fa-telegram text-xl mr-2"></i> 向 TG 机器人获取验证码';
    }
  } catch (e) {
    if (generation !== sessionGeneration) return;
    alert("网络错误，发送失败");
    btn.disabled = false;
    btn.innerHTML =
      '<i class="fa-brands fa-telegram text-xl mr-2"></i> 向 TG 机器人获取验证码';
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
    btn.textContent = "登录面板";
  }
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
  document
    .getElementById("batchModeBtn")
    .classList.remove("bg-blue-100", "border-blue-300", "text-blue-700");
  document
    .getElementById("batchModeBtn")
    .classList.add("bg-white/60", "text-gray-700", "border-gray-200/50");
  for (const id of [
    "addModal",
    "renewModal",
    "renewalHistoryModal",
    "importModal",
    "exportModal",
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
  document.getElementById("loginBtn").textContent = "登录面板";
  document.getElementById("sendCodeBtn").disabled = false;
  document.getElementById("sendCodeBtn").textContent = "向 TG 机器人获取验证码";
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

function filterAndRender() {
  const query = (document.getElementById("searchInput").value || "")
    .trim()
    .toLowerCase();
  let filtered = esimData;
  if (query) {
    filtered = esimData.filter((sim) => {
      const name = (sim.name || "").toLowerCase();
      const number = (sim.number || "").toLowerCase();
      return name.includes(query) || number.includes(query);
    });
  }
  renderCards(filtered);
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
      cmp = a.expireDate.localeCompare(b.expireDate);
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
  const btn = document.getElementById("batchModeBtn");

  if (batchMode) {
    container.classList.add("batch-mode");
    bar.classList.add("show");
    btn.classList.add("bg-blue-100", "border-blue-300", "text-blue-700");
    btn.classList.remove("bg-white/60", "text-gray-700", "border-gray-200/50");
  } else {
    container.classList.remove("batch-mode");
    bar.classList.remove("show");
    btn.classList.remove("bg-blue-100", "border-blue-300", "text-blue-700");
    btn.classList.add("bg-white/60", "text-gray-700", "border-gray-200/50");
  }
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
  // 获取当前显示的卡片
  const query = (document.getElementById("searchInput").value || "")
    .trim()
    .toLowerCase();
  let filtered = esimData;
  if (query) {
    filtered = esimData.filter((sim) => {
      const name = (sim.name || "").toLowerCase();
      const number = (sim.number || "").toLowerCase();
      return name.includes(query) || number.includes(query);
    });
  }
  if (checked) {
    filtered.forEach((sim) => selectedIds.add(sim.id));
  } else {
    selectedIds.clear();
  }
  // 更新所有复选框
  document.querySelectorAll(".card-select-input").forEach((cb) => {
    cb.checked = checked;
    const card = cb.closest(".glass-card");
    if (card) card.classList.toggle("card-selected", checked);
  });
  updateSelectedCount();
}

function updateSelectedCount() {
  document.getElementById("selectedCount").textContent = selectedIds.size;
  const boxes = [...document.querySelectorAll(".card-select-input")];
  const selected = boxes.filter((cb) => cb.checked).length;
  const all = document.getElementById("selectAllCheckbox");
  all.checked = boxes.length > 0 && selected === boxes.length;
  all.indeterminate = selected > 0 && selected < boxes.length;
}

async function batchRenew() {
  if (selectedIds.size === 0) return alert("请先选择要续期的卡片");
  const selected = esimData.filter((s) => selectedIds.has(s.id));
  const mode = await showBatchRenewDialog(selected);
  if (!mode) return;
  try {
    await mutate(WORKER_API_URL + "/batch", "PUT", {
      ids: selected.map((s) => s.id),
      renewMode: mode,
    });
    selectedIds.clear();
    await fetchEsimData();
  } catch (e) {
    alert(e.message);
  }
}

function showBatchRenewDialog(selected) {
  return new Promise((resolve) => {
    const msg = `选中 ${selected.length} 张卡片，请选择续期方式：\n\n1. 基于到期日（推荐）：到期日 + 周期\n2. 基于今天：今天 + 周期`;
    const choice = prompt(msg + "\n\n请输入 1 或 2：", "1");
    if (choice === "1") resolve("fromExpiry");
    else if (choice === "2") resolve("fromToday");
    else resolve(null);
  });
}

async function batchDelete() {
  if (
    !selectedIds.size ||
    !confirm("确定删除选中的 " + selectedIds.size + " 张卡片？此操作不可撤销。")
  )
    return;
  try {
    await mutate(WORKER_API_URL + "/batch", "DELETE", {
      ids: [...selectedIds],
    });
    selectedIds.clear();
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

function renderCards(esims) {
  const container = document.getElementById("esim-container");

  renderStats();

  // Keep filtered-out cards reusable, but release deleted cards and old sessions.
  const liveIds = new Set(esimData.map((sim) => sim.id));
  for (const id of cardRenderCache.keys())
    if (!liveIds.has(id)) cardRenderCache.delete(id);

  const today = todayString();

  if (esims.length === 0) {
    container.innerHTML = `<div class="col-span-full text-center py-16 text-gray-500"><i class="fa-solid fa-box-open text-4xl mb-3"></i><p>没有匹配的号码记录</p></div>`;
    updateSelectedCount();
    return;
  }

  // 排序
  const sorted = sortEsims(esims);

  const cardNodes = [];

  sorted.forEach((sim) => {
    const diffDays = daysBetween(today, sim.expireDate);
    const reminderDays = sim.reminderDays ?? 15;

    let statusColor = "bg-green-500";
    let statusText = "状态安全";
    let badgeClass = "bg-green-100 text-green-800";
    let icon = "fa-check-circle text-green-500";

    if (diffDays <= 0) {
      statusColor = "bg-gray-500";
      statusText = diffDays === 0 ? "今日到期" : "已过期";
      badgeClass = "bg-gray-100 text-gray-800";
      icon = "fa-times-circle text-gray-500";
    } else if (diffDays <= reminderDays) {
      statusColor = "bg-red-500";
      statusText = "即将过期";
      badgeClass = "bg-red-100 text-red-800";
      icon = "fa-triangle-exclamation text-red-500";
    } else if (diffDays <= reminderDays * 3) {
      statusColor = "bg-yellow-400";
      statusText = "建议关注";
      badgeClass = "bg-yellow-100 text-yellow-800";
      icon = "fa-bell text-yellow-500";
    } else {
    }

    let percent = Math.min(Math.max((diffDays / cycleDays(sim)) * 100, 0), 100);
    const flagEmoji = getCountryFlag(sim.number);

    // 渲染备注区域
    const remarkHTML = sim.remark
      ? `<div class="bg-blue-50/60 rounded-lg p-2.5 mb-4 text-xs text-gray-700 border border-blue-100/60 break-words leading-relaxed"><i class="fa-regular fa-comment-dots mr-1.5 text-blue-400"></i>${escapeHTML(sim.remark)}</div>`
      : "";

    const renewalHistoryCount = Array.isArray(sim.renewalHistory)
      ? sim.renewalHistory.length
      : 0;
    const renewalHistoryCounter = renewalHistoryCount
      ? `<span class="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-violet-600 text-white text-[9px] font-bold flex items-center justify-center">${renewalHistoryCount}</span>`
      : "";

    // 自动延期标签
    const autoRenewBadge = sim.autoRenew
      ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 whitespace-nowrap flex-shrink-0"><i class="fa-solid fa-arrows-rotate mr-0.5"></i>自动延期</span>'
      : "";

    // 周期显示
    const cycleUnit = sim.cycleUnit || "day";
    const cycleLabel = sim.cycle
      ? sim.cycle + " " + getCycleUnitLabel(cycleUnit)
      : "-";

    // 提醒天数标签
    const reminderLabel =
      reminderDays !== 15
        ? `<span class="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold border border-amber-100/60">提前${escapeHTML(reminderDays)}天提醒</span>`
        : "";

    // 批量模式复选框
    const isSelected = selectedIds.has(sim.id);
    const checkboxHTML = `<div class="card-checkbox absolute top-4 left-4 z-20">
            <input type="checkbox" class="card-select-input w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" ${isSelected ? "checked" : ""} data-select-id="${escapeHTML(sim.id)}" aria-label="选择 ${escapeHTML(sim.name)}">
        </div>`;

    const cardHTML = `
            <div class="glass-card rounded-2xl p-6 relative overflow-hidden group flex flex-col h-full ${isSelected ? "card-selected" : ""}" data-id="${escapeHTML(sim.id)}">
                ${checkboxHTML}

                <!-- 操作按钮组 -->
                <div class="absolute top-4 right-4 flex gap-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity duration-150 z-20 bg-white p-1.5 rounded-full border border-white/60 shadow-sm">
                    <button data-action="edit" data-card-id="${escapeHTML(sim.id)}" class="text-green-600 hover:text-white hover:bg-green-500 bg-white w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-sm" title="编辑卡片资料">
                        <i class="fa-solid fa-pen text-sm"></i>
                    </button>
                    <button data-action="renew" data-card-id="${escapeHTML(sim.id)}" class="text-blue-600 hover:text-white hover:bg-blue-500 bg-white w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-sm" title="续期">
                        <i class="fa-solid fa-rotate-right text-sm"></i>
                    </button>
                    <button data-action="history" data-card-id="${escapeHTML(sim.id)}" class="relative text-violet-600 hover:text-white hover:bg-violet-500 bg-white w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-sm" title="查看续期记录（${renewalHistoryCount}）">
                        <i class="fa-solid fa-clock-rotate-left text-sm"></i>
                        ${renewalHistoryCounter}
                    </button>
                    <button data-action="delete" data-card-id="${escapeHTML(sim.id)}" class="text-red-500 hover:text-white hover:bg-red-500 bg-white w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-sm" title="删除号码">
                        <i class="fa-solid fa-trash-can text-sm"></i>
                    </button>
                </div>

                <!-- 标题区域 -->
                <div class="pr-40 mb-3 ${batchMode ? "pl-8" : ""}">
                    <h2 class="text-xl font-bold text-gray-900 truncate" title="${escapeHTML(sim.name)}">${escapeHTML(sim.name)}</h2>
                </div>

                <!-- 号码与状态区域 -->
                <div class="flex justify-between items-center mb-4 gap-2">
                    <p class="text-gray-600 font-mono text-sm flex items-center gap-1.5 truncate">
                        ${flagEmoji}
                        <span class="truncate">${escapeHTML(sim.number || "未登记号码")}</span>
                    </p>
                    <!-- 状态标签 -->
                    <div class="flex items-center gap-1.5 flex-shrink-0">
                        ${autoRenewBadge}
                        ${reminderLabel}
                        <span class="px-2.5 py-1 rounded-full text-[11px] font-bold shadow-sm whitespace-nowrap flex-shrink-0 ${badgeClass}">
                            <i class="fa-solid ${icon} mr-1"></i>${statusText}
                        </span>
                    </div>
                </div>

                <!-- 备注/保号要求区域 -->
                ${remarkHTML}

                <!-- 底部进度条区域 -->
                <div class="mt-auto">
                    <div class="flex justify-between text-sm font-semibold mb-2">
                        <span class="text-gray-700">剩余时间</span>
                        <span class="text-gray-900 font-bold ${diffDays <= reminderDays && diffDays > 0 ? "text-red-600" : ""}">${diffDays < 0 ? "0" : diffDays} 天</span>
                    </div>
                    <div class="w-full bg-gray-200/60 rounded-full h-3 mb-2 shadow-inner">
                        <div class="${statusColor} h-3 rounded-full shadow-sm transition-all duration-1000" style="width: ${percent}%"></div>
                    </div>
                    <div class="flex justify-between text-xs text-gray-500 mt-2 font-medium">
                        <span><i class="fa-solid fa-arrows-rotate mr-1"></i>周期: ${escapeHTML(cycleLabel)}</span>
                        <span>到期日: ${escapeHTML(sim.expireDate)}</span>
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
  const payload = {
    name: document.getElementById("simName").value,
    number: document.getElementById("simNumber").value,
    startDate: document.getElementById("simStartDate").value,
    expireDate: document.getElementById("simExpire").value,
    cycle: Number(document.getElementById("simCycle").value),
    cycleUnit: document.getElementById("simCycleUnit").value,
    reminderDays:
      document.getElementById("simReminderDays").value === ""
        ? 15
        : Number(document.getElementById("simReminderDays").value),
    remark: document.getElementById("simRemark").value,
    autoRenew: document.getElementById("simAutoRenew").checked,
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

function openRenewModal(id) {
  const sim = esimData.find((s) => s.id === id);
  if (!sim) return;
  renewTarget = { ...sim, revision: dataRevision };
  document.getElementById("renewSimInfo").textContent =
    sim.name + " | 周期: " + sim.cycle + " " + getCycleUnitLabel(sim.cycleUnit);
  document.getElementById("renewPreviewExpiry").textContent =
    "新到期日：" + addCalendarCycle(sim.expireDate, sim.cycle, sim.cycleUnit);
  document.getElementById("renewPreviewToday").textContent =
    "新到期日：" + addCalendarCycle(todayString(), sim.cycle, sim.cycleUnit);
  document.querySelector(
    'input[name="renewMode"][value="fromExpiry"]',
  ).checked = true;
  showDialog("renewModal");
}

function closeRenewModal() {
  hideDialog("renewModal");
  renewTarget = null;
}

async function confirmRenew() {
  if (!renewTarget) return;
  const mode = document.querySelector('input[name="renewMode"]:checked').value;
  try {
    await mutate(
      WORKER_API_URL,
      "PUT",
      {
        id: renewTarget.id,
        renewMode: mode,
      },
      renewTarget.revision,
    );
    closeRenewModal();
    await fetchEsimData();
  } catch (e) {
    alert(e.message);
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
  const history = Array.isArray(sim.renewalHistory)
    ? [...sim.renewalHistory].reverse()
    : [];
  const sourceLabels = {
    manual: "手动续期",
    batch: "批量续期",
    auto: "自动延期",
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
              <span class="absolute left-1 top-1.5 w-3 h-3 rounded-full bg-violet-500 ring-4 ring-violet-100"></span>
              <span class="absolute left-[9px] top-5 bottom-0 w-px bg-violet-100 ${index === history.length - 1 ? "hidden" : ""}"></span>
              <div class="rounded-xl border border-violet-100 bg-violet-50/50 p-4">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <span class="text-xs font-bold text-violet-700 bg-white border border-violet-100 rounded-full px-2.5 py-1">${escapeHTML(sourceLabels[record.source] || record.source)}</span>
                  <time class="text-xs text-gray-500">${escapeHTML(formatRenewalTimestamp(record.renewedAt))}</time>
                </div>
                <div class="flex items-center gap-2 text-sm font-semibold text-gray-800 break-all">
                  <span>${escapeHTML(record.previousExpireDate)}</span>
                  <i class="fa-solid fa-arrow-right text-violet-400"></i>
                  <span class="text-violet-700">${escapeHTML(record.newExpireDate)}</span>
                </div>
                <p class="mt-2 text-xs text-gray-500">${escapeHTML(modeLabels[record.mode] || record.mode)} · 周期 ${escapeHTML(record.cycle)} ${escapeHTML(getCycleUnitLabel(record.cycleUnit))}</p>
              </div>
            </article>`,
        )
        .join("")
    : `<div class="rounded-xl border border-dashed border-gray-300 bg-gray-50/70 px-4 py-10 text-center text-gray-500">
         <i class="fa-regular fa-clock text-3xl text-gray-300 mb-3"></i>
         <p class="font-semibold">还没有续期记录</p>
         <p class="text-xs mt-1">完成手动、批量或自动续期后会显示在这里</p>
       </div>`;
  showDialog("renewalHistoryModal");
}

function closeRenewalHistoryModal() {
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

function autoCalcExpireDate() {
  const cycle = Number(document.getElementById("simCycle").value);
  const unit = document.getElementById("simCycleUnit").value;
  const start = document.getElementById("simStartDate").value;
  try {
    document.getElementById("simExpire").value = addCalendarCycle(
      start,
      cycle,
      unit,
    );
    document.getElementById("expireHint").textContent =
      "已按日历计算，月末取目标月最后一天。";
  } catch {
    document.getElementById("expireHint").textContent =
      "请填写有效的开始日期和正整数周期。";
  }
}

function getTodayStr() {
  return todayString();
}

function openModal() {
  editingId = null;
  document.getElementById("modalTitle").innerHTML =
    '<i class="fa-solid fa-file-circle-plus text-blue-600"></i> 新增 eSIM';
  document.getElementById("addForm").reset();
  document.getElementById("simStartDate").value = getTodayStr();
  document.getElementById("simCycleUnit").value = "day";
  document.getElementById("simAutoRenew").checked = false;
  document.getElementById("simReminderDays").value = "";
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

  document.getElementById("simName").value = sim.name || "";
  document.getElementById("simNumber").value = sim.number || "";
  document.getElementById("simStartDate").value =
    sim.startDate || getTodayStr();
  document.getElementById("simCycle").value = sim.cycle || "";
  document.getElementById("simCycleUnit").value = sim.cycleUnit || "day";
  document.getElementById("simRemark").value = sim.remark || "";
  document.getElementById("simExpire").value = sim.expireDate || "";
  document.getElementById("simAutoRenew").checked = !!sim.autoRenew;
  document.getElementById("simReminderDays").value = sim.reminderDays ?? "";
  document.getElementById("expireHint").innerHTML = "";

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

function openImportModal() {
  importRevision = dataRevision;
  document.getElementById("importFile").value = "";
  document.getElementById("importPassword").value = "";
  toggleBackupMenu(false);
  showDialog("importModal");
}

function closeImportModal() {
  hideDialog("importModal");
  document.getElementById("importPassword").value = "";
  document.getElementById("importFile").value = "";
}

function exportData() {
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
    URL.revokeObjectURL(url);
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
  const fileInput = document.getElementById("importFile");
  const pwd = document.getElementById("importPassword").value;
  const mode = document.querySelector('input[name="importMode"]:checked').value;

  if (!fileInput.files || fileInput.files.length === 0)
    return alert("请选择备份文件！");
  if (!pwd) return alert("请输入解密密码！");

  const btn = document.getElementById("importBtn");
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>导入中...';
  btn.disabled = true;

  try {
    const file = fileInput.files[0];
    if (file.size > 12 * 1024 * 1024) throw new Error("备份文件超过 12 MB");
    const text = await file.text();

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
    const response = await mutate(
      WORKER_API_URL + "/import",
      "POST",
      {
        mode,
        data: parsed,
      },
      importRevision,
    );

    if (response.status === 401) {
      logout();
      return;
    }
    if (response.ok) {
      alert("导入成功！");
      closeImportModal();
      await fetchEsimData();
    } else {
      const err = await response.json();
      throw new Error(err.message || "导入失败");
    }
  } catch (e) {
    console.error(e);
    alert("错误: " + e.message);
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}

function renderStats() {
  let safeCount = 0,
    warningCount = 0,
    dangerCount = 0;
  const today = todayString();
  for (const sim of esimData) {
    const days = daysBetween(today, sim.expireDate);
    const reminder = sim.reminderDays ?? 15;
    if (days <= reminder) dangerCount++;
    else if (days <= reminder * 3) warningCount++;
    else safeCount++;
  }
  // 统计区域（基于全部数据，而非过滤后的）
  const container = document.getElementById("stats-container");
  const counts = [safeCount, warningCount, dangerCount];
  const current = [...container.querySelectorAll(".text-3xl")];
  if (current.length === 3) {
    current.forEach((node, index) => {
      if (node.textContent !== String(counts[index]))
        node.textContent = String(counts[index]);
    });
    return;
  }
  container.innerHTML = `
        <div class="glass-card rounded-2xl p-5 flex items-center justify-between border-l-4 border-l-green-500">
            <div>
                <p class="text-gray-500 text-sm font-bold uppercase">安全卡片</p>
                <p class="text-3xl font-black text-gray-800 mt-1">${safeCount}</p>
            </div>
            <i class="fa-solid fa-shield text-4xl text-green-200"></i>
        </div>
        <div class="glass-card rounded-2xl p-5 flex items-center justify-between border-l-4 border-l-yellow-400">
            <div>
                <p class="text-gray-500 text-sm font-bold uppercase">建议关注</p>
                <p class="text-3xl font-black text-gray-800 mt-1">${warningCount}</p>
            </div>
            <i class="fa-solid fa-clock text-4xl text-yellow-200"></i>
        </div>
        <div class="glass-card rounded-2xl p-5 flex items-center justify-between border-l-4 border-l-red-500">
            <div>
                <p class="text-gray-500 text-sm font-bold uppercase">告警/过期</p>
                <p class="text-3xl font-black text-gray-800 mt-1">${dangerCount}</p>
            </div>
            <i class="fa-solid fa-triangle-exclamation text-4xl text-red-200"></i>
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
    a.click();
    URL.revokeObjectURL(url);
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
document.getElementById("esim-container").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const actions = {
    edit: openEditModal,
    renew: openRenewModal,
    history: openRenewalHistory,
    delete: deleteEsim,
  };
  actions[button.dataset.action]?.(button.dataset.cardId);
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
    ].filter((el) => !el.disabled && el.type !== "hidden");
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
