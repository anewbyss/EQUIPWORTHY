import { describe, expect, it } from "vitest";
import { applyFeed, feedChange, feedDue, parseFeed, personalSignals } from "../market";
import { newProfile, uid, type CardSummary, type MarketFeed } from "../types";

const ID = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const card = (n: number, oracle: string): CardSummary => ({
  id: ID(n), oracleId: oracle, name: `Card ${n}`, set: "abc", setName: "ABC", collectorNumber: "1", rarity: "rare", typeLine: "Creature", cmc: 1,
  colors: [], colorIdentity: [], releasedAt: "2020-01-01", reserved: false, reprint: false, legalities: {}, prices: { usd: 5 }, finishes: ["nonfoil"], fetchedAt: "",
});

const raw = {
  generatedAt: "2026-10-28T15:40:00Z", date: "2026-10-28", scanned: 98000, historyDays: 9,
  entries: [
    { id: ID(1), finish: "nonfoil", name: "Card 1", oracleId: "o1", set: "abc", price: 20, d1: 100, d7: 120, avg30: 11, lists: ["up1", "up7", "sell"], signal: "sell", tcgplayer: "https://tcg/1" },
    { id: ID(9), finish: "foil", name: "Card 2", oracleId: "o2", set: "xyz", price: 30, d1: 40, lists: ["up1"] }, // another printing of a card you own
    { id: ID(3), finish: "nonfoil", name: "Card 3", oracleId: "o3", set: "abc", price: 25, d7: -37.5, avg30: 38, lists: ["down7", "buy"], signal: "buy" },
    { id: ID(4), finish: "nonfoil", name: "Card 4", oracleId: "o4", set: "abc", price: 8, d1: -20, lists: ["down1"] }, // not yours
    { id: "not-a-uuid", name: "Bad", price: 1, lists: [] },
    { id: ID(5), name: "Weird", price: 3, lists: ["up1", "evil"], image: "javascript:alert(1)" },
  ],
};

describe("all-cards market feed", () => {
  it("validates the feed", () => {
    const f = parseFeed(raw)!;
    expect(f.entries.map((e) => e.name)).toEqual(["Card 1", "Card 2", "Card 3", "Card 4", "Weird"]);
    expect(f.entries[4]).toMatchObject({ lists: ["up1"], image: undefined, finish: "nonfoil" });
    expect(parseFeed({ nope: 1 })).toBeNull();
    expect(feedChange({ d1: 100, d7: 120 })).toBe("+100% today, +120% this week");
    expect(feedChange({ d7: -37.5 })).toBe("-38% this week");
  });

  it("finds hot sells in your collection and buy dips on cards you want", () => {
    const p = newProfile("t");
    p.cardCache = { [ID(1)]: card(1, "o1"), [ID(2)]: card(2, "o2"), [ID(3)]: card(3, "o3") };
    p.collection = [
      { id: uid(), cardId: ID(1), name: "Card 1", set: "abc", collectorNumber: "1", finish: "nonfoil", condition: "NM", language: "en", quantity: 3, addedAt: "" } as never,
      { id: uid(), cardId: ID(2), name: "Card 2", set: "abc", collectorNumber: "2", finish: "nonfoil", condition: "NM", language: "en", quantity: 1, addedAt: "" } as never,
    ];
    p.watchlist = [{ id: uid(), cardId: ID(3), name: "Card 3", finish: "nonfoil", addedAt: "" }];
    const feed = parseFeed(raw) as MarketFeed;
    const s = personalSignals(p, feed);
    expect(s.map((x) => [x.kind, x.entry.name, x.samePrint])).toEqual([["sell", "Card 1", true], ["buy", "Card 3", true], ["sell", "Card 2", false]]);
    expect(s[0].message).toBe("Hot sell: Card 1 (ABC) is +100% today, +120% this week, now $20.00. You own 3 (about $60.00).");
    expect(s[1].message).toContain("It's on your watchlist");
    expect(s[2].message).toContain("You own another printing of Card 2");

    const now = new Date("2026-10-28T16:00:00Z");
    const r1 = applyFeed(p, feed, now);
    expect(r1.fresh).toHaveLength(3);
    expect(r1.profile.alerts.map((a) => a.kind)).toEqual(["sell", "buy", "sell"]);
    expect(r1.digest).toEqual([]); // scope "mine"
    const r2 = applyFeed(r1.profile, feed, now);
    expect(r2.fresh).toHaveLength(0); // told once per day
    const all = { ...r1.profile, settings: { ...r1.profile.settings, signalScope: "all" as const } };
    expect(applyFeed(all, feed, now).digest.map((e) => e.name)).toEqual([]); // the top signals are already yours
    const off = { ...p, settings: { ...p.settings, signalScope: "off" as const } };
    expect(applyFeed(off, feed, now).fresh).toHaveLength(0);
    expect(feedDue(r1.profile, new Date("2026-10-28T17:00:00Z"))).toBe(false);
    expect(feedDue(r1.profile, new Date("2026-10-28T20:00:00Z"))).toBe(true);
  });
});
