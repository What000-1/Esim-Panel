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
  if (value === undefined && optional) return "";
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
function validateRenewalRecord(value) {
  const record = object(value);
  const source = record.source;
  const mode = record.mode;
  if (!["manual", "batch", "auto"].includes(source))
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
  return {
    renewedAt: validTimestamp(record.renewedAt),
    source,
    mode,
    previousExpireDate: validDate(record.previousExpireDate),
    newExpireDate: validDate(record.newExpireDate),
    cycle: record.cycle,
    cycleUnit: record.cycleUnit,
  };
}
export function validateCard(value, { legacy = false } = {}) {
  const card = object(value);
  const id = validId(card.id);
  const name = text(card.name, "名称", 100);
  const number = text(card.number, "号码", 50, true);
  const remark = text(card.remark, "备注", 500, true);
  const expireDate = validDate(card.expireDate);
  const startDate =
    card.startDate == null || (legacy && !card.startDate)
      ? null
      : validDate(card.startDate);
  const cycle =
    legacy && typeof card.cycle === "string" && /^\d+$/.test(card.cycle)
      ? Number(card.cycle)
      : card.cycle;
  const cycleUnit = card.cycleUnit ?? "day";
  if (!Number.isInteger(cycle) || cycle < 1 || cycle > 36500)
    throw new HttpError(400, "周期必须为 1–36500 的整数");
  if (!["day", "month", "quarter", "year"].includes(cycleUnit))
    throw new HttpError(400, "周期单位无效");
  try {
    addCalendarCycle(startDate || expireDate, cycle, cycleUnit);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  const reminderDays = card.reminderDays ?? 15;
  if (
    !Number.isInteger(reminderDays) ||
    reminderDays < 0 ||
    reminderDays > 3650
  )
    throw new HttpError(400, "提前提醒天数必须为 0–3650 的整数");
  if (card.autoRenew !== undefined && typeof card.autoRenew !== "boolean")
    throw new HttpError(400, "自动延期必须为布尔值");
  let createdAt = card.createdAt ?? null;
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
    number,
    remark,
    startDate,
    expireDate,
    cycle,
    cycleUnit,
    reminderDays,
    autoRenew: card.autoRenew ?? false,
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
