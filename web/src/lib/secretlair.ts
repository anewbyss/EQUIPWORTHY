// Secret Lair drop tracking: sale reminders, launch links, readiness checklist,
// place-in-line ETA and drop value. Pure functions; the iOS port is
// ios/EquipWorthy.swiftpm/Sources/EquipWorthyKit/SecretLair.swift. See docs/SECRET_LAIR.md.
//
// EquipWorthy never joins the waiting room or buys anything for you: it gets you
// to the official page at the right moment, ready to check out.

import { priceFor, today, type CalendarDrop, type CardSummary, type Finish, type QueueLog, type ReprintPrice, type SecretLairCatalog, type SecretLairDrop, type SecretLairGroup } from "./types";

export const STORE_URL = "https://secretlair.wizards.com/";
export const ACCOUNT_URL = "https://myaccounts.wizards.com/";

/** Where to send you at launch: the drop's own page, or the store front. */
export const launchUrl = (d: Pick<SecretLairDrop, "url">) => (d.url && /^https:\/\//i.test(d.url) ? d.url : STORE_URL);

// ---------------- reminders ----------------

export const REMINDERS: { key: string; before: number; text: (name: string) => string }[] = [
  { key: "24h", before: 24 * 3600_000, text: (n) => `${n} goes on sale in 24 hours. Run the pre-sale checklist today.` },
  { key: "1h", before: 3600_000, text: (n) => `${n} goes on sale in 1 hour. Sign in and check your saved address and payment.` },
  { key: "15m", before: 15 * 60_000, text: (n) => `${n} in 15 minutes. Open EquipWorthy for the launch link.` },
  { key: "5m", before: 5 * 60_000, text: (n) => `${n} in 5 minutes. Open the drop page now and wait there.` },
  { key: "open", before: 0, text: (n) => `${n} is live! Tap to open the drop and join the line.` },
];

/**
 * The reminder to show now, if any. Only the latest one that's due is returned
 * (opening the app 20 minutes before a sale shows the 15-minute reminder, not a
 * stale 24-hour one); `skip` lists the earlier keys to mark as sent with it.
 */
export function dueReminder(d: SecretLairDrop, now = new Date()): { key: string; text: string; skip: string[] } | null {
  if (!d.marked || !d.saleStart) return null;
  const start = Date.parse(d.saleStart);
  if (Number.isNaN(start) || now.getTime() > start + 2 * 3600_000) return null;
  let latest: (typeof REMINDERS)[number] | null = null;
  for (const r of REMINDERS) if (now.getTime() >= start - r.before) latest = r;
  if (!latest || d.remindersSent.includes(latest.key)) return null;
  const idx = REMINDERS.indexOf(latest);
  return { key: latest.key, text: latest.text(d.name), skip: REMINDERS.slice(0, idx).map((r) => r.key) };
}

/** "2d 4h", "1h 05m", "4m 09s", or "Live now". */
export function countdown(saleStart: string | undefined, now = new Date()): string | null {
  if (!saleStart) return null;
  const ms = Date.parse(saleStart) - now.getTime();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "Live now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  return `${m}m ${pad(sec)}s`;
}

export type DropState = "upcoming" | "soon" | "live" | "ended" | "unscheduled";

export function dropState(d: SecretLairDrop, now = new Date()): DropState {
  if (!d.saleStart) return "unscheduled";
  const start = Date.parse(d.saleStart);
  const end = d.saleEnd ? Date.parse(d.saleEnd) : start + 30 * 86400_000;
  if (now.getTime() >= end) return "ended";
  if (now.getTime() >= start) return "live";
  if (start - now.getTime() <= 3600_000) return "soon";
  return "upcoming";
}

// ---------------- pre-sale checklist ----------------

export const CHECKLIST: { key: string; label: string; detail: string; link?: string }[] = [
  { key: "account", label: "Signed in to your Wizards account", detail: "Sign in on the device and browser you'll buy from, so you don't have to sign in mid-line.", link: ACCOUNT_URL },
  { key: "address", label: "Shipping address saved", detail: "Check your default address in your account so checkout is one tap." },
  { key: "payment", label: "Payment method ready", detail: "Have your card or wallet ready (Apple Pay / PayPal if offered)." },
  { key: "version", label: "Version and quantity decided", detail: "Know whether you want foil or non-foil and how many, and note any per-customer limit, so you don't hesitate at checkout." },
  { key: "link", label: "Drop link added", detail: "Paste the product link from Wizards' announcement so EquipWorthy opens the exact page. Otherwise it opens the store front." },
  { key: "early", label: "Plan to open the page a few minutes early", detail: "If a waiting room appears, join and leave that tab alone. Refreshing or opening extra tabs can cost you your place." },
  { key: "device", label: "Device charged, awake and online", detail: "Plug in, use strong Wi-Fi, and keep the screen on while you're in line." },
];

/** A checklist item is done when ticked, or (for the link) when a link is saved. */
export const isChecked = (d: SecretLairDrop, key: string) => !!d.checklist[key] || (key === "link" && !!d.url);
export const readiness = (d: SecretLairDrop) => CHECKLIST.filter((c) => isChecked(d, c.key)).length / CHECKLIST.length;

// ---------------- place in line ----------------

export interface QueueEstimate {
  position: number;
  perMinute?: number; // people admitted per minute (positive = moving)
  etaMinutes?: number;
  etaAt?: string;
}

/** Estimate when you'll get through from the positions you've typed in (linear fit over the last 6 readings). */
export function queueEstimate(q: QueueLog, now = new Date()): QueueEstimate | null {
  const pts = q.entries.filter(([, p]) => Number.isFinite(p) && p >= 0).slice(-6);
  if (!pts.length) return null;
  const position = pts[pts.length - 1][1];
  if (position === 0) return { position, etaMinutes: 0, etaAt: now.toISOString() };
  if (pts.length < 2) return { position };
  const t0 = Date.parse(pts[0][0]);
  const xs = pts.map(([t]) => (Date.parse(t) - t0) / 60_000);
  const ys = pts.map(([, p]) => p);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return { position };
  const perMinute = -num / den;
  if (perMinute <= 0) return { position, perMinute: Math.round(perMinute * 10) / 10 };
  const lastAt = Date.parse(pts[pts.length - 1][0]);
  const etaMinutes = Math.max(0, position / perMinute - (now.getTime() - lastAt) / 60_000);
  return {
    position,
    perMinute: Math.round(perMinute * 10) / 10,
    etaMinutes: Math.round(etaMinutes * 10) / 10,
    etaAt: new Date(now.getTime() + etaMinutes * 60_000).toISOString(),
  };
}

/** Queue notifications: "soon" when about 5 minutes out, "near" at about 1 minute. */
export function dueQueueNotice(q: QueueLog, est: QueueEstimate | null): { key: string; text: string } | null {
  if (!est || q.admittedAt || est.etaMinutes == null) return null;
  if (est.etaMinutes <= 1 && !q.notified.includes("near")) return { key: "near", text: "Almost through the line! Have the drop page in front of you." };
  if (est.etaMinutes <= 5 && !q.notified.includes("soon")) return { key: "soon", text: `About ${Math.max(1, Math.round(est.etaMinutes))} minutes to go in the line (place ${est.position.toLocaleString()}).` };
  return null;
}

export function etaText(est: QueueEstimate | null): string {
  if (!est) return "Enter your place in line to start.";
  if (est.position === 0) return "You're through!";
  if (est.perMinute == null) return `Place ${est.position.toLocaleString()}. Add another reading in a minute or two to estimate your wait.`;
  if (est.perMinute <= 0) return `Place ${est.position.toLocaleString()}. The line isn't moving yet.`;
  const m = est.etaMinutes ?? 0;
  const wait = m < 1 ? "under a minute" : m < 60 ? `about ${Math.round(m)} min` : `about ${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  return `Place ${est.position.toLocaleString()} · moving ~${est.perMinute.toLocaleString()}/min · ${wait} to go`;
}

// ---------------- value ----------------

export function dropValue(cardIds: string[], cards: Record<string, CardSummary | undefined>, finish: Finish = "nonfoil"): { total: number; priced: number } {
  let total = 0, priced = 0;
  for (const id of cardIds) {
    const v = priceFor(cards[id], finish);
    if (v != null) (total += v), priced++;
  }
  return { total: Math.round(total * 100) / 100, priced };
}

// ---------------- catalog grouping ----------------

/** Earliest preview date and the first preview link among a drop's cards. */
function announcement(cards: CardSummary[]): Pick<SecretLairGroup, "announcedAt" | "announcementUrl" | "announcementSource"> {
  const previewed = cards.filter((c) => c.preview?.at || c.preview?.url).sort((a, b) => (a.preview?.at ?? "9").localeCompare(b.preview?.at ?? "9"));
  const linked = previewed.find((c) => c.preview?.url);
  return { announcedAt: previewed[0]?.preview?.at?.slice(0, 10), announcementUrl: linked?.preview?.url, announcementSource: linked?.preview?.source };
}

/**
 * Scryfall lists most Secret Lair cards in one set ("sld"). Group them into
 * drops: same release date and consecutive collector numbers.
 */
export function groupDrops(cards: CardSummary[]): SecretLairGroup[] {
  const num = (c: CardSummary) => parseInt(c.collectorNumber, 10);
  const sorted = cards.filter((c) => Number.isFinite(num(c))).sort((a, b) => a.releasedAt.localeCompare(b.releasedAt) || num(a) - num(b));
  const groups: SecretLairGroup[] = [];
  let cur: { releasedAt: string; first: number; last: number; cards: CardSummary[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const names = [...new Set(cur.cards.map((c) => c.name))];
    groups.push({
      key: `${cur.releasedAt}#${cur.first}`,
      name: `${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2} more` : ""}`,
      releasedAt: cur.releasedAt,
      cardIds: cur.cards.map((c) => c.id),
      ...announcement(cur.cards),
      sources: ["scryfall"],
    });
  };
  for (const c of sorted) {
    const n = num(c);
    if (cur && cur.releasedAt === c.releasedAt && n - cur.last <= 1) {
      cur.cards.push(c);
      cur.last = n;
    } else {
      flush();
      cur = { releasedAt: c.releasedAt, first: n, last: n, cards: [c] };
    }
  }
  flush();
  return groups.sort((a, b) => b.releasedAt.localeCompare(a.releasedAt) || b.key.localeCompare(a.key));
}

// ---------------- more sources: other Secret Lair sets and the drop calendar ----------------

/** Secret Lair products Scryfall lists as their own sets (Countdown Kits, bundles…), excluding promos and digital. */
export const isSecretLairSet = (s: { code: string; name: string; digital?: boolean }) =>
  s.code !== "sld" && !s.digital && /secret lair/i.test(s.name) && !/promo|showdown|token|art series/i.test(s.name);

const https = (u: unknown) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : undefined);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 100_000 ? v : undefined);

/** Validate the drop calendar file; bad entries are skipped. */
export function parseCalendar(json: unknown): CalendarDrop[] {
  const list = (json as { drops?: unknown })?.drops;
  if (!Array.isArray(list)) return [];
  const out: CalendarDrop[] = [];
  for (const raw of list.slice(0, 300)) {
    const r = raw as Record<string, unknown>;
    const id = text(r?.id, 80), name = text(r?.name, 160);
    if (!id || !name) continue;
    const saleStart = typeof r.saleStart === "string" && !Number.isNaN(Date.parse(r.saleStart)) ? new Date(r.saleStart).toISOString() : undefined;
    const releaseDate = typeof r.releaseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.releaseDate) ? r.releaseDate : undefined;
    if (!saleStart && !releaseDate) continue;
    out.push({
      id, name, saleStart, releaseDate,
      price: money(r.price), foilPrice: money(r.foilPrice),
      url: https(r.url), announcementUrl: https(r.announcementUrl),
      set: typeof r.set === "string" && /^[a-z0-9]{2,8}$/i.test(r.set) ? r.set.toLowerCase() : undefined,
      cards: typeof r.cards === "number" && r.cards > 0 && r.cards < 1000 ? Math.round(r.cards) : undefined,
      notes: text(r.notes, 400), tentative: r.tentative === true || undefined,
    });
  }
  return out;
}

/** Loose name key for matching a calendar entry to a Scryfall set: "Secret Lair Countdown Kit: Marvel's History of Heroes" → "marvels history of heroes". */
export const nameKey = (s: string) =>
  s.toLowerCase().replace(/secret lair|countdown kit|drop series|\bdrop\b|\bx\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

const sameDrop = (a: string, b: string) => {
  const x = nameKey(a), y = nameKey(b);
  return x.length >= 6 && y.length >= 6 && (x.includes(y) || y.includes(x));
};

/**
 * Every drop from every source: Secret Lair Drop cards grouped by release date and
 * collector number, other Secret Lair sets as one drop each (even before their cards
 * are listed), and the EquipWorthy drop calendar, merged into matching drops. Newest first.
 */
export function buildCatalogGroups(cards: CardSummary[], sets: { code: string; name: string; releasedAt?: string }[] = [], calendar: CalendarDrop[] = []): SecretLairGroup[] {
  const groups = groupDrops(cards.filter((c) => c.set === "sld"));
  for (const set of sets) {
    const mine = cards.filter((c) => c.set === set.code).sort((a, b) => (parseInt(a.collectorNumber, 10) || 0) - (parseInt(b.collectorNumber, 10) || 0));
    const releasedAt = set.releasedAt ?? mine.map((c) => c.releasedAt).sort()[0];
    if (!releasedAt) continue;
    groups.push({ key: `set:${set.code}`, name: set.name, releasedAt, cardIds: mine.map((c) => c.id), set: set.code, ...announcement(mine), sources: ["scryfall"] });
  }
  for (const cal of calendar) {
    const g = groups.find((x) => (cal.set && x.set === cal.set) || (x.set && sameDrop(x.name, cal.name)));
    const fields = {
      saleStart: cal.saleStart, price: cal.price, foilPrice: cal.foilPrice, url: cal.url, notes: cal.notes, tentative: cal.tentative, cardCount: cal.cards,
    };
    if (g) {
      Object.assign(g, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
      g.name = cal.name;
      g.announcementUrl = cal.announcementUrl ?? g.announcementUrl;
      g.sources = [...new Set([...(g.sources ?? []), "calendar" as const])];
    } else {
      groups.push({
        key: `cal:${cal.id}`, name: cal.name, releasedAt: (cal.saleStart ?? cal.releaseDate!).slice(0, 10), cardIds: [],
        announcementUrl: cal.announcementUrl, set: cal.set, sources: ["calendar"], ...fields,
      });
    }
  }
  return groups.sort((a, b) => b.releasedAt.localeCompare(a.releasedAt) || b.key.localeCompare(a.key));
}

/** Give followed drops that were added before their cards were listed (e.g. from the calendar) their cards. */
export function attachCards(drops: SecretLairDrop[], groups: SecretLairGroup[]): SecretLairDrop[] {
  let changed = false;
  const out = drops.map((d) => {
    if (d.cardIds.length) return d;
    const g = groups.find((x) => x.cardIds.length > 0 && (x.name.toLowerCase() === d.name.toLowerCase() || (!!x.set && sameDrop(x.name, d.name))));
    if (!g) return d;
    changed = true;
    return { ...d, cardIds: g.cardIds, announcementUrl: d.announcementUrl ?? g.announcementUrl, updatedAt: new Date().toISOString() };
  });
  return changed ? out : drops;
}

// ---------------- sorting ----------------

export type GroupSort = "soonest" | "latest" | "announced" | "deal" | "value" | "price" | "name";
export const GROUP_SORTS: { key: GroupSort; label: string }[] = [
  { key: "soonest", label: "Release: soonest first" },
  { key: "latest", label: "Release: newest first" },
  { key: "announced", label: "Recently announced" },
  { key: "deal", label: "Best deal vs price" },
  { key: "value", label: "Card value: high to low" },
  { key: "price", label: "Price: low to high" },
  { key: "name", label: "Name" },
];

/** How much better the cards are than the price: Secret Lair market gap, else savings vs other printings. Higher is better. */
export const dealScore = (c: DropComparison): number | undefined => c.marketGap ?? (c.premium != null ? -c.premium : undefined);

export function sortGroups(
  groups: SecretLairGroup[],
  by: GroupSort,
  ctx: { cards: Record<string, CardSummary | undefined>; reprints?: Record<string, ReprintPrice | undefined> },
): SecretLairGroup[] {
  const when = (g: SecretLairGroup) => g.saleStart ?? g.releasedAt;
  const last = (v: number | undefined, desc: boolean) => (v == null ? Infinity : desc ? -v : v);
  const key = (g: SecretLairGroup): number | string => {
    switch (by) {
      case "deal": return last(dealScore(compareDrop(g.cardIds, ctx.cards, ctx.reprints ?? {}, { price: g.price })), true);
      case "value": { const v = dropValue(g.cardIds, ctx.cards); return last(v.priced ? v.total : undefined, true); }
      case "price": return last(g.price, false);
      case "announced": return g.announcedAt ? -Date.parse(g.announcedAt) : Infinity;
      default: return 0;
    }
  };
  const out = [...groups];
  if (by === "soonest") return out.sort((a, b) => when(a).localeCompare(when(b)) || a.key.localeCompare(b.key));
  if (by === "latest") return out.sort((a, b) => when(b).localeCompare(when(a)) || b.key.localeCompare(a.key));
  if (by === "name") return out.sort((a, b) => a.name.localeCompare(b.name));
  const keys = new Map(out.map((g) => [g.key, key(g) as number]));
  return out.sort((a, b) => keys.get(a.key)! - keys.get(b.key)! || when(a).localeCompare(when(b)));
}

export type DropSort = "sale" | "name" | "added" | "ready";
export const DROP_SORTS: { key: DropSort; label: string }[] = [
  { key: "sale", label: "Sale time" },
  { key: "added", label: "Recently added" },
  { key: "ready", label: "Least ready first" },
  { key: "name", label: "Name" },
];

export function sortDrops(drops: SecretLairDrop[], by: DropSort): SecretLairDrop[] {
  const out = [...drops];
  if (by === "name") return out.sort((a, b) => a.name.localeCompare(b.name));
  if (by === "added") return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (by === "ready") return out.sort((a, b) => readiness(a) - readiness(b) || (a.saleStart ?? "9").localeCompare(b.saleStart ?? "9"));
  return out.sort((a, b) => (a.saleStart ?? "9").localeCompare(b.saleStart ?? "9"));
}

// ---------------- upcoming drops and pre-drop price comparison ----------------

/** Usual Secret Lair prices, used when a drop's price isn't known yet. */
export const TYPICAL_PRICE = { nonfoil: 29.99, foil: 39.99 };

/** Scryfall search showing the cards in a drop group. */
export const scryfallGroupUrl = (g: SecretLairGroup, cards: Record<string, CardSummary | undefined>) => {
  const nums = g.cardIds.map((id) => cards[id]?.collectorNumber).filter(Boolean);
  return `https://scryfall.com/search?q=${encodeURIComponent(`e:sld (${nums.map((n) => `cn:${n}`).join(" or ")})`)}&unique=prints`;
};

