import { describe, expect, it } from "vitest";
import {
  cheapestReprint, compareDrop, compareSummary, countdown, dropState, dropValue, dueQueueNotice, dueReminder, etaText, groupDrops, isUpcoming, launchUrl, newDrop,
  pastDropTrend, queueEstimate, STORE_URL, upcomingGroups, parseCalendar, isSecretLairSet, nameKey, buildCatalogGroups, attachCards, sortGroups, sortDrops,
} from "../secretlair";
import { mergeProfiles, forSync } from "../sync";
import { trackedIds } from "../prices";
import { newProfile, type CardSummary, type QueueLog } from "../types";

const start = "2026-11-01T17:00:00.000Z";
const at = (iso: string) => new Date(iso);

describe("sale reminders", () => {
  it("fires only the latest due reminder and skips stale ones", () => {
    const d = newDrop("Test Drop", { saleStart: start });
    expect(dueReminder(d, at("2026-10-30T17:00:00Z"))).toBeNull();
    expect(dueReminder(d, at("2026-10-31T17:30:00Z"))?.key).toBe("24h");
    const r = dueReminder(d, at("2026-11-01T16:50:00Z"))!;
    expect(r.key).toBe("15m");
    expect(r.skip).toEqual(["24h", "1h"]);
    expect(dueReminder({ ...d, remindersSent: ["24h", "1h", "15m"] }, at("2026-11-01T16:50:00Z"))).toBeNull();
    expect(dueReminder(d, at("2026-11-01T17:00:05Z"))?.key).toBe("open");
    expect(dueReminder(d, at("2026-11-01T20:00:00Z"))).toBeNull(); // long past
    expect(dueReminder({ ...d, marked: false }, at("2026-11-01T17:00:05Z"))).toBeNull();
  });
  it("counts down and tracks state", () => {
    expect(countdown(start, at("2026-10-30T15:00:00Z"))).toBe("2d 2h");
    expect(countdown(start, at("2026-11-01T15:54:30Z"))).toBe("1h 05m");
    expect(countdown(start, at("2026-11-01T16:55:51Z"))).toBe("4m 09s");
    expect(countdown(start, at("2026-11-01T17:00:00Z"))).toBe("Live now");
    const d = newDrop("x", { saleStart: start });
    expect(dropState(d, at("2026-11-01T16:30:00Z"))).toBe("soon");
    expect(dropState(d, at("2026-11-01T17:01:00Z"))).toBe("live");
    expect(dropState(newDrop("x"), at(start))).toBe("unscheduled");
  });
  it("opens the drop link, or the store front for unsafe or missing links", () => {
    expect(launchUrl({ url: "https://secretlair.wizards.com/us/product/123" })).toBe("https://secretlair.wizards.com/us/product/123");
    expect(launchUrl({ url: "javascript:alert(1)" })).toBe(STORE_URL);
    expect(launchUrl({})).toBe(STORE_URL);
  });
});

describe("place in line", () => {
  const q = (pts: [string, number][]): QueueLog => ({ startedAt: pts[0][0], entries: pts, notified: [] });
  it("estimates speed and wait from readings", () => {
    const log = q([["2026-11-01T17:00:00Z", 12000], ["2026-11-01T17:02:00Z", 10000], ["2026-11-01T17:04:00Z", 8000]]);
    const est = queueEstimate(log, at("2026-11-01T17:04:00Z"))!;
    expect(est.perMinute).toBe(1000);
    expect(est.etaMinutes).toBe(8);
    expect(etaText(est)).toContain("about 8 min");
    expect(dueQueueNotice(log, est)).toBeNull();
    const soon = queueEstimate(log, at("2026-11-01T17:08:30Z"))!;
    expect(soon.etaMinutes).toBe(3.5);
    expect(dueQueueNotice(log, soon)?.key).toBe("soon");
    expect(dueQueueNotice({ ...log, notified: ["soon"] }, queueEstimate(log, at("2026-11-01T17:11:30Z")))?.key).toBe("near");
  });
  it("handles a single reading and a stalled line", () => {
    expect(etaText(queueEstimate(q([["2026-11-01T17:00:00Z", 500]]))!)).toContain("Add another reading");
    const stalled = queueEstimate(q([["2026-11-01T17:00:00Z", 500], ["2026-11-01T17:02:00Z", 500]]))!;
    expect(etaText(stalled)).toContain("isn't moving");
  });
});

