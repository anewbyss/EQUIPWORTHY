import { describe, expect, it, vi } from "vitest";
import { icsFor, newDrop, plannedReminders } from "../secretlair";
import { newTopic, ntfyPlan, ntfySend, smsPayload } from "../channels";
import { newProfile } from "../types";

const start = "2026-11-01T17:00:00.000Z";
const drop = () => newDrop("Cat Drop", { id: "d1", saleStart: start, url: "https://secretlair.wizards.com/us/product/1" });

describe("reminder plan", () => {
  it("lists only future reminders for followed drops", () => {
    const r = plannedReminders(drop(), new Date("2026-11-01T16:30:00Z"));
    expect(r.map((x) => x.key)).toEqual(["15m", "5m", "open"]);
    expect(r[2]).toMatchObject({ id: "d1-open", at: start, url: "https://secretlair.wizards.com/us/product/1", title: "Secret Lair drop is live" });
    expect(plannedReminders({ ...drop(), marked: false })).toEqual([]);
    expect(plannedReminders({ ...drop(), owned: { finish: "nonfoil", quantity: 1 } }, new Date("2026-10-01"))).toEqual([]);
  });
  it("builds a calendar event with five alerts and the link", () => {
    const ics = icsFor({ ...drop(), name: "Cats, Dogs; More" }, new Date("2026-10-28T00:00:00Z"))!;
    expect(ics).toContain("DTSTART:20261101T170000Z");
    expect(ics).toContain("SUMMARY:Secret Lair: Cats\\, Dogs\\; More");
    expect(ics).toContain("URL:https://secretlair.wizards.com/us/product/1");
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(5);
    expect(ics).toContain("TRIGGER:-PT1440M");
    expect(ics).toContain("TRIGGER:-PT0M");
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
  });
});

describe("ntfy", () => {
  it("schedules only within 3 days and never twice", () => {
    const d = drop();
    expect(ntfyPlan(d, new Date("2026-10-25T00:00:00Z"))).toEqual([]); // all > 3 days out
    const plan = ntfyPlan(d, new Date("2026-10-30T00:00:00Z"));
    expect(plan.map((x) => x.reminder.key)).toEqual(["24h", "1h", "15m", "5m", "open"]);
    const done = { ...d, pushScheduled: plan.slice(0, 2).map((x) => x.tag) };
    expect(ntfyPlan(done, new Date("2026-10-30T00:00:00Z")).map((x) => x.reminder.key)).toEqual(["15m", "5m", "open"]);
    // Moving the sale time schedules fresh reminders
    expect(ntfyPlan({ ...done, saleStart: "2026-11-01T18:00:00.000Z" }, new Date("2026-10-30T00:00:00Z"))).toHaveLength(5);
  });
  it("posts with a delivery time and a tap-through link", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await ntfySend({ ntfyServer: "https://ntfy.sh/", ntfyTopic: "equipworthy-abc" }, { title: "T", body: "B", url: "https://x.example", at: start }, f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ntfy.sh/equipworthy-abc");
    expect((init.headers as Record<string, string>).At).toBe(String(Date.parse(start) / 1000));
    expect((init.headers as Record<string, string>).Click).toBe("https://x.example");
    expect(newTopic()).toMatch(/^equipworthy-[a-z0-9]{18}$/);
  });
});

describe("text messages", () => {
  it("sends every future reminder and removes ones no longer needed", () => {
    const p = newProfile("t");
    p.secretLair = [drop()];
    const r = smsPayload(p, ["d1-24h", "gone-5m"], new Date("2026-11-01T16:00:00Z"));
    expect(r.reminders.map((x) => x.id)).toEqual(["d1-15m", "d1-5m", "d1-open"]);
    expect(r.reminders[0].body).toMatch(/^Secret Lair reminder: Cat Drop in 15 minutes/);
    expect(r.remove).toEqual(["d1-24h", "gone-5m"]);
  });
});
