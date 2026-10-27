import { afterEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, forSync, mergeList, mergeProfiles, stable, syncOnce, WrongPassphrase, type SyncedProfile } from "../sync";
import { newProfile, type CollectionItem } from "../types";

const item = (id: string, qty = 1): CollectionItem => ({ id, cardId: "c" + id, name: "Card " + id, set: "tst", collectorNumber: id, finish: "nonfoil", condition: "NM", language: "en", quantity: qty, binder: "Main", addedAt: "2026-10-27T00:00:00.000Z" });

describe("three-way merge", () => {
  const key = (x: { id: string }) => x.id;
  it("keeps adds from both sides, applies edits and deletes", () => {
    const base = [item("a"), item("b"), item("c")];
    const local = [item("a", 5), item("b"), item("d")]; // edit a, delete c, add d
    const remote = [item("a"), item("c"), item("e")]; // delete b, add e
    const m = mergeList(base, local, remote, key, true);
    expect(m.map((x) => `${x.id}${x.quantity}`).sort()).toEqual(["a5", "d1", "e1"]);
  });
  it("first sync with no base unions everything", () => {
    expect(mergeList(undefined, [item("a")], [item("b")], key, true).map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("conflicting edits: newer profile wins", () => {
    const base = [item("a", 1)];
    expect(mergeList(base, [item("a", 2)], [item("a", 3)], key, false)[0].quantity).toBe(3);
  });
  it("stable stringify ignores key order and undefined", () => {
    expect(stable({ b: 1, a: [1, { y: 2, x: undefined }] })).toBe(stable({ a: [1, { y: 2 }], b: 1 }));
  });
  it("merges price history by date", () => {
    const a = forSync(newProfile("x"));
    const b = { ...a, priceHistory: { "c1:nonfoil": [["2026-10-02", 2]] }, updatedAt: "2026-10-28" } as SyncedProfile;
    const l = { ...a, priceHistory: { "c1:nonfoil": [["2026-10-01", 1]] } } as SyncedProfile;
    expect(mergeProfiles(undefined, l, b).priceHistory["c1:nonfoil"]).toEqual([["2026-10-01", 1], ["2026-10-02", 2]]);
  });
});

describe("encryption", () => {
  it("round-trips and rejects the wrong passphrase", async () => {
    const p = forSync(newProfile("Enc"));
    const env = await encrypt(p, "correct horse", { iter: 1000 });
    expect(env.data).not.toContain("Enc");
    expect(await decrypt(env, "correct horse")).toEqual(p);
    await expect(decrypt(env, "wrong")).rejects.toBeInstanceOf(WrongPassphrase);
  });
});

// In-memory GitHub Gist API so two "devices" can sync against it.
function fakeGitHub() {
  const gists: Record<string, { id: string; description: string; files: Record<string, { filename: string; content: string; raw_url: string }> }> = {};
  let n = 0;
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (u.pathname === "/gists" && init.method === "POST") {
      const id = `g${++n}`;
      gists[id] = { id, description: body.description, files: {} };
      for (const [k, v] of Object.entries(body.files as Record<string, { content: string }>)) gists[id].files[k] = { filename: k, content: v.content, raw_url: "" };
      return json(gists[id]);
    }
    if (u.pathname === "/gists") return json(Object.values(gists));
    const id = u.pathname.split("/")[2];
    if (init.method === "PATCH") {
      for (const [k, v] of Object.entries(body.files as Record<string, { content: string }>)) gists[id].files[k] = { filename: k, content: v.content, raw_url: "" };
      return json(gists[id]);
    }
    return json(gists[id]);
  });
}

describe("two-device sync", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("converges without bouncing changes back and forth", async () => {
    const fetchMock = fakeGitHub();
    vi.stubGlobal("fetch", fetchMock);
    const cfg = { token: "t", passphrase: "pass phrase", autoSync: true };

    // Device A creates the profile and syncs first.
    let a = forSync({ ...newProfile("Shared"), updatedAt: "2026-10-27T10:00:00.000Z" });
    a = { ...a, collection: [item("a")] };
    let r = await syncOnce(cfg, a, undefined);
    expect(r.pushed).toBe(true);
    let baseA = r.merged;

    // Device B downloads it, then both edit.
    let b: SyncedProfile = { ...r.merged };
    let baseB: SyncedProfile = r.merged;
    a = { ...a, collection: [...a.collection, item("x")], updatedAt: "2026-10-27T11:00:00.000Z" };
    b = { ...b, collection: [item("a", 4), item("y")], updatedAt: "2026-10-27T11:05:00.000Z" };

    r = await syncOnce({ ...cfg, gistId: r.gistId }, a, baseA);
    a = r.merged; baseA = r.merged;
    r = await syncOnce({ ...cfg, gistId: r.gistId }, b, baseB);
    b = r.merged; baseB = r.merged;
    expect(b.collection.map((c) => `${c.id}${c.quantity}`).sort()).toEqual(["a4", "x1", "y1"]);

    // A pulls B's merge; afterwards nothing needs pushing on either side.
    r = await syncOnce({ ...cfg, gistId: r.gistId }, a, baseA);
    a = r.merged; baseA = r.merged;
    expect(stable(a)).toBe(stable(b));
    const again1 = await syncOnce({ ...cfg, gistId: r.gistId }, a, baseA);
    const again2 = await syncOnce({ ...cfg, gistId: r.gistId }, b, baseB);
    expect(again1.pushed || again2.pushed).toBe(false);
    expect(again1.changedLocal || again2.changedLocal).toBe(false);
  });
});