/** Announced drops not yet released, plus ones released in the last `recentDays` days, soonest first. */
export function upcomingGroups(groups: SecretLairGroup[], now = new Date(), recentDays = 30): SecretLairGroup[] {
  const from = today(new Date(now.getTime() - recentDays * 86400_000));
  return groups.filter((g) => g.releasedAt >= from).sort((a, b) => (a.saleStart ?? a.releasedAt).localeCompare(b.saleStart ?? b.releasedAt) || a.key.localeCompare(b.key));
}

export const isUpcoming = (g: Pick<SecretLairGroup, "releasedAt" | "saleStart">, now = new Date()) =>
  g.saleStart ? Date.parse(g.saleStart) > now.getTime() : g.releasedAt > today(now);

/** Cheapest non-Secret Lair copies from a list of printings of one card. */
export function cheapestReprint(prints: CardSummary[], now = new Date(), secretLairSets: string[] = ["sld"]): ReprintPrice {
  const skip = new Set(secretLairSets);
  const paper = prints.filter((c) => !skip.has(c.set));
  const min = (xs: (number | undefined)[]) => {
    const v = xs.filter((x): x is number => x != null && x > 0);
    return v.length ? Math.min(...v) : undefined;
  };
  const usd = min(paper.map((c) => c.prices.usd));
  return {
    usd,
    usdFoil: min(paper.map((c) => c.prices.usdFoil)),
    setName: usd != null ? paper.find((c) => c.prices.usd === usd)?.setName : undefined,
    printings: paper.length,
    fetchedAt: now.toISOString(),
  };
}

