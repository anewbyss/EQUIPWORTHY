// Resolve parsed batch lines to exact Scryfall printings.

import type { BatchLine } from "./batch";
import * as scry from "./scryfall";
import type { CardSummary } from "./types";

export interface Resolved {
  line: BatchLine;
  card?: CardSummary;
  status: "ok" | "fuzzy" | "notfound";
}

function identifier(l: BatchLine): scry.Identifier | null {
  if (l.scryfallId) return { id: l.scryfallId };
  if (l.set && l.collectorNumber) return { set: l.set, collector_number: l.collectorNumber };
  if (l.name && l.set) return { name: l.name, set: l.set };
  if (l.name) return { name: l.name };
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const nameMatches = (card: CardSummary, name: string) =>
  norm(card.name) === norm(name) || card.name.split(" // ").some((f) => norm(f) === norm(name));

function matches(card: CardSummary, id: scry.Identifier): boolean {
  if ("id" in id) return card.id === id.id;
  if ("collector_number" in id) return card.set === id.set.toLowerCase() && card.collectorNumber === id.collector_number;
  return nameMatches(card, id.name) && (!id.set || card.set === id.set.toLowerCase());
}

export async function resolveLines(lines: BatchLine[], onProgress?: (n: number, total: number) => void, maxFuzzy = 40): Promise<Resolved[]> {
  const ids = lines.map(identifier);
  const unique: scry.Identifier[] = [];
  const keyOf = (i: scry.Identifier) => JSON.stringify(i).toLowerCase();
  const seen = new Set<string>();
  for (const i of ids) if (i && !seen.has(keyOf(i))) (seen.add(keyOf(i)), unique.push(i));

  const found: CardSummary[] = [];
  for (let i = 0; i < unique.length; i += 75) {
    const r = await scry.collection(unique.slice(i, i + 75));
    found.push(...r.found);
    onProgress?.(Math.min(unique.length, i + 75), unique.length);
  }

  const out: Resolved[] = lines.map((line, i) => {
    const id = ids[i];
    const card = id ? found.find((c) => matches(c, id)) : undefined;
    return { line, card, status: card ? "ok" : "notfound" };
  });

  // Typo-tolerant second pass: fuzzy name lookups for what's left
  let fuzzyCount = 0;
  const fuzzyCache = new Map<string, CardSummary | null>();
  for (const r of out) {
    if (r.card || !r.line.name || fuzzyCount >= maxFuzzy) continue;
    const k = norm(r.line.name) + "|" + (r.line.set ?? "");
    if (!fuzzyCache.has(k)) {
      fuzzyCount++;
      try {
        fuzzyCache.set(k, await scry.named(r.line.name, true, r.line.set));
      } catch {
        try {
          fuzzyCache.set(k, r.line.set ? await scry.named(r.line.name, true) : null);
        } catch {
          fuzzyCache.set(k, null);
        }
      }
    }
    const card = fuzzyCache.get(k);
    if (card) {
      r.card = card;
      r.status = "fuzzy";
    }
  }
  return out;
}