describe("catalog and value", () => {
  const card = (id: string, cn: string, rel: string, usd?: number, foil?: number): CardSummary => ({
    id, name: `Card ${id}`, set: "sld", setName: "Secret Lair Drop", collectorNumber: cn, rarity: "rare", typeLine: "Creature", cmc: 1, colors: [], colorIdentity: [],
    releasedAt: rel, reserved: false, reprint: true, legalities: {}, prices: { usd, usdFoil: foil }, finishes: ["nonfoil", "foil"], fetchedAt: "",
  });
  it("groups by release date and consecutive collector numbers", () => {
    const g = groupDrops([card("a", "100", "2026-10-01"), card("b", "101", "2026-10-01"), card("c", "105", "2026-10-01"), card("d", "106", "2026-11-01"), card("e", "★1", "2026-11-01")]);
    expect(g.map((x) => x.cardIds)).toEqual([["d"], ["c"], ["a", "b"]]);
  });
  it("sums card values", () => {
    const cards = { a: card("a", "1", "x", 5, 12), b: card("b", "2", "x", 3) };
    expect(dropValue(["a", "b", "z"], cards)).toEqual({ total: 8, priced: 2 });
    expect(dropValue(["a", "b"], cards, "foil").total).toBe(15);
  });
  it("tracks followed drops' cards and syncs drops but not the catalog", () => {
    const p = newProfile("t");
    p.secretLair = [newDrop("D", { cardIds: ["a", "b"], marked: true }), newDrop("E", { cardIds: ["z"], marked: false })];
    p.secretLairCatalog = { cards: {}, groups: [], fetchedAt: "" };
    expect(trackedIds(p).sort()).toEqual(["a", "b"]);
    const s = forSync(p);
    expect("secretLairCatalog" in s).toBe(false);
    const remote = { ...s, secretLair: [...s.secretLair!, newDrop("F")], updatedAt: "2099-01-01" };
    expect(mergeProfiles(s, s, remote).secretLair).toHaveLength(3);
  });
});

