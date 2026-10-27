// Cross-device sync through a private GitHub Gist, end-to-end encrypted.
//
// Each profile is stored as one encrypted file in a gist on the user's own
// GitHub account. Both the web and iOS apps read and write it. Edits made on two
// devices are combined with a three-way merge against the last version that was
// synced on this device (the "base"), so nothing is lost when both sides changed.
//
// Shared with ios/EquipWorthy.swiftpm/Sources/EquipWorthyKit/Sync.swift: the
// envelope format, the encryption (PBKDF2-SHA256 + AES-256-GCM) and the merge rules.

import type { Profile, PriceSeries } from "./types";

// ---------- stable JSON ----------

/** JSON with sorted keys and undefined dropped, so equal data compares equal across platforms. */
export function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stable(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
    .join(",")}}`;
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b);

// ---------- merge ----------

/** Three-way merge of a value: whichever side changed wins; if both changed, `preferLocal` decides. */
export function mergeValue<T>(base: T | undefined, local: T, remote: T, preferLocal: boolean): T {
  if (same(local, remote)) return local;
  if (base !== undefined && same(local, base)) return remote;
  if (base !== undefined && same(remote, base)) return local;
  return preferLocal ? local : remote;
}

/** Three-way merge of a list of records keyed by `key`. Handles adds, edits and deletes on both sides. */
export function mergeList<T>(base: T[] | undefined, local: T[], remote: T[], key: (t: T) => string, preferLocal: boolean): T[] {
  const b = new Map((base ?? []).map((x) => [key(x), x]));
  const l = new Map(local.map((x) => [key(x), x]));
  const r = new Map(remote.map((x) => [key(x), x]));
  const order: string[] = [];
  const seen = new Set<string>();
  // Remote order first, then anything only on this device, so every device converges on the same order.
  for (const k of [...remote.map(key), ...local.map(key)]) if (!seen.has(k)) (seen.add(k), order.push(k));
  const out: T[] = [];
  for (const k of order) {
    const bi = b.get(k), li = l.get(k), ri = r.get(k);
    if (li && ri) out.push(mergeValue(bi, li, ri, preferLocal));
    else if (li && !ri) {
      // Missing remotely: either deleted there (was in base, unchanged here) or added here.
      if (bi && same(bi, li)) continue;
      out.push(li);
    } else if (ri && !li) {
      if (bi && same(bi, ri)) continue; // deleted here
      out.push(ri);
    }
  }
  return out;
}

/** Price series: union of points by date; on a clash the later-synced side wins. */
export function mergeSeries(a: PriceSeries = [], b: PriceSeries = []): PriceSeries {
  const m = new Map<string, number>();
  for (const [d, p] of a) m.set(d, p);
  for (const [d, p] of b) if (!m.has(d)) m.set(d, p);
  return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0])).slice(-730);
}

/** Card data and the market scan are not synced (large and rebuilt on each device); everything else is. */
export const SYNC_EXCLUDED = ["cardCache", "market"] as const;
export type SyncedProfile = Omit<Profile, "cardCache">;

export function forSync(p: Profile): SyncedProfile {
  const { cardCache: _omit, market: _market, ...rest } = p;
  void _omit;
  void _market;
  return rest;
}

export function mergeProfiles(base: SyncedProfile | undefined, local: SyncedProfile, remote: SyncedProfile): SyncedProfile {
  const preferLocal = local.updatedAt >= remote.updatedAt;
  const v = <K extends keyof SyncedProfile>(k: K) => mergeValue(base?.[k], local[k], remote[k], preferLocal);
  const id = (x: { id: string }) => x.id;

  const priceKeys = new Set([...Object.keys(local.priceHistory ?? {}), ...Object.keys(remote.priceHistory ?? {})]);
  const priceHistory: Record<string, PriceSeries> = {};
  for (const k of priceKeys) {
    priceHistory[k] = preferLocal ? mergeSeries(local.priceHistory?.[k], remote.priceHistory?.[k]) : mergeSeries(remote.priceHistory?.[k], local.priceHistory?.[k]);
  }

  const logKey = (e: { cardId: string; finish: string; madeOn: string }) => `${e.cardId}|${e.finish}|${e.madeOn}`;

  return {
    ...local,
    schemaVersion: Math.max(local.schemaVersion, remote.schemaVersion),
    name: v("name"),
    settings: v("settings"),
    binders: mergeList(base?.binders, local.binders, remote.binders, (b) => b, preferLocal),
    collection: mergeList(base?.collection, local.collection, remote.collection, id, preferLocal),
    wishlist: mergeList(base?.wishlist, local.wishlist, remote.wishlist, id, preferLocal),
    decks: mergeList(base?.decks, local.decks, remote.decks, id, preferLocal),
    watchlist: mergeList(base?.watchlist, local.watchlist, remote.watchlist, id, preferLocal),
    alerts: mergeList(base?.alerts, local.alerts, remote.alerts, id, preferLocal),
    trades: mergeList(base?.trades, local.trades, remote.trades, id, preferLocal),
    pendingBatch: mergeList(base?.pendingBatch, local.pendingBatch ?? [], remote.pendingBatch ?? [], (r) => r.key, preferLocal),
    game: v("game"),
    priceHistory,
    portfolioHistory: preferLocal ? mergeSeries(local.portfolioHistory, remote.portfolioHistory) : mergeSeries(remote.portfolioHistory, local.portfolioHistory),
    forecastLog: mergeList(base?.forecastLog, local.forecastLog, remote.forecastLog, logKey, preferLocal).slice(-5000),
    lastPriceRefresh: [local.lastPriceRefresh, remote.lastPriceRefresh].filter(Boolean).sort().pop(),
    updatedAt: preferLocal ? local.updatedAt : remote.updatedAt,
  };
}

// ---------- encryption ----------

export interface Envelope {
  app: "equipworthy";
  v: 1;
  profileId: string;
  name: string;
  updatedAt: string;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string; // base64
  iv: string; // base64, 12 bytes
  data: string; // base64 AES-256-GCM ciphertext + 16-byte tag
}

export const KDF_ITERATIONS = 210_000;

const b64 = (u: Uint8Array) => btoa(Array.from(u, (c) => String.fromCharCode(c)).join(""));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encrypt(p: SyncedProfile, passphrase: string, opts: { salt?: Uint8Array; iv?: Uint8Array; iter?: number } = {}): Promise<Envelope> {
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const iv = opts.iv ?? crypto.getRandomValues(new Uint8Array(12));
  const iter = opts.iter ?? KDF_ITERATIONS;
  const key = await deriveKey(passphrase, salt, iter);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(p))));
  return { app: "equipworthy", v: 1, profileId: p.id, name: p.name, updatedAt: p.updatedAt, kdf: "PBKDF2-SHA256", iter, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

export class WrongPassphrase extends Error {
  constructor() {
    super("Couldn't decrypt the synced data. Check that the sync passphrase matches your other devices.");
  }
}

export async function decrypt(env: Envelope, passphrase: string): Promise<SyncedProfile> {
  const key = await deriveKey(passphrase, unb64(env.salt), env.iter);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv) }, key, unb64(env.data));
    // The iOS app writes an empty cardCache; drop it so both sides compare equal.
    return forSync(JSON.parse(new TextDecoder().decode(plain)));
  } catch {
    throw new WrongPassphrase();
  }
}

// ---------- GitHub Gist storage ----------

export const GIST_DESCRIPTION = "EquipWorthy sync (encrypted)";
export const fileName = (profileId: string) => `equipworthy-${profileId}.json`;

export interface SyncConfig {
  token: string;
  passphrase: string;
  gistId?: string;
  autoSync: boolean;
}

async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (res.status === 401) throw new Error("GitHub rejected the token. Create a new one with the 'gist' permission.");
  if (!res.ok) throw new Error(`GitHub error ${res.status}`);
  return res.json() as Promise<T>;
}

interface GistFile { filename: string; content?: string; truncated?: boolean; raw_url: string }
interface Gist { id: string; description: string | null; files: Record<string, GistFile> }

/** Find this user's EquipWorthy gist, creating a private one if needed. */
export async function ensureGist(cfg: SyncConfig): Promise<string> {
  if (cfg.gistId) return cfg.gistId;
  for (let page = 1; page <= 10; page++) {
    const list = await gh<Gist[]>(cfg.token, `/gists?per_page=100&page=${page}`);
    const found = list.find((g) => g.description === GIST_DESCRIPTION);
    if (found) return found.id;
    if (list.length < 100) break;
  }
  const created = await gh<Gist>(cfg.token, "/gists", {
    method: "POST",
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { "README.md": { content: "Encrypted EquipWorthy profiles. Only readable with your sync passphrase. Don't edit by hand." } },
    }),
  });
  return created.id;
}

async function fileContent(f: GistFile, token: string): Promise<string> {
  if (!f.truncated && f.content != null) return f.content;
  const res = await fetch(f.raw_url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GitHub error ${res.status}`);
  return res.text();
}

