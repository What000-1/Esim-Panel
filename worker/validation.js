import { parseDate, addCalendarCycle } from "../shared/dates.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const MAX_CARDS = 500;
export const MAX_RENEWAL_HISTORY = 20;
export function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "记录必须为非空对象");
  return value;
}
function text(value, key, max, optional = false) {
  // Older records may store an empty optional field as null.
  if ((value === undefined || value === null) && optional) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!optional && !value.trim())
  )
    throw new HttpError(
      400,
      `${key}必须是${optional ? "不超过" : "非空且不超过"} ${max} 字的文本`,
    );
  return value.trim();
}
export function validId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id))
    throw new HttpError(400, "ID 格式无效");
  return id;
}
export function validDate(value) {
  try {
    parseDate(value);
    return value;
  } catch (e) {
    throw new HttpError(400, e.message);
  }
}
function validTimestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new HttpError(400, "续期时间无效");
  return value;
}
function validAmount(value, key) {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1000000
  )
    throw new HttpError(400, `${key}必须为 0–1000000 的数字`);
  return Math.round(value * 10000) / 10000;
}
function validTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "标签必须为数组");
  const seen = new Set();
  for (const item of value) {
    const tag = text(item, "标签", 30);
    seen.add(tag);
    if (seen.size > 10) throw new HttpError(400, "最多设置 10 个标签");
  }
  return [...seen];
}
function validBool(value, key, legacy) {
  const raw = legacy && value === null ? undefined : value;
  if (raw !== undefined && typeof raw !== "boolean")
    throw new HttpError(400, `${key}必须为布尔值`);
  return raw ?? false;
}
function validateRenewalRecord(value) {
  const record = object(value);
  const source = record.source;
  const mode = record.mode;
  if (!["manual", "batch", "auto", "telegram"].includes(source))
    throw new HttpError(400, "续期来源无效");
  if (!["fromExpiry", "fromToday"].includes(mode))
    throw new HttpError(400, "续期方式无效");
  if (
    !Number.isInteger(record.cycle) ||
    record.cycle < 1 ||
    record.cycle > 36500
  )
    throw new HttpError(400, "续期周期必须为 1–36500 的整数");
  if (!["day", "month", "quarter", "year"].includes(record.cycleUnit))
    throw new HttpError(400, "续期周期单位无效");
  const result = {
    renewedAt: validTimestamp(record.renewedAt),
    source,
    mode,
    previousExpireDate: validDate(record.previousExpireDate),
    newExpireDate: validDate(record.newExpireDate),
    cycle: record.cycle,
    cycleUnit: record.cycleUnit,
  };
  if (record.previousStartDate !== undefined)
    result.previousStartDate =
      record.previousStartDate === null
        ? null
        : validDate(record.previousStartDate);
  const cost = validAmount(record.cost, "续期费用");
  if (cost !== null) result.cost = cost;
  const currency = text(record.currency, "费用币种", 10, true).toUpperCase();
  if (currency) result.currency = currency;
  return result;
}
export function validateCard(value, { legacy = false } = {}) {
  const card = object(value);
  const id = validId(card.id);
  const name = text(card.name, "名称", 100);
  const brandId = text(card.brandId, "电话卡品牌", 100, true);
  const number = text(card.number, "号码", 50, true);
  const remark = text(card.remark, "备注", 500, true);
  const account = text(card.account, "账号或载体", 120, true);
  const balance = text(card.balance, "当前余额", 40, true);
  const renewCost = validAmount(card.renewCost, "保号费用");
  const renewCurrency = text(
    card.renewCurrency,
    "费用币种",
    10,
    true,
  ).toUpperCase();
  const tags = validTags(card.tags);
  const archived = validBool(card.archived, "归档标记", legacy);
  const muteReminders = validBool(card.muteReminders, "暂停提醒标记", legacy);
  const noRenewal = validBool(card.noRenewal, "无需保号标记", legacy);
  const expireDate = noRenewal ? null : validDate(card.expireDate);
  const startDate =
    card.startDate == null || (legacy && !card.startDate)
      ? null
      : validDate(card.startDate);
  const cycle = noRenewal
    ? null
    : legacy && typeof card.cycle === "string" && /^\s*\d+\s*$/.test(card.cycle)
      ? Number(card.cycle.trim())
      : card.cycle;
  const cycleUnit = card.cycleUnit ?? "day";
  if (!noRenewal && (!Number.isInteger(cycle) || cycle < 1 || cycle > 36500))
    throw new HttpError(400, "周期必须为 1–36500 的整数");
  if (!["day", "month", "quarter", "year"].includes(cycleUnit))
    throw new HttpError(400, "周期单位无效");
  if (!noRenewal) {
    try {
      addCalendarCycle(startDate || expireDate, cycle, cycleUnit);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
  }
  const reminderDaysRaw =
    legacy &&
    typeof card.reminderDays === "string" &&
    /^\s*\d+\s*$/.test(card.reminderDays)
      ? Number(card.reminderDays.trim())
      : card.reminderDays;
  const reminderDays = reminderDaysRaw ?? 15;
  if (
    !Number.isInteger(reminderDays) ||
    reminderDays < 0 ||
    reminderDays > 3650
  )
    throw new HttpError(400, "提前提醒天数必须为 0–3650 的整数");
  const autoRenew = validBool(card.autoRenew, "自动延期", legacy);
  let createdAt =
    card.createdAt == null || (legacy && card.createdAt === "")
      ? null
      : card.createdAt;
  if (
    createdAt !== null &&
    (typeof createdAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(createdAt) ||
      !Number.isFinite(Date.parse(createdAt)))
  )
    throw new HttpError(400, "添加时间无效");
  const renewalHistory = card.renewalHistory ?? [];
  if (
    !Array.isArray(renewalHistory) ||
    renewalHistory.length > MAX_RENEWAL_HISTORY
  )
    throw new HttpError(
      400,
      `续期记录必须为数组，最多 ${MAX_RENEWAL_HISTORY} 条`,
    );
  // Old timestamp IDs contain genuine history. UUIDs do not.
  if (createdAt === null && /^\d{13}$/.test(id) && Number(id) <= Date.now())
    createdAt = new Date(Number(id)).toISOString();
  return {
    id,
    name,
    brandId,
    noRenewal,
    archived,
    muteReminders,
    number,
    remark,
    account,
    balance,
    renewCost,
    renewCurrency,
    tags,
    startDate,
    expireDate,
    cycle,
    cycleUnit,
    reminderDays,
    autoRenew: noRenewal ? false : autoRenew,
    createdAt,
    renewalHistory: renewalHistory.map((record, index) => {
      try {
        return validateRenewalRecord(record);
      } catch (e) {
        throw new HttpError(400, `第 ${index + 1} 条续期记录：${e.message}`);
      }
    }),
  };
}
export function validateList(value, options) {
  if (!Array.isArray(value) || value.length > MAX_CARDS)
    throw new HttpError(400, `数据必须为数组，最多 ${MAX_CARDS} 张卡片`);
  const ids = new Set();
  return value.map((item, index) => {
    try {
      const card = validateCard(item, options);
      if (ids.has(card.id)) throw new Error("ID 重复");
      ids.add(card.id);
      return card;
    } catch (e) {
      throw new HttpError(400, `第 ${index + 1} 条记录：${e.message}`);
    }
  });
}
export async function readJSON(request) {
  const limit = 8 * 1024 * 1024;
  if (Number(request.headers.get("Content-Length")) > limit)
    throw new HttpError(413, "请求超过 8 MB");
  if (!request.body) throw new HttpError(400, "缺少 JSON 数据");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, "请求超过 8 MB");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (e) {
    throw new HttpError(
      400,
      e instanceof HttpError ? e.message : "JSON 格式无效",
    );
  }
}
