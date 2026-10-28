import { describe, expect, it } from "vitest";
import { countdown, dropState, dropValue, dueQueueNotice, dueReminder, etaText, groupDrops, launchUrl, newDrop, queueEstimate, STORE_URL } from "../secretlair";
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
