import { describe, expect, it } from "vitest";
import { cleanName, parseCollectorLine, similarity } from "../scanparse";
import { commitRows } from "../pending";
import { newProfile, type CardSummary } from "../types";

describe("scan parsing", () => {
  it("cleans OCR'd names", () => {
    expect(cleanName("Sol Ring  1\n")).toBe("Sol Ring");
    expect(cleanName("~Lightning Bolt® R\n")).toBe("Lightning Bolt");
    expect(cleanName("Atraxa, Praetors' Voice")).toBe("Atraxa, Praetors' Voice");
  });
  it("reads modern collector lines", () => {
    expect(parseCollectorLine("U 0410\nCMM • EN  Jeff Laubenstein")).toEqual({ set: "cmm", collectorNumber: "410" });
    expect(parseCollectorLine("123/281 R\nDSK · EN")).toEqual({ set: "dsk", collectorNumber: "123" });
    expect(parseCollectorLine("0278 M\nMH3 EN")).toEqual({ set: "mh3", collectorNumber: "278" });
  });
  it("similarity", () => {
    expect(similarity("Sol Rinq", "Sol Ring")).toBeGreaterThan(0.6);
    expect(similarity("Sol Ring", "Counterspell")).toBeLessThan(0.3);
  });
});

describe("batch commit", () => {
  it("merges into collection and records history", () => {
    const p = newProfile("t");
    const card = { id: "c1", name: "Sol Ring", set: "cmm", collectorNumber: "410", finishes: ["nonfoil"], prices: { usd: 2 }, legalities: {}, colors: [], colorIdentity: [], cmc: 1, typeLine: "Artifact", rarity: "uncommon", setName: "", releasedAt: "2023-08-04", reserved: false, reprint: true, fetchedAt: "" } as CardSummary;
    p.cardCache.c1 = card;
    p.pendingBatch = [
      { key: "a", raw: "", status: "ok", cardId: "c1", name: "Sol Ring", set: "cmm", collectorNumber: "410", finish: "nonfoil", condition: "NM", language: "en", quantity: 2, source: "list" },
      { key: "b", raw: "", status: "notfound", name: "Zzz", finish: "nonfoil", condition: "NM", language: "en", quantity: 1, source: "list" },
    ];
    const once = commitRows(p, new Set(["a", "b"]), { kind: "collection", binder: "Main" });
    expect(once.collection).toHaveLength(1);
    expect(once.collection[0].quantity).toBe(2);
    expect(once.pendingBatch).toHaveLength(1);
    expect(once.priceHistory["c1:nonfoil"]).toHaveLength(1);
  });
});
