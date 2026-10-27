// Helpers for the persisted batch-entry review queue.

import type { BatchLine } from "./batch";
import type { Resolved } from "./resolve";
import { applySnapshot } from "./prices";
import { getState, update } from "./store";
import { uid, type CardSummary, type Condition, type Deck, type PendingRow, type Profile } from "./types";

export function toPending(r: Resolved, source: PendingRow["source"], defaults: { condition: Condition }): PendingRow {
  const l: BatchLine = r.line;
  const c = r.card;
  const finish = c && !c.finishes.includes(l.finish) ? c.finishes[0] ?? l.finish : l.finish;
  return {
    key: uid(),
    raw: l.raw,
    status: r.status,
    cardId: c?.id,
    name: c?.name ?? l.name,
    set: c?.set ?? l.set,
    collectorNumber: c?.collectorNumber ?? l.collectorNumber,
    finish,
    condition: l.condition ?? defaults.condition,
    language: l.language ?? "en",
    quantity: l.quantity || 1,
    purchasePrice: l.purchasePrice,
    board: l.board,
    source,
  };
}

export function addPending(rows: PendingRow[], cards: CardSummary[]) {
  update((p) => {
    const cardCache = { ...p.cardCache };
    for (const c of cards) cardCache[c.id] = c;
    return { ...p, cardCache, pendingBatch: [...(p.pendingBatch ?? []), ...rows] };
  });
}

export type Destination =
  | { kind: "collection"; binder: string }
  | { kind: "wishlist" }
  | { kind: "watchlist" }
  | { kind: "deck"; deckId: string };

/** Move resolved rows into the destination and drop them from the queue. Pure. */
export function commitRows(p: Profile, keys: Set<string>, dest: Destination): Profile {
  const rows = (p.pendingBatch ?? []).filter((r) => keys.has(r.key) && r.cardId);
  const now = new Date().toISOString();
  let next: Profile = { ...p, pendingBatch: (p.pendingBatch ?? []).filter((r) => !rows.includes(r)) };
  if (dest.kind === "collection") {
    const collection = [...p.collection];
    for (const r of rows) {
      const ex = collection.findIndex((c) => c.cardId === r.cardId && c.finish === r.finish && c.condition === r.condition && c.language === r.language && c.binder === dest.binder && c.purchasePrice === r.purchasePrice);
      if (ex >= 0) collection[ex] = { ...collection[ex], quantity: collection[ex].quantity + r.quantity };
      else
        collection.push({
          id: uid(), cardId: r.cardId!, name: r.name, set: r.set ?? "", collectorNumber: r.collectorNumber ?? "", finish: r.finish, condition: r.condition,
          language: r.language, quantity: r.quantity, purchasePrice: r.purchasePrice, purchaseDate: r.purchasePrice != null ? now.slice(0, 10) : undefined, binder: dest.binder, addedAt: now,
        });
    }
    next.collection = collection;
  } else if (dest.kind === "wishlist") {
    next.wishlist = [...p.wishlist, ...rows.map((r) => ({ id: uid(), cardId: r.cardId!, name: r.name, finish: r.finish, quantity: r.quantity, addedAt: now }))];
  } else if (dest.kind === "watchlist") {
    const have = new Set(p.watchlist.map((w) => w.cardId + w.finish));
    next.watchlist = [...p.watchlist, ...rows.filter((r) => !have.has(r.cardId! + r.finish)).map((r) => ({ id: uid(), cardId: r.cardId!, name: r.name, finish: r.finish, addedAt: now }))];
  } else {
    next.decks = p.decks.map((d): Deck => {
      if (d.id !== dest.deckId) return d;
      const cards = [...d.cards];
      for (const r of rows) {
        const board = r.board ?? "main";
        const ex = cards.findIndex((c) => c.cardId === r.cardId && c.board === board);
        if (ex >= 0) cards[ex] = { ...cards[ex], quantity: cards[ex].quantity + r.quantity };
        else cards.push({ cardId: r.cardId!, name: r.name, quantity: r.quantity, board });
      }
      return { ...d, cards, updatedAt: now };
    });
  }
  const fresh = rows.map((r) => p.cardCache[r.cardId!]).filter(Boolean);
  next = applySnapshot(next, fresh);
  return next;
}

export const pendingCount = () => getState().profile?.pendingBatch?.length ?? 0;
