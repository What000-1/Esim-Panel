// Calendar-only values; all clients and scheduled jobs use the same business day.
export function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("日期必须为 YYYY-MM-DD");
  const date = new Date(value + "T00:00:00Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value ||
    Number(value.slice(0, 4)) < 1900
  )
    throw new Error("日期无效");
  return date;
}

export function todayString(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

export function addCalendarCycle(value, cycle, unit = "day") {
  const date = parseDate(value);
  if (!Number.isInteger(cycle) || cycle < 1 || cycle > 36500)
    throw new Error("周期必须为 1–36500 的整数");
  if (!["day", "month", "quarter", "year"].includes(unit))
    throw new Error("周期单位无效");
  if (unit === "day") date.setUTCDate(date.getUTCDate() + cycle);
  else {
    const day = date.getUTCDate();
    const months = cycle * { month: 1, quarter: 3, year: 12 }[unit];
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const last = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  }
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999)
    throw new Error("计算日期超出范围");
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86400000);
}

export function cycleDays(sim) {
  const start = sim.startDate || sim.expireDate;
  return daysBetween(
    start,
    addCalendarCycle(start, sim.cycle, sim.cycleUnit || "day"),
  );
}
