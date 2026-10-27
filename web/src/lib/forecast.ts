// Price-movement forecasting. A transparent, rules + statistics model that runs
// entirely on-device from locally recorded price history plus card metadata.
// The Swift port (ios/EquipWorthyKit/Sources/EquipWorthyKit/Forecast.swift)
// must stay numerically identical — see docs/FORECASTING.md.

import type { CardSummary, ForecastLogEntry, PriceSeries } from "./types";

export interface Factor {
  label: string;
  impactPct: number; // contribution to expected 30-day move, in percent
  detail: string;
}

export interface Forecast {
  price: number;
  horizonDays: number;
  expectedPct: number;
  lowPct: number; // 80% range
  highPct: number;
  direction: "up" | "down" | "flat";
  confidence: number; // 0..1
  confidenceLabel: "Low" | "Medium" | "High";
  volatility: number; // daily log-return std dev
  reprintRisk: number; // 0..1
  factors: Factor[];
  historyPoints: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export function reprintRisk(card: CardSummary, price: number, now: Date): number {
  if (card.reserved) return 0;
  const priceF = clamp(Math.log10(Math.max(price, 0.01)) / 2, 0, 1);
  const pop = card.edhrecRank != null ? clamp(1 - card.edhrecRank / 5000, 0, 1) : 0.2;
  const ageYears = Math.max(0, (now.getTime() - Date.parse(card.releasedAt)) / (365 * DAY));
  const age = clamp(ageYears / 5, 0, 1);
  return round(0.4 * priceF + 0.35 * pop + 0.25 * age, 3);
}

function round(v: number, d = 2) {
  const p = 10 ** d;
  return Math.round(v * p) / p;
}

function linregSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function stdev(v: number[]): number {
  if (v.length < 2) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

export function forecast(card: CardSummary, series: PriceSeries, currentPrice: number | undefined, horizonDays = 30, now = new Date()): Forecast | null {
  const sorted = [...series].filter(([, p]) => p > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const price = currentPrice ?? sorted[sorted.length - 1]?.[1];
  if (!price || price <= 0) return null;

  const factors: Factor[] = [];
  const nowIso = now.toISOString().slice(0, 10);

  // Window: last 30 days of history
  const recent = sorted.filter(([d]) => daysBetween(d, nowIso) <= 30);
  const spanDays = recent.length ? daysBetween(recent[0][0], recent[recent.length - 1][0]) : 0;

  // 1. Momentum
  if (recent.length >= 5 && spanDays >= 5) {
    const xs = recent.map(([d]) => daysBetween(recent[0][0], d));
    const ys = recent.map(([, p]) => Math.log(p));
    const slope = linregSlope(xs, ys);
    const trend30 = (Math.exp(slope * 30) - 1) * 100;
    const impact = clamp(0.4 * trend30, -25, 25);
    factors.push({
      label: trend30 >= 0 ? "Upward trend" : "Downward trend",
      impactPct: round(impact),
      detail: `Recent prices are moving ${trend30 >= 0 ? "up" : "down"} about ${Math.abs(round(trend30, 1))}% per 30 days. Trends usually carry on partway.`,
    });

    // 2. Mean reversion after spikes / crashes
    const prices = recent.map(([, p]) => p);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const sd = stdev(prices);
    if (sd > 0) {
      const z = (price - mean) / sd;
      if (Math.abs(z) > 1.5) {
        const impact2 = clamp(-0.3 * ((price - mean) / price) * 100, -20, 20);
        factors.push({
          label: z > 0 ? "Spike cooling" : "Dip recovery",
          impactPct: round(impact2),
          detail: `The price is ${Math.abs(round(z, 1))} standard deviations ${z > 0 ? "above" : "below"} its 30-day average. Sharp moves often partly reverse.`,
        });
      }
    }
  }

  // 3. Reserved list
  if (card.reserved) {
    factors.push({ label: "Reserved List", impactPct: 2, detail: "Wizards has promised never to reprint this card, so supply only shrinks." });
  }

  // 4. Reprint risk
  const risk = reprintRisk(card, price, now);
  if (!card.reserved) {
    const level = risk >= 0.6 ? "high" : risk >= 0.35 ? "moderate" : "low";
    factors.push({
      label: `Reprint risk: ${level}`,
      impactPct: round(-risk * 4),
      detail: "Based on price, how much it's played (EDHREC rank) and how long since it was printed. Valuable, popular cards are prime reprint targets.",
    });
  }

  // 5. Demand
  if (card.edhrecRank != null) {
    if (card.edhrecRank < 1000) factors.push({ label: "High Commander demand", impactPct: 1.5, detail: `EDHREC rank #${card.edhrecRank}: one of the most-played Commander cards.` });
    else if (card.edhrecRank < 5000) factors.push({ label: "Steady Commander demand", impactPct: 0.5, detail: `EDHREC rank #${card.edhrecRank}.` });
  }

  // 6. Set lifecycle
  const ageDays = daysBetween(card.releasedAt, nowIso);
  if (ageDays >= 0 && ageDays < 45) factors.push({ label: "New-set dip", impactPct: -6, detail: "Cards usually lose value in the first weeks after release as boxes get opened." });
  else if (ageDays >= 45 && ageDays < 120) factors.push({ label: "Settling after release", impactPct: -2, detail: "Prices are still finding their floor after release." });
  else if (ageDays >= 120 && ageDays < 365) factors.push({ label: "Post-release recovery", impactPct: 1, detail: "Once a set stops being opened, prices usually drift back up." });

  // 7. Standard rotation pressure (3-year rotation)
  if (card.legalities.standard === "legal" && ageDays > 30 * 30) {
    factors.push({ label: "Nearing Standard rotation", impactPct: -2, detail: "Cards that are mostly played in Standard tend to sell off before rotation." });
  }

  // 8. Bans
  const banned = ["commander", "modern", "pioneer", "standard", "legacy"].filter((f) => card.legalities[f] === "banned");
  if (banned.length) factors.push({ label: `Banned in ${banned.join(", ")}`, impactPct: -3, detail: "Banned cards lose demand from those formats." });

  // Bulk floor: very cheap cards can't fall much further
  if (price < 0.5) {
    for (const f of factors) if (f.impactPct < 0) f.impactPct = round(f.impactPct / 2);
  }

  const expected30 = factors.reduce((a, f) => a + f.impactPct, 0);
  const expected = round(expected30 * (horizonDays / 30));

  // Volatility from daily log returns, or a price-tier default
  const rets: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const gap = Math.max(1, daysBetween(recent[i - 1][0], recent[i][0]));
    rets.push(Math.log(recent[i][1] / recent[i - 1][1]) / Math.sqrt(gap));
  }
  const sigma = rets.length >= 5 ? Math.max(0.005, stdev(rets)) : price < 1 ? 0.03 : price < 10 ? 0.02 : 0.015;
  const band = 1.2816 * sigma * Math.sqrt(horizonDays) * 100;

  const dataScore = Math.min(1, recent.length / 30);
  const confidence = round(clamp(0.5 * dataScore + 0.3 * (1 - Math.min(1, sigma / 0.05)) + 0.2 * Math.min(1, factors.length / 3), 0, 1));

  const threshold = 2;
  return {
    price,
    horizonDays,
    expectedPct: expected,
    lowPct: round(expected - band),
    highPct: round(expected + band),
    direction: expected > threshold ? "up" : expected < -threshold ? "down" : "flat",
    confidence,
    confidenceLabel: confidence >= 0.66 ? "High" : confidence >= 0.4 ? "Medium" : "Low",
    volatility: round(sigma, 4),
    reprintRisk: risk,
    factors,
    historyPoints: recent.length,
  };
}

/** Fill in actual outcomes for logged forecasts whose horizon has passed. */
export function resolveForecasts(log: ForecastLogEntry[], history: Record<string, PriceSeries>, now = new Date()): ForecastLogEntry[] {
  const nowIso = now.toISOString().slice(0, 10);
  return log.map((e) => {
    if (e.resolvedPct != null) return e;
    if (daysBetween(e.madeOn, nowIso) < e.horizonDays) return e;
    const s = history[`${e.cardId}:${e.finish}`] ?? [];
    const target = new Date(Date.parse(e.madeOn) + e.horizonDays * DAY).toISOString().slice(0, 10);
    const point = s.find(([d]) => d >= target);
    if (!point) return e;
    return { ...e, resolvedPct: round(((point[1] - e.startPrice) / e.startPrice) * 100) };
  });
}

export function accuracy(log: ForecastLogEntry[]) {
  const done = log.filter((e) => e.resolvedPct != null);
  if (!done.length) return null;
  const dir = (v: number) => (v > 2 ? 1 : v < -2 ? -1 : 0);
  const hits = done.filter((e) => dir(e.expectedPct) === dir(e.resolvedPct!)).length;
  const mae = done.reduce((a, e) => a + Math.abs(e.expectedPct - e.resolvedPct!), 0) / done.length;
  return { count: done.length, directionHitRate: hits / done.length, meanAbsErrorPct: round(mae) };
}
