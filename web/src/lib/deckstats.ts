// Deck statistics, legality checks, draw odds and store buylist math.

import type { CardSummary, Condition, Deck, Format, Settings } from "./types";

export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** P(exactly k hits) drawing n cards from a deck of N containing K hits. */
export const hypergeom = (N: number, K: number, n: number, k: number) => (choose(K, k) * choose(N - K, n - k)) / choose(N, n);

/** P(at least k hits). */
export function atLeast(N: number, K: number, n: number, k: number): number {
  let p = 0;
  for (let i = k; i <= Math.min(n, K); i++) p += hypergeom(N, K, n, i);
  return Math.min(1, p);
}

const RULES: Record<Format, { min: number; max?: number; copies: number; side?: number }> = {
  commander: { min: 100, max: 100, copies: 1 },
  standard: { min: 60, copies: 4, side: 15 },
  pioneer: { min: 60, copies: 4, side: 15 },
  modern: { min: 60, copies: 4, side: 15 },
  legacy: { min: 60, copies: 4, side: 15 },
  vintage: { min: 60, copies: 4, side: 15 },
  pauper: { min: 60, copies: 4, side: 15 },
  limited: { min: 40, copies: Infinity },
};

const isBasic = (c?: CardSummary, name?: string) =>
  (c?.typeLine ?? "").includes("Basic Land") || /^(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(name ?? "");
const anyNumber = (c?: CardSummary) => /A deck can have any number of cards named/i.test(c?.oracleText ?? "");

export function legality(deck: Deck, cards: Record<string, CardSummary>): string[] {
  const issues: string[] = [];
  const r = RULES[deck.format];
  const main = deck.cards.filter((c) => c.board === "main" || c.board === "commander");
  const side = deck.cards.filter((c) => c.board === "side");
  const count = main.reduce((a, c) => a + c.quantity, 0);
  const sideCount = side.reduce((a, c) => a + c.quantity, 0);
  if (count < r.min) issues.push(`Deck has ${count} cards; ${deck.format} needs ${r.min}${r.max === r.min ? " exactly" : "+"}.`);
  if (r.max && count > r.max) issues.push(`Deck has ${count} cards; max is ${r.max}.`);
  if (r.side != null && sideCount > r.side) issues.push(`Sideboard has ${sideCount} cards; max is ${r.side}.`);

  const byName = new Map<string, number>();
  for (const c of [...main, ...side]) byName.set(c.name, (byName.get(c.name) ?? 0) + c.quantity);
  for (const [name, n] of byName) {
    const card = Object.values(cards).find((x) => x.name === name);
    if (n > r.copies && !isBasic(card, name) && !anyNumber(card)) issues.push(`${n}× ${name} (limit ${r.copies}).`);
  }

  if (deck.format !== "limited") {
    for (const c of deck.cards) {
      if (c.board === "maybe") continue;
      const card = cards[c.cardId];
      const status = card?.legalities[deck.format];
      if (status && status !== "legal" && !(status === "restricted" && c.quantity === 1)) issues.push(`${c.name} is ${status.replace("_", " ")} in ${deck.format}.`);
    }
  }

  if (deck.format === "commander") {
    const commanders = deck.cards.filter((c) => c.board === "commander");
    if (!commanders.length) issues.push("No commander set.");
    const identity = new Set(commanders.flatMap((c) => cards[c.cardId]?.colorIdentity ?? []));
    if (commanders.length) {
      for (const c of deck.cards) {
        if (c.board === "maybe" || c.board === "commander") continue;
        const ci = cards[c.cardId]?.colorIdentity ?? [];
        if (ci.some((x) => !identity.has(x))) issues.push(`${c.name} is outside the commander's color identity.`);
      }
    }
  }
  return issues;
}

export function manaCurve(deck: Deck, cards: Record<string, CardSummary>): number[] {
  const curve = [0, 0, 0, 0, 0, 0, 0, 0]; // 0..6, 7+
  for (const c of deck.cards) {
    if (c.board !== "main" && c.board !== "commander") continue;
    const card = cards[c.cardId];
    if (!card || card.typeLine.includes("Land")) continue;
    curve[Math.min(7, Math.floor(card.cmc))] += c.quantity;
  }
  return curve;
}

export function colorCounts(deck: Deck, cards: Record<string, CardSummary>): Record<string, number> {
  const out: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const c of deck.cards) {
    if (c.board !== "main" && c.board !== "commander") continue;
    const card = cards[c.cardId];
    if (!card || card.typeLine.includes("Land")) continue;
    if (!card.colors.length) out.C += c.quantity;
    for (const col of card.colors) out[col] = (out[col] ?? 0) + c.quantity;
  }
  return out;
}

export function typeCounts(deck: Deck, cards: Record<string, CardSummary>): Record<string, number> {
  const types = ["Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker", "Battle", "Land"];
  const out: Record<string, number> = {};
  for (const c of deck.cards) {
    if (c.board !== "main" && c.board !== "commander") continue;
    const tl = cards[c.cardId]?.typeLine ?? "";
    const t = types.find((x) => tl.includes(x)) ?? "Other";
    out[t] = (out[t] ?? 0) + c.quantity;
  }
  return out;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** What a store would pay: market × condition multiplier × buylist percent. */
export function buylistValue(market: number, pct: number, condition: Condition, settings: Settings): number {
  return Math.round(market * settings.conditionMultipliers[condition] * (pct / 100) * 100) / 100;
}

export const usd = (v: number | undefined | null) =>
  v == null || Number.isNaN(v) ? "—" : v.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const pct = (v: number | undefined | null, digits = 1) =>
  v == null || Number.isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