export interface CompareRow {
  cardId: string;
  name: string;
  sld?: number; // Secret Lair version's market / pre-order price
  reprint?: number; // cheapest copy in another set
  reprintSet?: string;
  isNew: boolean; // first printing: no other copies to compare
}

export interface DropComparison {
  finish: "nonfoil" | "foil";
  price: number;
  priceIsTypical: boolean;
  rows: CompareRow[];
  sldTotal: number;
  sldPriced: number;
  reprintTotal: number;
  reprintPriced: number;
  newCards: number;
  /** Price minus what the cards cost in other printings (positive = you pay a premium for the Secret Lair versions). */
  premium?: number;
  /** Secret Lair market minus price (positive = pre-orders trade above the price). */
  marketGap?: number;
}

/** Compare a drop's price with its cards' Secret Lair market and the cheapest copies elsewhere. */
export function compareDrop(
  cardIds: string[],
  cards: Record<string, CardSummary | undefined>,
  reprints: Record<string, ReprintPrice | undefined>,
  opts: { finish?: "nonfoil" | "foil"; price?: number } = {},
): DropComparison {
  const finish = opts.finish ?? "nonfoil";
  const price = opts.price ?? TYPICAL_PRICE[finish];
  const rows: CompareRow[] = [];
  for (const id of cardIds) {
    const c = cards[id];
    if (!c) continue;
    const r = c.oracleId ? reprints[c.oracleId] : undefined;
    const reprint = r ? (finish === "foil" ? r.usdFoil ?? r.usd : r.usd ?? r.usdFoil) : undefined;
    rows.push({ cardId: id, name: c.name, sld: priceFor(c, finish), reprint, reprintSet: r?.setName, isNew: !!r && r.printings === 0 });
  }
  const sum = (xs: (number | undefined)[]) => Math.round(xs.reduce<number>((a, x) => a + (x ?? 0), 0) * 100) / 100;
  const sldPriced = rows.filter((r) => r.sld != null).length;
  const reprintPriced = rows.filter((r) => r.reprint != null).length;
  const sldTotal = sum(rows.map((r) => r.sld));
  const reprintTotal = sum(rows.map((r) => r.reprint));
  return {
    finish, price, priceIsTypical: opts.price == null, rows, sldTotal, sldPriced, reprintTotal, reprintPriced,
    newCards: rows.filter((r) => r.isNew).length,
    premium: reprintPriced ? Math.round((price - reprintTotal) * 100) / 100 : undefined,
    marketGap: sldPriced && sldPriced === rows.length ? Math.round((sldTotal - price) * 100) / 100 : undefined,
  };
}

