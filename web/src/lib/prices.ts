// Price refresh: pulls current prices for every tracked card, records a daily
// snapshot into local price history, updates portfolio value, fires watchlist
// alerts and logs forecasts for later accuracy scoring.

import * as scry from "./scryfall";
import { forecast, resolveForecasts } from "./forecast";
import { detectMovers, moverText, type MoverInput } from "./market";
import { getState, update } from "./store";
import { historyKey, priceFor, today, uid, type Alert, type CardSummary, type Finish, type PriceSeries, type Profile } from "./types";

const MAX_POINTS = 730;
const defaultMoverSettings = { spikePct1d: 15, spikePct7d: 25, moverMinPrice: 1 };

export function trackedIds(p: Profile): string[] {
  const ids = new Set<string>();
  p.collection.forEach((c) => ids.add(c.cardId));
  p.wishlist.forEach((c) => ids.add(c.cardId));
  p.watchlist.forEach((c) => ids.add(c.cardId));
  p.decks.forEach((d) => d.cards.forEach((c) => ids.add(c.cardId)));
  p.trades.forEach((t) => [...t.mine, ...t.theirs].forEach((c) => ids.add(c.cardId)));
  (p.secretLair ?? []).forEach((d) => (d.marked || d.owned) && d.cardIds.forEach((id) => ids.add(id)));
  return [...ids].filter(Boolean);
}

export function appendPoint(series: PriceSeries | undefined, date: string, price: number): PriceSeries {
  const s = (series ?? []).filter(([d]) => d !== date);
  s.push([date, Math.round(price * 100) / 100]);
  s.sort((a, b) => a[0].localeCompare(b[0]));
  return s.slice(-MAX_POINTS);
}

export function collectionValue(p: Profile, cards = p.cardCache): number {
  return p.collection.reduce((a, c) => a + (priceFor(cards[c.cardId], c.finish) ?? 0) * c.quantity, 0);
}

export function change(series: PriceSeries | undefined, days: number): number | undefined {
  if (!series || series.length < 2) return undefined;
  const last = series[series.length - 1];
  const cutoff = new Date(Date.parse(last[0]) - days * 86_400_000).toISOString().slice(0, 10);
  const base = [...series].reverse().find(([d]) => d <= cutoff) ?? series[0];
  if (base[0] === last[0] || base[1] <= 0) return undefined;
  return ((last[1] - base[1]) / base[1]) * 100;
}

