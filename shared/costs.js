export const DEFAULT_CNY_RATES = {
  CNY: 1,
  RMB: 1,
  USD: 7.15,
  HKD: 0.92,
  MOP: 0.89,
  GBP: 9.1,
  EUR: 7.75,
  JPY: 0.047,
  SGD: 5.35,
  MYR: 1.62,
  THB: 0.21,
  VND: 0.00028,
  AUD: 4.65,
  NZD: 4.25,
  CHF: 8.15,
  CAD: 5.1,
  TWD: 0.22,
  KRW: 0.0052,
  PHP: 0.123,
  PLN: 1.78,
  CZK: 0.3,
  UAH: 0.17,
  NGN: 0.0045,
  ISK: 0.052,
  RSD: 0.066,
  LKR: 0.024,
  MXN: 0.35,
  BHD: 18.95,
  BRL: 1.24,
};

export function resolveCnyRates(customRates = {}) {
  const merged = { ...DEFAULT_CNY_RATES };
  if (customRates && typeof customRates === "object") {
    for (const [key, val] of Object.entries(customRates)) {
      const code = String(key).trim().toUpperCase();
      if (code && typeof val === "number" && Number.isFinite(val) && val > 0)
        merged[code] = val;
    }
  }
  return merged;
}

export function summarizeCosts(cards, { getCycleDays, rates = {} } = {}) {
  const effectiveRates = resolveCnyRates(rates);
  const annual = new Map();
  const spent = new Map();
  for (const sim of cards) {
    if (!sim.archived && !sim.noRenewal && sim.renewCost > 0 && sim.cycle) {
      const days = getCycleDays(sim);
      if (days > 0) {
        const cur = (sim.renewCurrency || "未知币种").toUpperCase();
        annual.set(cur, (annual.get(cur) || 0) + (sim.renewCost * 365) / days);
      }
    }
    for (const rec of sim.renewalHistory || []) {
      // Older versions recorded the configured price for auto-renewals.
      if (rec.source !== "auto" && rec.cost > 0) {
        // Don't infer past payment currencies from the card's current default.
        const cur = (rec.currency || "未知币种").toUpperCase();
        spent.set(cur, (spent.get(cur) || 0) + rec.cost);
      }
    }
  }
  const convert = (map) => {
    let totalCny = 0;
    let convertedCount = 0;
    const unmapped = [];
    for (const [cur, val] of map.entries()) {
      const rate = effectiveRates[cur];
      if (rate > 0) {
        totalCny += val * rate;
        convertedCount++;
      } else {
        unmapped.push(cur);
      }
    }
    return {
      byCurrency: map,
      totalCny: convertedCount > 0 ? Math.round(totalCny * 100) / 100 : null,
      unmapped,
    };
  };
  return {
    annual: convert(annual),
    spent: convert(spent),
    rates: effectiveRates,
  };
}