/** One-line plain-English read of a comparison. */
export function compareSummary(c: DropComparison): string {
  const parts: string[] = [];
  const $ = (n: number) => `$${Math.abs(n).toFixed(2)}`;
  if (c.marketGap != null) parts.push(c.marketGap >= 0 ? `Secret Lair copies trade ${$(c.marketGap)} above the price` : `Secret Lair copies trade ${$(c.marketGap)} below the price`);
  if (c.premium != null) {
    const partial = c.reprintPriced < c.rows.length ? ` (${c.reprintPriced} of ${c.rows.length} cards)` : "";
    parts.push(c.premium >= 0 ? `the cards cost ${$(c.premium)} less in other printings${partial}` : `the drop is ${$(c.premium)} cheaper than other printings${partial}`);
  }
  if (c.newCards) parts.push(`${c.newCards} new card${c.newCards === 1 ? "" : "s"} with no other printing`);
  if (!parts.length) return "No prices yet. Compare again once pre-orders or reprint prices show up.";
  const s = parts.join("; ");
  return s[0].toUpperCase() + s.slice(1) + ".";
}

/**
 * How past drops have held value: the median of (cards' value now ÷ typical price)
 * for drops released between `minDays` and `maxDays` ago with every card priced.
 */
export function pastDropTrend(cat: SecretLairCatalog, now = new Date(), finish: "nonfoil" | "foil" = "nonfoil", minDays = 60, maxDays = 730): { median: number; drops: number } | null {
  const lo = today(new Date(now.getTime() - maxDays * 86400_000));
  const hi = today(new Date(now.getTime() - minDays * 86400_000));
  const ratios: number[] = [];
  for (const g of cat.groups) {
    if (g.releasedAt < lo || g.releasedAt > hi || g.cardIds.length < 2) continue;
    const v = dropValue(g.cardIds, cat.cards, finish);
    if (v.priced === g.cardIds.length) ratios.push(v.total / TYPICAL_PRICE[finish]);
  }
  if (ratios.length < 3) return null;
  ratios.sort((a, b) => a - b);
  const m = ratios.length >> 1;
  return { median: ratios.length % 2 ? ratios[m] : (ratios[m - 1] + ratios[m]) / 2, drops: ratios.length };
}

