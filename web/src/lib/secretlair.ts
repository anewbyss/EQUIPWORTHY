// Secret Lair drop tracking: sale reminders, launch links, readiness checklist,
// place-in-line ETA and drop value. Pure functions; the iOS port is
// ios/EquipWorthy.swiftpm/Sources/EquipWorthyKit/SecretLair.swift. See docs/SECRET_LAIR.md.
//
// EquipWorthy never joins the waiting room or buys anything for you: it gets you
// to the official page at the right moment, ready to check out.

import { priceFor, type CardSummary, type Finish, type QueueLog, type SecretLairDrop, type SecretLairGroup } from "./types";

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

/**
 * Scryfall lists every Secret Lair card in one set ("sld"). Group them into
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

export function newDrop(name: string, fields: Partial<SecretLairDrop> = {}): SecretLairDrop {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name, cardIds: [], marked: true, checklist: {}, remindersSent: [], createdAt: now, updatedAt: now, ...fields };
}