describe("upcoming drops and price comparison", () => {
  const card = (id: string, cn: string, rel: string, extra: Partial<CardSummary> = {}): CardSummary => ({
    id, oracleId: `o-${id}`, name: `Card ${id}`, set: "sld", setName: "Secret Lair Drop", collectorNumber: cn, rarity: "rare", typeLine: "Creature", cmc: 1, colors: [], colorIdentity: [],
    releasedAt: rel, reserved: false, reprint: true, legalities: {}, prices: {}, finishes: ["nonfoil", "foil"], fetchedAt: "", ...extra,
  });
  const NOW = new Date("2026-10-28T12:00:00Z");

  it("picks up the announcement from card previews", () => {
    const g = groupDrops([
      card("a", "200", "2026-11-20", { preview: { source: "Wizards", url: "https://magic.wizards.com/en/news/sl", at: "2026-10-20" } }),
      card("b", "201", "2026-11-20", { preview: { at: "2026-10-19" } }),
    ]);
    expect(g[0]).toMatchObject({ announcedAt: "2026-10-19", announcementUrl: "https://magic.wizards.com/en/news/sl", announcementSource: "Wizards" });
  });

  it("lists announced and recent drops soonest first", () => {
    const groups = groupDrops([card("old", "1", "2026-01-01"), card("recent", "50", "2026-10-15"), card("next", "90", "2026-12-01"), card("soon", "80", "2026-11-05")]);
    expect(upcomingGroups(groups, NOW).map((g) => g.cardIds[0])).toEqual(["recent", "soon", "next"]);
    expect(isUpcoming({ releasedAt: "2026-11-05" }, NOW)).toBe(true);
    expect(isUpcoming({ releasedAt: "2026-10-15" }, NOW)).toBe(false);
  });

  it("finds the cheapest copies outside Secret Lair", () => {
    const r = cheapestReprint([
      card("x", "1", "", { set: "sld", prices: { usd: 1 } }),
      card("y", "1", "", { set: "m21", setName: "Core 2021", prices: { usd: 4, usdFoil: 9 } }),
      card("z", "1", "", { set: "cmr", setName: "Commander Legends", prices: { usd: 2.5 } }),
    ], NOW);
    expect(r).toMatchObject({ usd: 2.5, usdFoil: 9, setName: "Commander Legends", printings: 2 });
    expect(cheapestReprint([], NOW).printings).toBe(0);
    expect(cheapestReprint([card("k", "1", "", { set: "slm", prices: { usd: 1 } })], NOW, ["sld", "slm"]).printings).toBe(0);
  });

  it("compares the drop price with the Secret Lair market and other printings", () => {
    const cards = { a: card("a", "1", "", { prices: { usd: 20 } }), b: card("b", "2", "", { prices: { usd: 15 } }), c: card("c", "3", "", { prices: { usd: 5 } }) };
    const reprints = { "o-a": { usd: 8, printings: 3, setName: "Set A", fetchedAt: "" }, "o-b": { usd: 2, printings: 1, fetchedAt: "" }, "o-c": { printings: 0, fetchedAt: "" } };
    const c = compareDrop(["a", "b", "c"], cards, reprints);
    expect(c).toMatchObject({ price: 29.99, priceIsTypical: true, sldTotal: 40, sldPriced: 3, reprintTotal: 10, reprintPriced: 2, newCards: 1, premium: 19.99, marketGap: 10.01 });
    expect(compareSummary(c)).toBe("Secret Lair copies trade $10.01 above the price; the cards cost $19.99 less in other printings (2 of 3 cards); 1 new card with no other printing.");
    const f = compareDrop(["a"], cards, reprints, { finish: "foil", price: 5 });
    expect(f).toMatchObject({ price: 5, priceIsTypical: false, premium: -3 });
    expect(compareSummary(compareDrop(["a"], { a: card("a", "1", "") }, {}))).toMatch(/No prices yet/);
  });

  it("measures how past drops held value", () => {
    const cards: Record<string, CardSummary> = {};
    const groups = [];
    for (let i = 0; i < 3; i++) {
      const a = card(`p${i}a`, `${i * 10}`, "2026-03-01", { prices: { usd: 10 + i * 10 } });
      const b = card(`p${i}b`, `${i * 10 + 1}`, "2026-03-01", { prices: { usd: 10 } });
      cards[a.id] = a;
      cards[b.id] = b;
      groups.push({ key: `g${i}`, name: "", releasedAt: "2026-03-01", cardIds: [a.id, b.id] });
    }
    const t = pastDropTrend({ cards, groups, fetchedAt: "" }, NOW)!;
    expect(t.drops).toBe(3);
    expect(t.median).toBeCloseTo(30 / 29.99, 3);
    expect(pastDropTrend({ cards, groups: groups.slice(0, 2), fetchedAt: "" }, NOW)).toBeNull();
  });
});

