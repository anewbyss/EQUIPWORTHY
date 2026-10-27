// Fast-mover detection and synergy prediction. Pure functions; the iOS port is
// ios/EquipWorthy.swiftpm/Sources/EquipWorthyKit/Market.swift. See docs/MARKET.md.

import type { CardSummary, Finish, Mover, PriceSeries, Settings, SynergyPick } from "./types";

// ---------------- fast movers ----------------

const DAY = 86_400_000;

/** % change from the most recent point at least `days` days before the latest one (within days+2). */
export function pctOver(series: PriceSeries | undefined, days: number): number | undefined {
  if (!series || series.length < 2) return undefined;
  const [lastDate, lastPrice] = series[series.length - 1];
  const t = Date.parse(lastDate);
  for (let i = series.length - 2; i >= 0; i--) {
    const age = (t - Date.parse(series[i][0])) / DAY;
    if (age < days) continue;
    if (age > days + 2 || series[i][1] <= 0) return undefined;
    return ((lastPrice - series[i][1]) / series[i][1]) * 100;
  }
  return undefined;
}

export interface MoverInput {
  cardId: string;
  name: string;
  set: string;
  finish: Finish;
  series: PriceSeries | undefined;
  tracked: boolean;
}

/** Cards whose price jumped or crashed past the thresholds in Settings. */
export function detectMovers(inputs: MoverInput[], s: Pick<Settings, "spikePct1d" | "spikePct7d" | "moverMinPrice">): Mover[] {
  const out: Mover[] = [];
  for (const m of inputs) {
    const last = m.series?.[m.series.length - 1];
    if (!last) continue;
    const price = last[1];
    const d1 = pctOver(m.series, 1);
    const d7 = pctOver(m.series, 7);
    // A cheap card that spiked past the floor still counts; a crash needs the old price above it.
    const before = d7 != null ? price / (1 + d7 / 100) : d1 != null ? price / (1 + d1 / 100) : price;
    if (Math.max(price, before) < s.moverMinPrice) continue;
    const up = (d1 ?? 0) >= s.spikePct1d || (d7 ?? 0) >= s.spikePct7d;
    const down = (d1 ?? 0) <= -s.spikePct1d || (d7 ?? 0) <= -s.spikePct7d;
    if (!up && !down) continue;
    out.push({ cardId: m.cardId, name: m.name, set: m.set, finish: m.finish, price, d1, d7, kind: up ? "spike" : "crash", tracked: m.tracked });
  }
  const size = (x: Mover) => Math.max(Math.abs(x.d1 ?? 0), Math.abs(x.d7 ?? 0));
  return out.sort((a, b) => size(b) - size(a));
}

export function moverText(m: Mover): string {
  const parts: string[] = [];
  if (m.d1 != null) parts.push(`${m.d1 > 0 ? "+" : ""}${m.d1.toFixed(1)}% today`);
  if (m.d7 != null) parts.push(`${m.d7 > 0 ? "+" : ""}${m.d7.toFixed(1)}% this week`);
  return `${m.name} is ${m.kind === "spike" ? "spiking" : "dropping fast"}: ${parts.join(", ")} (now $${m.price.toFixed(2)})`;
}

// ---------------- synergy themes ----------------

/** Common keywords that say nothing about a deck's strategy. */
const EVERGREEN = new Set([
  "flying", "trample", "haste", "vigilance", "deathtouch", "lifelink", "reach", "first strike", "double strike", "menace",
  "hexproof", "flash", "defender", "indestructible", "ward", "equip", "enchant", "protection", "shroud", "fear", "intimidate",
  "cycling", "kicker", "scry", "mill", "fight", "transform", "partner", "changeling",
]);

