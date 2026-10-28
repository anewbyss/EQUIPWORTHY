// Price refresh tool: one automatic update per day plus refresh on command.
// A refresh updates your tracked cards, then (if enabled) scans popular
// Commander cards for market-wide fast movers and new-set synergy picks.

import { useSyncExternalStore } from "react";
import * as scry from "./scryfall";
import { FEED_URL, applyFeed, detectMovers, feedDue, feedEntryText, moverText, parseFeed, scoreSynergy, type MoverInput } from "./market";
import { ntfySend } from "./channels";
import { appendPoint, refreshPrices, trackedIds } from "./prices";
import { getState, update } from "./store";
import { historyKey, today, type CardSummary, type FeedEntry, type MarketData, type Mover, type PriceSignal, type Profile } from "./types";

export interface RefreshStatus {
  running: boolean;
  step: string | null;
  error: string | null;
}

let status: RefreshStatus = { running: false, step: null, error: null };
const listeners = new Set<() => void>();
const emit = (patch: Partial<RefreshStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
};
export const useRefreshStatus = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => status,
  );

const localDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-CA") : "");

/** Prices are due once per calendar day (or sooner if the interval setting is shorter). */
export function pricesDue(p: Profile, now = new Date()): boolean {
  if (!p.lastPriceRefresh) return trackedIds(p).length > 0 || p.settings.marketScan;
  if (localDay(p.lastPriceRefresh) !== localDay(now.toISOString())) return true;
  return now.getTime() - Date.parse(p.lastPriceRefresh) > p.settings.autoRefreshHours * 3_600_000;
}

export function marketDue(p: Profile, now = new Date()): boolean {
  return p.settings.marketScan && localDay(p.market?.lastScan) !== localDay(now.toISOString());
}

const MAIN_SET_TYPES = new Set(["expansion", "core", "masters", "commander", "draft_innovation"]);
const MARKET_POINTS = 120;

/** Sets released in the last 45 days or coming in the next 120 (spoiler season). */
export function recentSets(sets: scry.SetInfo[], now = new Date()): scry.SetInfo[] {
  const lo = new Date(now.getTime() - 45 * 86_400_000).toISOString().slice(0, 10);
  const hi = new Date(now.getTime() + 120 * 86_400_000).toISOString().slice(0, 10);
  return sets.filter((s) => MAIN_SET_TYPES.has(s.set_type) && s.released_at && s.released_at >= lo && s.released_at <= hi && s.card_count > 0).slice(0, 5);
}

/** Pure: fold a fresh market scan into the stored market data. */
export function applyMarketScan(p: Profile, universe: CardSummary[], newCards: CardSummary[], newSets: scry.SetInfo[], now = new Date()): Profile {
  const date = today(now);
  const prev = p.market;
  const history: MarketData["history"] = { ...(prev?.history ?? {}) };
  const cards: MarketData["cards"] = {};
  for (const c of universe) {
    const v = c.prices.usd ?? c.prices.usdFoil;
    if (v == null) continue;
    history[c.id] = appendPoint(history[c.id], date, v).slice(-MARKET_POINTS);
    cards[c.id] = { ...c, oracleText: undefined };
  }
  // Drop history for cards that fell out of the universe long ago.
  for (const id of Object.keys(history)) {
    if (!cards[id] && history[id].length && history[id][history[id].length - 1][0] < new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)) delete history[id];
  }

  const tracked = new Set(trackedIds(p));
  const inputs: MoverInput[] = [];
  const seen = new Set<string>();
  for (const id of tracked) {
    const card = p.cardCache[id];
    if (!card) continue;
    for (const f of card.finishes) {
      const s = p.priceHistory[historyKey(id, f)];
      if (!s) continue;
      inputs.push({ cardId: id, name: card.name + (f === "nonfoil" ? "" : ` (${f})`), set: card.set, finish: f, series: s, tracked: true });
      seen.add(id);
    }
  }
  for (const c of universe) {
    if (seen.has(c.id)) continue;
    inputs.push({ cardId: c.id, name: c.name, set: c.set, finish: c.prices.usd != null ? "nonfoil" : "foil", series: history[c.id], tracked: false });
  }
  const movers: Mover[] = detectMovers(inputs, p.settings).slice(0, 80);

  const newCodes = new Set(newSets.map((s) => s.code));
  const candidates = [...universe, ...[...tracked].map((id) => p.cardCache[id]).filter((c): c is CardSummary => !!c && !!c.oracleText)];
  const unique = [...new Map(candidates.filter((c) => !newCodes.has(c.set)).map((c) => [c.id, c])).values()];
  const synergy = newCards.length ? scoreSynergy(unique, newCards, { exclude: new Set(newCards.map((n) => n.id)) }) : prev?.synergy ?? [];
  for (const n of newCards) cards[n.id] = { ...n, oracleText: undefined };
  for (const s of synergy) if (!cards[s.cardId]) {
    const c = unique.find((x) => x.id === s.cardId);
    if (c) cards[c.id] = { ...c, oracleText: undefined };
  }

  return {
    ...p,
    market: {
      history,
      cards,
      movers,
      synergy,
      newSets: newSets.map((s) => ({ code: s.code, name: s.name, releasedAt: s.released_at })),
      lastScan: now.toISOString(),
    },
  };
}

