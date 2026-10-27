import { describe, expect, it } from "vitest";
import { parseLine, parseList, parseSetGrid } from "../batch";
import { csvToBatch, parseCsv } from "../csv";
import { forecast, reprintRisk, resolveForecasts, accuracy } from "../forecast";
import { atLeast, buylistValue, legality } from "../deckstats";
import { applySnapshot, change } from "../prices";
import { defaultSettings, newProfile, type CardSummary } from "../types";

const card = (o: Partial<CardSummary> = {}): CardSummary => ({
  id: "c1", name: "Test Card", set: "tst", setName: "Test", collectorNumber: "1", rarity: "rare",
  typeLine: "Artifact", cmc: 1, colors: [], colorIdentity: [], releasedAt: "2020-01-01", reserved: false,
  reprint: false, legalities: { commander: "legal" }, prices: { usd: 10 }, finishes: ["nonfoil", "foil"],
  fetchedAt: "", ...o,
});

describe("batch parsing", () => {
  it("parses quantities, sets, numbers and finishes", () => {
    expect(parseLine("4 Lightning Bolt")).toMatchObject({ quantity: 4, name: "Lightning Bolt", finish: "nonfoil" });
    expect(parseLine("4x Lightning Bolt")).toMatchObject({ quantity: 4, name: "Lightning Bolt" });
    expect(parseLine("1 Sol Ring (CMM) 410 *F*")).toMatchObject({ quantity: 1, name: "Sol Ring", set: "cmm", collectorNumber: "410", finish: "foil" });
    expect(parseLine("1 Sol Ring [CMM] #410 etched")).toMatchObject({ set: "cmm", collectorNumber: "410", finish: "etched" });
    expect(parseLine("Fire // Ice")).toMatchObject({ quantity: 1, name: "Fire // Ice" });
    expect(parseLine("2 Counterspell LP @ 1.50")).toMatchObject({ quantity: 2, name: "Counterspell", condition: "LP", purchasePrice: 1.5 });
    expect(parseLine("SB: 2 Duress")).toMatchObject({ board: "side", quantity: 2, name: "Duress" });
  });
  it("handles sections and arena sideboard blank line", () => {
    const l = parseList("Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring\n\n2 Negate");
    expect(l.map((x) => x.board)).toEqual(["commander", "main", "side"]);
  });
  it("set grid", () => {
    const g = parseSetGrid("DSK", "12, 45f, 3x88, 10-12, 101e");
    expect(g.map((x) => [x.collectorNumber, x.quantity, x.finish])).toEqual([
      ["12", 1, "nonfoil"], ["45", 1, "foil"], ["88", 3, "nonfoil"], ["10", 1, "nonfoil"], ["11", 1, "nonfoil"], ["12", 1, "nonfoil"], ["101", 1, "etched"],
    ]);
  });
});

describe("csv", () => {
  it("parses quoted cells", () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
  });
  it("maps Moxfield columns", () => {
    const csv = '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number"\n"2","0","Sol Ring","cmm","Near Mint","English","foil","","","410"';
    const { lines } = csvToBatch(csv);
    expect(lines[0]).toMatchObject({ quantity: 2, name: "Sol Ring", set: "cmm", collectorNumber: "410", finish: "foil", condition: "NM", language: "en" });
  });
  it("maps ManaBox columns with scryfall id", () => {
    const csv = "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language\nSol Ring,CMM,Commander Masters,410,normal,uncommon,3,1,abc-123,1.25,false,false,lightly_played,en";
    const { lines } = csvToBatch(csv);
    expect(lines[0]).toMatchObject({ quantity: 3, scryfallId: "abc-123", condition: "LP", purchasePrice: 1.25, finish: "nonfoil" });
  });
});

describe("forecast", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  it("detects an uptrend", () => {
    const series: [string, number][] = Array.from({ length: 20 }, (_, i) => [new Date(Date.UTC(2026, 9, 7 + i)).toISOString().slice(0, 10), 10 * 1.01 ** i]);
    const f = forecast(card(), series, undefined, 30, now)!;
    expect(f.factors.some((x) => x.label === "Upward trend")).toBe(true);
    expect(f.direction).toBe("up");
    expect(f.lowPct).toBeLessThan(f.expectedPct);
  });
  it("new set dip and reserved list", () => {
    const f = forecast(card({ releasedAt: "2026-10-10" }), [], 5, 30, now)!;
    expect(f.factors.find((x) => x.label === "New-set dip")).toBeTruthy();
    expect(reprintRisk(card({ reserved: true }), 500, now)).toBe(0);
    expect(forecast(card({ reserved: true }), [], 500, 30, now)!.factors.some((x) => x.label === "Reserved List")).toBe(true);
  });
  it("resolves logged forecasts and scores accuracy", () => {
    const log = resolveForecasts([{ cardId: "c1", finish: "nonfoil", madeOn: "2026-10-01", horizonDays: 7, startPrice: 10, expectedPct: 5 }], { "c1:nonfoil": [["2026-10-08", 11]] }, now);
    expect(log[0].resolvedPct).toBe(10);
    expect(accuracy(log)).toMatchObject({ count: 1, directionHitRate: 1 });
  });
});

describe("deck + buylist", () => {
  it("hypergeometric", () => {
    expect(atLeast(60, 4, 7, 1)).toBeCloseTo(0.3995, 3);
  });
  it("buylist", () => {
    expect(buylistValue(10, 50, "LP", defaultSettings())).toBe(4.5);
  });
  it("legality flags count and copies", () => {
    const issues = legality({ id: "d", name: "d", format: "modern", createdAt: "", updatedAt: "", cards: [{ cardId: "c1", name: "Test Card", quantity: 5, board: "main" }] }, { c1: card({ legalities: { modern: "legal" } }) });
    expect(issues.some((i) => i.includes("limit 4"))).toBe(true);
    expect(issues.some((i) => i.includes("needs 60"))).toBe(true);
  });
});

describe("snapshot", () => {
  it("records history, portfolio and alerts", () => {
    const p = newProfile("t");
    p.collection.push({ id: "i", cardId: "c1", name: "Test Card", set: "tst", collectorNumber: "1", finish: "nonfoil", condition: "NM", language: "en", quantity: 2, binder: "Main", addedAt: "" });
    p.watchlist.push({ id: "w", cardId: "c1", name: "Test Card", finish: "nonfoil", below: 12, addedAt: "" });
    const next = applySnapshot(p, [card()], new Date("2026-10-27T00:00:00Z"));
    expect(next.priceHistory["c1:nonfoil"]).toEqual([["2026-10-27", 10]]);
    expect(next.portfolioHistory).toEqual([["2026-10-27", 20]]);
    expect(next.alerts).toHaveLength(1);
    const again = applySnapshot(next, [card()], new Date("2026-10-27T05:00:00Z"));
    expect(again.alerts).toHaveLength(1);
    expect(change([["2026-10-01", 10], ["2026-10-20", 12]], 7)).toBeCloseTo(20);
  });
});