/** Text patterns that mark a strategy. Weight: how strongly sharing it suggests synergy. */
export const THEMES: { tag: string; label: string; re: RegExp; weight: number }[] = [
  { tag: "counters", label: "+1/+1 counters", re: /\+1\/\+1 counter/i, weight: 1 },
  { tag: "minus-counters", label: "-1/-1 counters", re: /-1\/-1 counter/i, weight: 1 },
  { tag: "proliferate", label: "proliferate", re: /proliferate/i, weight: 1.2 },
  { tag: "tokens", label: "tokens", re: /create[^.]*token/i, weight: 0.8 },
  { tag: "treasure", label: "Treasure", re: /treasure/i, weight: 1 },
  { tag: "food", label: "Food", re: /\bfood\b/i, weight: 1 },
  { tag: "clues", label: "Clues", re: /\bclue\b/i, weight: 1 },
  { tag: "sacrifice", label: "sacrifice", re: /sacrifice (a|an|another|two|x)\b/i, weight: 0.9 },
  { tag: "graveyard", label: "graveyard", re: /from (your|a) graveyard|cards? in (your|a) graveyard/i, weight: 0.8 },
  { tag: "lifegain", label: "life gain", re: /whenever you gain life|you gain \w+ life/i, weight: 0.9 },
  { tag: "landfall", label: "landfall", re: /landfall|land enters the battlefield under your control|lands? you control enters/i, weight: 1.1 },
  { tag: "spells", label: "instants & sorceries", re: /instant or sorcery|noncreature spell/i, weight: 0.8 },
  { tag: "artifacts", label: "artifacts", re: /artifacts? you control|whenever an artifact|artifact spell/i, weight: 0.8 },
  { tag: "enchantments", label: "enchantments", re: /enchantments? you control|whenever an enchantment|enchantment spell|constellation/i, weight: 0.9 },
  { tag: "equipment", label: "Equipment & Auras", re: /equipped creature|enchanted creature|\baura\b|equipment/i, weight: 0.7 },
  { tag: "blink", label: "flicker / ETB", re: /exile[^.]*return (it|that card|them|those cards)[^.]*battlefield/i, weight: 0.8 },
  { tag: "attack", label: "attack triggers", re: /whenever [^.]* attacks/i, weight: 0.5 },
  { tag: "draw-two", label: "second card drawn", re: /second card each turn|draw your second card/i, weight: 1 },
  { tag: "discard", label: "discard", re: /whenever you discard|discards? a card/i, weight: 0.7 },
  { tag: "energy", label: "energy", re: /\{E\}|energy counter/i, weight: 1 },
  { tag: "voltron", label: "commander damage / voltron", re: /commander damage|equipped creature gets/i, weight: 0.6 },
  { tag: "extra-combat", label: "extra combats", re: /additional combat phase/i, weight: 1 },
  { tag: "copy", label: "copy spells", re: /copy (target|that) (instant|sorcery|spell)/i, weight: 0.9 },
  { tag: "mana-rocks", label: "ramp", re: /add (one mana|\{[WUBRGC]\})/i, weight: 0.3 },
];

/** Creature types named in a type line ("Legendary Creature — Elf Druid" → ["Elf", "Druid"]). */
export function subtypes(typeLine: string): string[] {
  return typeLine
    .split("//")
    .filter((face) => /creature|tribal|kindred/i.test(face))
    .flatMap((face) => (face.split("—")[1] ?? "").trim().split(/\s+/))
    .filter(Boolean);
}

/** Plural forms used in rules text ("Elf" → "Elves", "Wolf" → "Wolves"). */
export function plural(t: string): string {
  if (/f$/.test(t)) return t.slice(0, -1) + "ves";
  if (/(s|x|ch|sh)$/.test(t)) return t + "es";
  if (/y$/.test(t) && !/[aeiou]y$/.test(t)) return t.slice(0, -1) + "ies";
  return t + "s";
}

/** Strategy tags for a card: non-evergreen mechanics and text themes. Creature types are matched separately. */
export function themesOf(c: Pick<CardSummary, "oracleText" | "typeLine" | "keywords">): Map<string, { label: string; weight: number }> {
  const out = new Map<string, { label: string; weight: number }>();
  const text = c.oracleText ?? "";
  for (const k of c.keywords ?? []) {
    const key = k.toLowerCase();
    if (!EVERGREEN.has(key)) out.set(`kw:${key}`, { label: k, weight: 1.2 });
  }
  for (const t of THEMES) if (t.re.test(text)) out.set(t.tag, { label: t.label, weight: t.weight });
  return out;
}