describe("more drop sources and sorting", () => {
  const card = (id: string, cn: string, rel: string, extra: Partial<CardSummary> = {}): CardSummary => ({
    id, oracleId: `o-${id}`, name: `Card ${id}`, set: "sld", setName: "Secret Lair Drop", collectorNumber: cn, rarity: "rare", typeLine: "Creature", cmc: 1, colors: [], colorIdentity: [],
    releasedAt: rel, reserved: false, reprint: true, legalities: {}, prices: {}, finishes: ["nonfoil"], fetchedAt: "", ...extra,
  });
  const marvelCal = {
    drops: [
      { id: "marvel-kit", name: "Secret Lair Countdown Kit: Marvel's History of Heroes", saleStart: "2026-11-02T17:00:00Z", price: 199.99, cards: 30, announcementUrl: "https://magic.wizards.com/en/news/x" },
      { id: "doom", name: "Doomsdrop", releaseDate: "2026-11-16", tentative: true, url: "javascript:alert(1)" },
      { id: "bad" },
      { id: "nodate", name: "No date" },
    ],
  };

  it("validates the drop calendar", () => {
    const cal = parseCalendar(marvelCal);
    expect(cal.map((c) => c.id)).toEqual(["marvel-kit", "doom"]);
    expect(cal[0]).toMatchObject({ saleStart: "2026-11-02T17:00:00.000Z", price: 199.99, cards: 30 });
    expect(cal[1]).toMatchObject({ tentative: true, url: undefined });
    expect(parseCalendar(null)).toEqual([]);
  });

  it("finds Secret Lair sets beyond sld", () => {
    expect(isSecretLairSet({ code: "slc", name: "Secret Lair 30th Anniversary Countdown Kit" })).toBe(true);
    expect(isSecretLairSet({ code: "sld", name: "Secret Lair Drop" })).toBe(false);
    expect(isSecretLairSet({ code: "pslp", name: "Secret Lair Showdown" })).toBe(false);
    expect(isSecretLairSet({ code: "slx", name: "Secret Lair Kit", digital: true })).toBe(false);
    expect(nameKey("Secret Lair Countdown Kit: Marvel's History of Heroes")).toBe("marvel s history of heroes");
  });

  it("merges Scryfall drops, kit sets and the calendar", () => {
    const cards = [card("a", "100", "2026-10-01"), card("k1", "1", "2026-11-02", { set: "slm" }), card("k2", "2", "2026-11-02", { set: "slm" })];
    const sets = [{ code: "slm", name: "Secret Lair Countdown Kit: Marvel's History of Heroes", releasedAt: "2026-11-02" }, { code: "sle", name: "Secret Lair Empty Kit", releasedAt: "2026-12-01" }];
    const g = buildCatalogGroups(cards, sets, parseCalendar(marvelCal));
    const kit = g.find((x) => x.key === "set:slm")!;
    expect(kit).toMatchObject({ cardIds: ["k1", "k2"], price: 199.99, saleStart: "2026-11-02T17:00:00.000Z", sources: ["scryfall", "calendar"], announcementUrl: "https://magic.wizards.com/en/news/x" });
    expect(g.find((x) => x.key === "set:sle")!.cardIds).toEqual([]);
    expect(g.find((x) => x.key === "cal:doom")).toMatchObject({ releasedAt: "2026-11-16", tentative: true, sources: ["calendar"] });
    expect(g.map((x) => x.key)).toEqual(["set:sle", "cal:doom", "set:slm", "2026-10-01#100"]);
  });

  it("attaches cards to drops followed before Scryfall listed them", () => {
    const groups = buildCatalogGroups([card("k1", "1", "2026-11-02", { set: "slm" })], [{ code: "slm", name: "Secret Lair Countdown Kit: Marvel's History of Heroes" }]);
    const d = newDrop("Secret Lair Countdown Kit: Marvel's History of Heroes");
    expect(attachCards([d], groups)[0].cardIds).toEqual(["k1"]);
    const other = newDrop("Something else");
    const same = [other];
    expect(attachCards(same, groups)).toBe(same);
  });

  it("sorts drops several ways", () => {
    const cards = { a: card("a", "1", "", { prices: { usd: 50 } }), b: card("b", "2", "", { prices: { usd: 10 } }) };
    const groups = [
      { key: "x", name: "Zed", releasedAt: "2026-11-20", cardIds: ["b"], announcedAt: "2026-10-01" },
      { key: "y", name: "Alpha", releasedAt: "2026-11-05", cardIds: ["a"], announcedAt: "2026-10-20", price: 39.99 },
      { key: "z", name: "Mid", releasedAt: "2026-11-10", cardIds: [], saleStart: "2026-11-02T17:00:00Z", price: 199.99 },
    ];
    const ctx = { cards };
    const order = (by: Parameters<typeof sortGroups>[1]) => sortGroups(groups, by, ctx).map((g) => g.key);
    expect(order("soonest")).toEqual(["z", "y", "x"]);
    expect(order("latest")).toEqual(["x", "y", "z"]);
    expect(order("name")).toEqual(["y", "z", "x"]);
    expect(order("value")).toEqual(["y", "x", "z"]);
    expect(order("price")).toEqual(["y", "z", "x"]);
    expect(order("announced")).toEqual(["y", "x", "z"]);
    expect(order("deal")).toEqual(["y", "x", "z"]); // y: +10.01 over price, x: -19.99, z: no cards
    const d1 = { ...newDrop("B"), saleStart: "2026-12-01T00:00:00Z", createdAt: "2026-10-01" };
    const d2 = { ...newDrop("A"), saleStart: "2026-11-01T00:00:00Z", createdAt: "2026-10-05", checklist: { account: true } };
    expect(sortDrops([d1, d2], "sale").map((d) => d.name)).toEqual(["A", "B"]);
    expect(sortDrops([d1, d2], "name").map((d) => d.name)).toEqual(["A", "B"]);
    expect(sortDrops([d1, d2], "added").map((d) => d.name)).toEqual(["A", "B"]);
    expect(sortDrops([d1, d2], "ready").map((d) => d.name)).toEqual(["B", "A"]);
  });
});
