// Runs Secret Lair reminders while the app is open (browsers can't run sites in
// the background) and loads the drop catalog from Scryfall.

import * as scry from "./scryfall";
import { cheapestReprint, dueQueueNotice, dueReminder, groupDrops, launchUrl, queueEstimate } from "./secretlair";
import { getState, onSaved, update } from "./store";
import { syncChannels } from "./channels";
import type { CardSummary, ReprintPrice, SecretLairDrop } from "./types";

function notify(title: string, body: string, url?: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, tag: `${title}:${body}`, requireInteraction: !!url });
    if (url) n.onclick = () => (window.focus(), window.open(url, "_blank", "noopener"));
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

const patchDrop = (id: string, fn: (d: SecretLairDrop) => SecretLairDrop) =>
  update((p) => ({ ...p, secretLair: (p.secretLair ?? []).map((d) => (d.id === id ? { ...fn(d), updatedAt: new Date().toISOString() } : d)) }));

/** Check every followed drop for a due reminder or queue notice. */
export function tick(now = new Date()) {
  const p = getState().profile;
  if (!p?.secretLair?.length) return;
  for (const d of p.secretLair) {
    const r = dueReminder(d, now);
    if (r) {
      if (p.settings.notifications) notify(r.key === "open" ? "Secret Lair drop is live" : "Secret Lair reminder", r.text, r.key === "open" || r.key === "5m" ? launchUrl(d) : undefined);
      patchDrop(d.id, (x) => ({ ...x, remindersSent: [...new Set([...x.remindersSent, ...r.skip, r.key])] }));
    }
    if (d.queue) {
      const n = dueQueueNotice(d.queue, queueEstimate(d.queue, now));
      if (n) {
        if (p.settings.notifications) notify(d.name, n.text, launchUrl(d));
        patchDrop(d.id, (x) => (x.queue ? { ...x, queue: { ...x.queue, notified: [...x.queue.notified, n.key] } } : x));
      }
    }
  }
}

let started = false;
export function startSecretLair() {
  if (started) return;
  started = true;
  tick();
  void syncChannels();
  onSaved(() => void syncChannels());
  setInterval(() => (tick(), void syncChannels()), 15_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && tick());
}

/** Load the newest Secret Lair cards (about 700) and group them into drops. */
export async function loadCatalog(onStep?: (s: string) => void) {
  const cards: CardSummary[] = [];
  for (let page = 1; page <= 4; page++) {
    onStep?.(`Loading Secret Lair cards (${page}/4)…`);
    const r = await scry.search("e:sld", { unique: "prints", order: "released", dir: "desc", page });
    cards.push(...r.cards);
    if (!r.hasMore) break;
  }
  const slim: Record<string, CardSummary> = {};
  for (const c of cards) slim[c.id] = { ...c, oracleText: undefined };
  update((p) => ({ ...p, secretLairCatalog: { cards: slim, groups: groupDrops(cards), fetchedAt: new Date().toISOString(), reprints: p.secretLairCatalog?.reprints } }));
}

export const catalogStale = () => {
  const c = getState().profile?.secretLairCatalog;
  return !c || Date.now() - Date.parse(c.fetchedAt) > 3 * 86400_000;
};

const REPRINT_TTL_MS = 2 * 86400_000;

/**
 * Look up the cheapest non-Secret Lair copies of these cards, for pre-drop
 * price comparisons. Batches oracle ids into a few Scryfall searches and skips
 * cards checked in the last two days.
 */
export async function loadReprints(cards: (CardSummary | undefined)[], force = false): Promise<number> {
  const known = getState().profile?.secretLairCatalog?.reprints ?? {};
  const ids = [...new Set(cards.map((c) => c?.oracleId).filter((x): x is string => !!x))].filter(
    (id) => force || !known[id] || Date.now() - Date.parse(known[id].fetchedAt) > REPRINT_TTL_MS,
  );
  if (!ids.length) return 0;
  const found: Record<string, ReprintPrice> = {};
  for (let i = 0; i < ids.length; i += 12) {
    const batch = ids.slice(i, i + 12);
    const byOracle: Record<string, CardSummary[]> = Object.fromEntries(batch.map((id) => [id, []]));
    let page = 1;
    for (;;) {
      const r = await scry.search(`(${batch.map((id) => `oracleid:${id}`).join(" or ")}) -e:sld`, { unique: "prints", order: "usd", dir: "asc", page });
      for (const c of r.cards) if (c.oracleId && byOracle[c.oracleId]) byOracle[c.oracleId].push(c);
      if (!r.hasMore || page >= 4) break;
      page++;
    }
    for (const id of batch) found[id] = cheapestReprint(byOracle[id]);
  }
  update((p) => ({
    ...p,
    secretLairCatalog: { cards: {}, groups: [], fetchedAt: new Date(0).toISOString(), ...p.secretLairCatalog, reprints: { ...(p.secretLairCatalog?.reprints ?? {}), ...found } },
  }));
  return ids.length;
}
