import { describe, expect, it, vi } from "vitest";
import { handle, safeEqual, sendDue, validateReminder } from "../src/index.js";

function kv() {
  const m = new Map();
  return {
    m,
    get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    list: async () => ({ keys: [...m.keys()].map((name) => ({ name })), list_complete: true }),
  };
}
const env = () => ({ REMINDERS: kv(), APP_KEY: "k".repeat(32), TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15550000000", TO_NUMBER: "+15551112222" });
const req = (path, init = {}) => new Request(`https://w.example${path}`, init);
const auth = (e) => ({ Authorization: `Bearer ${e.APP_KEY}`, "Content-Type": "application/json" });
const NOW = Date.parse("2026-11-01T16:00:00Z");

describe("worker", () => {
  it("rejects requests without the app key", async () => {
    const e = env();
    expect((await handle(req("/reminders", { method: "POST", body: "{}" }), e, NOW)).status).toBe(401);
    expect((await handle(req("/reminders", { method: "POST", body: "{}", headers: { Authorization: "Bearer wrong" } }), e, NOW)).status).toBe(401);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
  });

  it("validates reminders and appends safe links", () => {
    expect(validateReminder({ id: "d1-5m", at: "2026-11-01T16:55:00Z", body: "Soon", url: "https://secretlair.wizards.com/x" }, NOW)).toEqual({
      id: "d1-5m", at: "2026-11-01T16:55:00.000Z", body: "Soon\nhttps://secretlair.wizards.com/x",
    });
    expect(validateReminder({ id: "bad id!", at: "2026-11-01T16:55:00Z", body: "x" }, NOW)).toBe("bad id");
    expect(validateReminder({ id: "a", at: "nope", body: "x" }, NOW)).toBe("bad time");
    expect(validateReminder({ id: "a", at: "2030-01-01T00:00:00Z", body: "x" }, NOW)).toBe("too far ahead");
    expect(validateReminder({ id: "a", at: "2026-11-01T16:55:00Z", body: "x", url: "javascript:1" }, NOW).body).toBe("x");
  });

  it("stores, replaces and removes reminders, then sends due ones once", async () => {
    const e = env();
    const post = (body) => handle(req("/reminders", { method: "POST", headers: auth(e), body: JSON.stringify(body) }), e, NOW);
    let r = await (await post({ reminders: [{ id: "d1-5m", at: "2026-11-01T16:55:00Z", body: "Five minutes" }, { id: "d1-open", at: "2026-11-01T17:00:00Z", body: "Live" }, { id: "d2-1h", at: "2026-11-01T18:00:00Z", body: "x" }] })).json();
    expect(r.saved).toHaveLength(3);
    r = await (await post({ reminders: [{ id: "d1-5m", at: "2026-11-01T16:56:00Z", body: "Five minutes (moved)" }], remove: ["d2-1h"] })).json();
    const stored = () => Object.keys(JSON.parse(e.REMINDERS.m.get("schedule")));
    expect(stored()).toEqual(["d1-5m", "d1-open"]);

    const fetcher = vi.fn(async () => new Response("{}", { status: 201 }));
    expect(await sendDue(e, Date.parse("2026-11-01T16:55:30Z"), fetcher)).toBe(0);
    expect(await sendDue(e, Date.parse("2026-11-01T16:56:10Z"), fetcher)).toBe(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toContain("/Accounts/AC1/Messages.json");
    expect(new URLSearchParams(init.body).get("To")).toBe("+15551112222");
    expect(new URLSearchParams(init.body).get("Body")).toBe("Five minutes (moved)");
    expect(await sendDue(e, Date.parse("2026-11-01T16:57:00Z"), fetcher)).toBe(0); // not re-sent
    expect(await sendDue(e, Date.parse("2026-11-01T21:00:00Z"), fetcher)).toBe(0); // 4h late: dropped, not sent
    expect(stored()).toEqual([]);
  });

  it("keeps a reminder when Twilio fails and retries it", async () => {
    const e = env();
    await handle(req("/reminders", { method: "POST", headers: auth(e), body: JSON.stringify({ reminders: [{ id: "d1-open", at: "2026-11-01T17:00:00Z", body: "Live" }] }) }), e, NOW);
    const down = vi.fn(async () => new Response("busy", { status: 503 }));
    expect(await sendDue(e, Date.parse("2026-11-01T17:00:10Z"), down)).toBe(0);
    const up = vi.fn(async () => new Response("{}", { status: 201 }));
    expect(await sendDue(e, Date.parse("2026-11-01T17:01:10Z"), up)).toBe(1);
  });

  it("reports health without auth", async () => {
    const r = await (await handle(req("/health"), env(), NOW)).json();
    expect(r).toEqual({ ok: true, configured: true });
  });
});
