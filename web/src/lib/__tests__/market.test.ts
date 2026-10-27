import { describe, expect, it } from "vitest";
import { detectMovers, pctOver, plural, scoreSynergy, subtypes, themesOf } from "../market";
import { applySnapshot } from "../prices";
import { applyMarketScan, pricesDue, recentSets } from "../refresh";
import { forecast } from "../forecast";
import { defaultSettings, newProfile, type CardSummary, type PriceSeries } from "../types";

const card = (o: Partial<CardSummary> & { id: string; name: string }): CardSummary => ({
  set: "old", setName: "Old", collectorNumber: "1", rarity: "rare", typeLine: "Creature — Human", cmc: 2, colors: ["G"], colorIdentity: ["G"],
  releasedAt: "2020-01-01", reserved: false, reprint: false, legalities: { commander: "legal" }, prices: { usd: 5 }, finishes: ["nonfoil"], fetchedAt: "", ...o,
});
const series = (...pts: [string, number][]): PriceSeries => pts;

describe("fast movers", () => {
  it("measures 1-day and 7-day change", () => {
    const s = series(["2026-10-20", 10], ["2026-10-26", 12], ["2026-10-27", 15]);
    expect(pctOver(s, 1)).toBeCloseTo(25);
    expect(pctOver(s, 7)).toBeCloseTo(50);
    expect(pctOver(series(["2026-10-01", 10], ["2026-10-27", 20]), 7)).toBeUndefined(); // too stale
  });
  it("flags spikes and crashes and ignores bulk", () => {
    const s = { spikePct1d: 15, spikePct7d: 25, moverMinPrice: 1 };
    const m = detectMovers([
      { cardId: "a", name: "Up", set: "x", finish: "nonfoil", series: series(["2026-10-26", 10], ["2026-10-27", 13]), tracked: true },
      { cardId: "b", name: "Down", set: "x", finish: "nonfoil", series: series(["2026-10-20", 20], ["2026-10-27", 12]), tracked: false },
      { cardId: "c", name: "Bulk", set: "x", finish: "nonfoil", series: series(["2026-10-26", 0.1], ["2026-10-27", 0.3]), tracked: false },
      { cardId: "d", name: "Calm", set: "x", finish: "nonfoil", series: series(["2026-10-26", 10], ["2026-10-27", 10.5]), tracked: false },
    ], s);
    expect(m.map((x) => [x.name, x.kind])).toEqual([["Down", "crash"], ["Up", "spike"]]);
  });
  it("raises an alert for your own spiking card once per day", () => {
    const p = newProfile("t");
    p.collection.push({ id: "i", cardId: "a", name: "Up", set: "x", collectorNumber: "1", finish: "nonfoil", condition: "NM", language: "en", quantity: 1, binder: "Main", addedAt: "" });
    p.priceHistory["a:nonfoil"] = series(["2026-10-26", 10]);
    const c = card({ id: "a", name: "Up", prices: { usd: 13 } });
    const n1 = applySnapshot(p, [c], new Date("2026-10-27T12:00:00Z"));
    expect(n1.alerts.filter((a) => a.kind === "spike")).toHaveLength(1);
    expect(n1.alerts[0].message).toContain("+30.0% today");
    const n2 = applySnapshot(n1, [c], new Date("2026-10-27T15:00:00Z"));
    expect(n2.alerts.filter((a) => a.kind === "spike")).toHaveLength(1);
  });
});

describe("synergy", () => {
  it("extracts themes and creature types", () => {
    const t = themesOf({ oracleText: "Whenever a creature you control dies, create a 1/1 Treasure token. Proliferate.", typeLine: "Creature", keywords: ["Proliferate", "Flying"] });
    expect([...t.keys()].sort()).toEqual(["kw:proliferate", "proliferate", "tokens", "treasure"]);
    expect(subtypes("Legendary Creature — Elf Druid")).toEqual(["Elf", "Druid"]);
    expect(plural("Elf")).toBe("Elves");
    expect(plural("Wizard")).toBe("Wizards");
  });
  it("ranks old cards that fit a new commander", () => {
    const newCommander = card({ id: "n1", name: "New Elf Lord", set: "new", typeLine: "Legendary Creature — Elf", colorIdentity: ["G", "B"], oracleText: "Other Elves you control get +1/+1. Whenever you put a +1/+1 counter on a creature, proliferate.", keywords: ["Proliferate"] });
    const elf = card({ id: "c1", name: "Old Elf", typeLine: "Creature — Elf Warrior", colorIdentity: ["G"], oracleText: "Put a +1/+1 counter on target creature.", edhrecRank: 500 });
    const offColor = card({ id: "c2", name: "Blue Elf", typeLine: "Creature — Elf Wizard", colorIdentity: ["U"], oracleText: "Draw a card." });
    const unrelated = card({ id: "c3", name: "Lightning Bolt", typeLine: "Instant", colorIdentity: ["R"], oracleText: "Lightning Bolt deals 3 damage to any target." });
    const picks = scoreSynergy([elf, offColor, unrelated], [newCommander], { minScore: 0.5 });
    expect(picks[0].name).toBe("Old Elf");
    expect(picks[0].reasons.join(" ")).toMatch(/Fits new commander New Elf Lord/);
    expect(picks.find((x) => x.name === "Lightning Bolt")).toBeUndefined();
    const off = picks.find((x) => x.name === "Blue Elf");
    expect(off === undefined || off.score < picks[0].score).toBe(true);
  });
  it("adds an 'Incoming synergy' forecast factor", () => {
    const c = card({ id: "c1", name: "Old Elf" });
    const f = forecast(c, [], 5, 30, new Date("2026-10-27"), { cardId: "c1", name: "Old Elf", set: "old", score: 5, reasons: ["Elf synergy: shared with 2 new cards"], sources: ["New Elf Lord"] })!;
    expect(f.factors.find((x) => x.label === "Incoming synergy")?.impactPct).toBe(4);
  });
});

describe("market scan + schedule", () => {
  it("records market history and finds movers and synergy", () => {
    const p = newProfile("t");
    const day1 = applyMarketScan(p, [card({ id: "u1", name: "Staple", prices: { usd: 10 } })], [], [], new Date("2026-10-26T12:00:00Z"));
    const day2 = applyMarketScan(day1, [card({ id: "u1", name: "Staple", prices: { usd: 14 } })], [], [], new Date("2026-10-27T12:00:00Z"));
    expect(day2.market!.history.u1).toEqual([["2026-10-26", 10], ["2026-10-27", 14]]);
    expect(day2.market!.movers[0]).toMatchObject({ cardId: "u1", kind: "spike", tracked: false });
  });
  it("is due once per calendar day", () => {
    const p = { ...newProfile("t"), settings: defaultSettings() };
    const now = new Date();
    expect(pricesDue({ ...p, lastPriceRefresh: now.toISOString() }, now)).toBe(false);
    expect(pricesDue({ ...p, lastPriceRefresh: new Date(now.getTime() - 26 * 3600_000).toISOString() }, now)).toBe(true);
  });
  it("picks recent and upcoming main sets", () => {
    const now = new Date("2026-10-27T00:00:00Z");
    const sets = recentSets([
      { code: "new", name: "New", released_at: "2026-11-15", set_type: "expansion", card_count: 250 },
      { code: "old", name: "Old", released_at: "2025-01-01", set_type: "expansion", card_count: 250 },
      { code: "tok", name: "Tokens", released_at: "2026-11-15", set_type: "token", card_count: 20 },
    ], now);
    expect(sets.map((s) => s.code)).toEqual(["new"]);
  });
});