export function newDrop(name: string, fields: Partial<SecretLairDrop> = {}): SecretLairDrop {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name, cardIds: [], marked: true, checklist: {}, remindersSent: [], createdAt: now, updatedAt: now, ...fields };
}

// ---------------- reminder plan (shared by notifications, ntfy, texts, calendar) ----------------

export interface PlannedReminder {
  id: string; // stable per drop + reminder, e.g. "<dropId>-5m"
  key: string;
  at: string; // ISO time to deliver
  title: string;
  body: string;
  url: string;
}

/** Every reminder still ahead for a followed drop with a sale time. */
export function plannedReminders(d: SecretLairDrop, now = new Date()): PlannedReminder[] {
  if (!d.marked || d.owned || !d.saleStart) return [];
  const start = Date.parse(d.saleStart);
  if (Number.isNaN(start)) return [];
  return REMINDERS.map((r) => ({ r, at: start - r.before }))
    .filter(({ at }) => at > now.getTime())
    .map(({ r, at }) => ({
      id: `${d.id}-${r.key}`,
      key: r.key,
      at: new Date(at).toISOString(),
      title: r.key === "open" ? "Secret Lair drop is live" : "Secret Lair reminder",
      body: r.text(d.name),
      url: launchUrl(d),
    }));
}

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

/** A calendar event for the sale with alerts 24h, 1h, 15m and 5m before and at the start. */
export function icsFor(d: SecretLairDrop, now = new Date()): string | null {
  if (!d.saleStart) return null;
  const start = d.saleStart;
  const end = d.saleEnd && Date.parse(d.saleEnd) - Date.parse(start) < 6 * 3600_000 ? d.saleEnd : new Date(Date.parse(start) + 30 * 60_000).toISOString();
  const url = launchUrl(d);
  const alarms = REMINDERS.map((r) => [
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(r.text(d.name))}`,
    `TRIGGER:-PT${Math.round(r.before / 60_000)}M`,
    "END:VALARM",
  ].join("\r\n"));
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EquipWorthy//Secret Lair//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${d.id}@equipworthy`,
    `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end!)}`,
    `SUMMARY:${icsText(`Secret Lair: ${d.name}`)}`,
    `DESCRIPTION:${icsText(`Sale opens. Open the drop: ${url}${d.price != null ? `\nPrice: $${d.price.toFixed(2)}` : ""}`)}`,
    `URL:${url}`,
    ...alarms,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