export async function listRemote(cfg: SyncConfig, gistId: string): Promise<Envelope[]> {
  const g = await gh<Gist>(cfg.token, `/gists/${gistId}`);
  const out: Envelope[] = [];
  for (const f of Object.values(g.files)) {
    if (!/^equipworthy-.+\.json$/.test(f.filename)) continue;
    try {
      out.push(JSON.parse(await fileContent(f, cfg.token)));
    } catch {
      /* skip unreadable file */
    }
  }
  return out;
}

export async function readRemote(cfg: SyncConfig, gistId: string, profileId: string): Promise<Envelope | null> {
  const g = await gh<Gist>(cfg.token, `/gists/${gistId}`);
  const f = g.files[fileName(profileId)];
  return f ? JSON.parse(await fileContent(f, cfg.token)) : null;
}

export async function writeRemote(cfg: SyncConfig, gistId: string, env: Envelope): Promise<void> {
  await gh(cfg.token, `/gists/${gistId}`, { method: "PATCH", body: JSON.stringify({ files: { [fileName(env.profileId)]: { content: JSON.stringify(env) } } }) });
}

// ---------- one sync pass ----------

export interface SyncResult {
  merged: SyncedProfile;
  changedLocal: boolean;
  pushed: boolean;
  gistId: string;
}

/**
 * Pull, merge with the local profile, push if anything changed.
 * `base` is the last synced version on this device (undefined on first sync).
 */
export async function syncOnce(cfg: SyncConfig, local: SyncedProfile, base: SyncedProfile | undefined): Promise<SyncResult> {
  const gistId = await ensureGist(cfg);
  const env = await readRemote(cfg, gistId, local.id);
  if (!env) {
    await writeRemote(cfg, gistId, await encrypt(local, cfg.passphrase));
    return { merged: local, changedLocal: false, pushed: true, gistId };
  }
  const remote = await decrypt(env, cfg.passphrase);
  const merged = mergeProfiles(base, local, remote);
  const pushed = !same(merged, remote);
  if (pushed) await writeRemote(cfg, gistId, await encrypt(merged, cfg.passphrase));
  return { merged, changedLocal: !same(merged, local), pushed, gistId };
}