async function scanMarket(p: Profile) {
  const pages = Math.max(1, Math.ceil(p.settings.marketUniverse / 175));
  const universe: CardSummary[] = [];
  for (let page = 1; page <= pages; page++) {
    emit({ step: `Scanning market (${page}/${pages})…` });
    const r = await scry.search("f:commander usd>=0.25 -is:digital", { order: "edhrec", page });
    universe.push(...r.cards);
    if (!r.hasMore) break;
  }
  emit({ step: "Checking new and upcoming sets…" });
  const sets = recentSets(await scry.sets());
  const newCards: CardSummary[] = [];
  if (sets.length) {
    const q = `(${sets.map((s) => `e:${s.code}`).join(" or ")}) not:reprint -t:basic`;
    for (let page = 1; page <= 4; page++) {
      const r = await scry.search(q, { order: "set", page });
      newCards.push(...r.cards);
      if (!r.hasMore) break;
    }
  }
  emit({ step: "Scoring synergies…" });
  return { universe, newCards, sets };
}

/** Refresh tracked prices and (when due or forced) the market scan. */
export async function refreshAll(opts: { force?: boolean } = {}): Promise<void> {
  if (status.running) return;
  const p0 = getState().profile;
  if (!p0) return;
  emit({ running: true, error: null, step: "Updating your cards…" });
  try {
    if (trackedIds(p0).length) await refreshPrices((d, t) => emit({ step: `Updating your cards (${d}/${t})…` }));
    else update((cur) => ({ ...cur, lastPriceRefresh: new Date().toISOString() }));
    const p1 = getState().profile!;
    if (p1.settings.marketScan && (opts.force || marketDue(p1))) {
      const { universe, newCards, sets } = await scanMarket(p1);
      update((cur) => applyMarketScan(cur, universe, newCards, sets));
      notifyMarket(getState().profile!);
    }
    if (opts.force || feedDue(getState().profile!)) await refreshFeed().catch(() => undefined); // the feed is optional; tracked prices already updated
    emit({ running: false, step: null });
  } catch (e) {
    emit({ running: false, step: null, error: `Refresh failed: ${(e as Error).message}` });
  }
}

/** Download the daily all-cards feed and raise buy/sell signals for your cards. */
export async function refreshFeed(fetcher = fetch): Promise<PriceSignal[]> {
  const p0 = getState().profile;
  if (!p0 || p0.settings.marketFeed === false) return [];
  emit({ step: "Checking all-cards market feed…" });
  const res = await fetcher(FEED_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error(res.status === 404 ? "The market feed hasn't been published yet" : `Market feed returned ${res.status}`);
  const feed = parseFeed(await res.json());
  if (!feed) throw new Error("The market feed couldn't be read");
  let fresh: PriceSignal[] = [];
  let digest: FeedEntry[] = [];
  update((cur) => {
    const r = applyFeed(cur, feed);
    fresh = r.fresh;
    digest = r.digest;
    return r.profile;
  });
  void notifySignals(getState().profile!, fresh, digest);
  return fresh;
}

const APP_MARKET_URL = "https://anewbyss.github.io/EQUIPWORTHY/#/market";

async function notifySignals(p: Profile, fresh: PriceSignal[], digest: FeedEntry[]) {
  const items = [
    ...fresh.slice(0, 5).map((s) => ({ title: s.kind === "sell" ? "Hot sell" : "Buy signal", body: s.message, url: s.entry.tcgplayer })),
    ...(digest.length ? [{ title: "Market signals today", body: digest.map(feedEntryText).join("\n"), url: APP_MARKET_URL }] : []),
  ];
  if (fresh.length > 5) items.push({ title: "More signals", body: `${fresh.length - 5} more buy/sell signals in Market Watch.`, url: APP_MARKET_URL });
  if (!items.length) return;
  if (p.settings.notifications && "Notification" in window && Notification.permission === "granted") {
    for (const it of items) {
      try {
        const n = new Notification(it.title, { body: it.body, tag: it.body });
        if (it.url) n.onclick = () => (window.focus(), window.open(it.url, "_blank", "noopener"));
      } catch {
        /* notifications need a service worker on some browsers */
      }
    }
  }
  if (p.settings.signalPush && p.settings.ntfyEnabled && p.settings.ntfyTopic) {
    for (const it of items) await ntfySend(p.settings, { title: it.title, body: it.body, url: it.url ?? APP_MARKET_URL }).catch(() => undefined);
  }
}

function notifyMarket(p: Profile) {
  if (!p.settings.notifications || !("Notification" in window) || Notification.permission !== "granted") return;
  const market = (p.market?.movers ?? []).filter((m) => !m.tracked);
  if (market.length) {
    new Notification("EquipWorthy market movers", { body: market.slice(0, 3).map(moverText).join("\n") + (market.length > 3 ? `\n+${market.length - 3} more` : "") });
  }
}

let started = false;
/** Daily auto-refresh: on launch, when the tab comes back, and hourly while open. */
export function startAutoRefresh() {
  if (started) return;
  started = true;
  const check = () => {
    const p = getState().profile;
    if (p && (pricesDue(p) || marketDue(p) || feedDue(p))) void refreshAll();
  };
  check();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
  setInterval(check, 60 * 60_000);
}