function caresAboutType(text: string, type: string): boolean {
  const re = new RegExp(`\\b(${type}|${plural(type)})\\b`);
  return re.test(text);
}

export interface SynergyOptions {
  /** cards to exclude from candidates (e.g. the new cards themselves) */
  exclude?: Set<string>;
  minScore?: number;
  limit?: number;
}

/**
 * Score existing cards by how well they fit cards from new or upcoming sets.
 * New legendary creatures count extra: a new commander is the classic trigger
 * for older cards spiking.
 */
export function scoreSynergy(candidates: CardSummary[], newCards: CardSummary[], opts: SynergyOptions = {}): SynergyPick[] {
  const minScore = opts.minScore ?? 2;
  const newThemes = newCards.map((n) => ({ n, t: themesOf(n), legendary: /legendary creature/i.test(n.typeLine) }));
  const picks: SynergyPick[] = [];
  for (const c of candidates) {
    if (opts.exclude?.has(c.id) || newCards.some((n) => n.oracleId && n.oracleId === c.oracleId)) continue;
    const ct = themesOf(c);
    const text = c.oracleText ?? "";
    const reasonWeight = new Map<string, number>();
    const reasonSources = new Map<string, Set<string>>();
    const contributions: { score: number; source: string }[] = [];
    for (const { n, t, legendary } of newThemes) {
      let s = 0;
      const add = (label: string, w: number) => {
        s += w;
        reasonWeight.set(label, (reasonWeight.get(label) ?? 0) + w);
        if (!reasonSources.has(label)) reasonSources.set(label, new Set());
        reasonSources.get(label)!.add(n.name);
      };
      for (const [tag, info] of t) {
        const mine = ct.get(tag);
        if (mine) add(info.label, Math.min(info.weight, mine.weight));
      }
      // Tribal: the new card cares about a type this card is, or vice versa.
      for (const st of subtypes(c.typeLine)) if (caresAboutType(n.oracleText ?? "", st)) add(`${st} synergy`, 1.3);
      for (const st of subtypes(n.typeLine)) if (caresAboutType(text, st)) add(`${st} synergy`, 1.3);
      if (s === 0) continue;
      const fitsCommander = legendary && c.colorIdentity.every((x) => n.colorIdentity.includes(x));
      if (fitsCommander) {
        s *= 1.5;
        reasonWeight.set(`Fits new commander ${n.name}`, s);
        reasonSources.set(`Fits new commander ${n.name}`, new Set([n.name]));
      }
      contributions.push({ score: s, source: n.name });
    }
    if (!contributions.length) continue;
    contributions.sort((a, b) => b.score - a.score);
    let score = contributions.slice(0, 5).reduce((a, x) => a + x.score, 0);
    // Market adjustments: mid-priced, popular, not freshly reprinted cards move most.
    const price = c.prices.usd ?? c.prices.usdFoil;
    if (price != null && price > 40) score *= 0.6;
    if (price != null && price < 0.5) score *= 0.5;
    if (c.edhrecRank != null && c.edhrecRank < 3000) score *= 1.15;
    if (c.reserved) score *= 1.1;
    score = Math.round(score * 10) / 10;
    if (score < minScore) continue;
    const reasons = [...reasonWeight.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label]) => {
        const n = reasonSources.get(label)?.size ?? 0;
        return label.startsWith("Fits new commander") ? label : `${label}: shared with ${n} new card${n === 1 ? "" : "s"}`;
      });
    picks.push({ cardId: c.id, name: c.name, set: c.set, price, score, reasons, sources: contributions.slice(0, 5).map((x) => x.source) });
  }
  picks.sort((a, b) => b.score - a.score);
  return picks.slice(0, opts.limit ?? 60);
}

/** Forecast impact (% per 30 days) for a synergy score. */
export const synergyImpact = (score: number) => Math.min(6, Math.round(score * 0.8 * 10) / 10);