/** Record today's snapshot for the given fresh card data. Pure. */
export function applySnapshot(p: Profile, fresh: CardSummary[], now = new Date()): Profile {
  const date = today(now);
  const cardCache = { ...p.cardCache };
  const priceHistory = { ...p.priceHistory };
  for (const c of fresh) {
    cardCache[c.id] = { ...cardCache[c.id], ...c };
    for (const f of ["nonfoil", "foil", "etched"] as Finish[]) {
      const v = f === "nonfoil" ? c.prices.usd : f === "foil" ? c.prices.usdFoil : c.prices.usdEtched;
      if (v != null) priceHistory[historyKey(c.id, f)] = appendPoint(priceHistory[historyKey(c.id, f)], date, v);
    }
  }
  const next: Profile = { ...p, cardCache, priceHistory, lastPriceRefresh: now.toISOString() };
  next.portfolioHistory = appendPoint(p.portfolioHistory, date, collectionValue(next, cardCache));

  // Watchlist alerts (one per card per day)
  const alerts: Alert[] = [...p.alerts];
  for (const w of p.watchlist) {
    const card = cardCache[w.cardId];
    const price = priceFor(card, w.finish);
    if (price == null) continue;
    const msgs: [Alert["kind"], string][] = [];
    if (w.below != null && price <= w.below) msgs.push(["below", `dropped to $${price.toFixed(2)} (target ≤ $${w.below.toFixed(2)})`]);
    if (w.above != null && price >= w.above) msgs.push(["above", `rose to $${price.toFixed(2)} (target ≥ $${w.above.toFixed(2)})`]);
    const move = change(priceHistory[historyKey(w.cardId, w.finish)], 7);
    if (w.pctMove != null && move != null && Math.abs(move) >= w.pctMove) msgs.push(["move", `moved ${move > 0 ? "+" : ""}${move.toFixed(1)}% this week`]);
    for (const [kind, m] of msgs) {
      const already = alerts.some((a) => a.cardId === w.cardId && a.kind === kind && a.createdAt.startsWith(date));
      if (!already) alerts.unshift({ id: uid(), cardId: w.cardId, name: w.name, kind, message: `${w.name} ${m}`, createdAt: now.toISOString(), read: false });
    }
  }
  // Fast movers among your own cards (one alert per card per direction per day)
  const moverInputs: MoverInput[] = [];
  for (const id of trackedIds(p)) {
    const card = cardCache[id];
    if (!card) continue;
    for (const f of card.finishes) {
      const series = priceHistory[historyKey(id, f)];
      if (series) moverInputs.push({ cardId: id, name: card.name + (f === "nonfoil" ? "" : ` (${f})`), set: card.set, finish: f, series, tracked: true });
    }
  }
  for (const m of detectMovers(moverInputs, { ...defaultMoverSettings, ...p.settings })) {
    const already = alerts.some((a) => a.cardId === m.cardId && a.kind === m.kind && a.createdAt.startsWith(date));
    if (!already) alerts.unshift({ id: uid(), cardId: m.cardId, name: m.name, kind: m.kind, message: moverText(m), createdAt: now.toISOString(), read: false });
  }
  next.alerts = alerts.slice(0, 200);

  // Log 7-day forecasts once per day for watched + collection cards
  const logged = new Set(p.forecastLog.filter((e) => e.madeOn === date).map((e) => `${e.cardId}:${e.finish}`));
  const toLog = new Map<string, Finish>();
  p.watchlist.forEach((w) => toLog.set(w.cardId, w.finish));
  p.collection.forEach((c) => toLog.has(c.cardId) || toLog.set(c.cardId, c.finish));
  const log = [...p.forecastLog];
  for (const [id, finish] of toLog) {
    if (logged.has(`${id}:${finish}`)) continue;
    const card = cardCache[id];
    const price = priceFor(card, finish);
    if (!card || price == null) continue;
    const f = forecast(card, priceHistory[historyKey(id, finish)] ?? [], price, 7, now);
    if (f) log.push({ cardId: id, finish, madeOn: date, horizonDays: 7, startPrice: price, expectedPct: f.expectedPct });
  }
  next.forecastLog = resolveForecasts(log, priceHistory, now).slice(-5000);
  return next;
}

export async function refreshPrices(onProgress?: (done: number, total: number) => void): Promise<{ updated: number; newAlerts: Alert[] }> {
  const p = getState().profile;
  if (!p) return { updated: 0, newAlerts: [] };
  const ids = trackedIds(p);
  const fresh: CardSummary[] = [];
  for (let i = 0; i < ids.length; i += 75) {
    const { found } = await scry.collection(ids.slice(i, i + 75).map((id) => ({ id })));
    fresh.push(...found);
    onProgress?.(Math.min(ids.length, i + 75), ids.length);
  }
  const before = new Set(getState().profile!.alerts.map((a) => a.id));
  update((cur) => applySnapshot(cur, fresh));
  const newAlerts = getState().profile!.alerts.filter((a) => !before.has(a.id));
  if (newAlerts.length && getState().profile!.settings.notifications && "Notification" in window && Notification.permission === "granted") {
    for (const a of newAlerts.slice(0, 5)) new Notification("EquipWorthy price alert", { body: a.message });
  }
  return { updated: fresh.length, newAlerts };
}

export function needsRefresh(p: Profile): boolean {
  if (!p.lastPriceRefresh) return trackedIds(p).length > 0;
  return Date.now() - Date.parse(p.lastPriceRefresh) > p.settings.autoRefreshHours * 3_600_000;
}
