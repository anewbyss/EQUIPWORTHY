// Runs sync for the active profile: on start-up, shortly after saves, when the
// tab comes back into view, every few minutes, and when the user taps Sync.

import { useSyncExternalStore } from "react";
import { addSyncedProfile, applySynced, getBase, getState, onSaved, setBase } from "./store";
import { decrypt, ensureGist, forSync, listRemote, syncOnce, type Envelope, type SyncConfig } from "./sync";
import { refreshPrices } from "./prices";

const CONFIG_KEY = "ew:sync-config";

export interface SyncStatus {
  configured: boolean;
  syncing: boolean;
  lastSync: string | null;
  error: string | null;
  autoSync: boolean;
}

let status: SyncStatus = { configured: false, syncing: false, lastSync: null, error: null, autoSync: true };
const listeners = new Set<() => void>();
const emit = (patch: Partial<SyncStatus>) => {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
};
export const useSyncStatus = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => status,
  );

export function loadConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as SyncConfig) : null;
  } catch {
    return null;
  }
}

function saveConfig(cfg: SyncConfig | null) {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* storage unavailable */
  }
  emit({ configured: !!cfg, autoSync: cfg?.autoSync ?? true });
}

let running: Promise<boolean> | null = null;
let again = false;

/** Sync the active profile now. Returns true on success. */
export function syncNow(): Promise<boolean> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    const cfg = loadConfig();
    const p = getState().profile;
    if (!cfg || !p) return false;
    emit({ syncing: true, error: null });
    try {
      const startedAt = p.updatedAt;
      const base = await getBase(p.id);
      const res = await syncOnce(cfg, forSync(p), base);
      if (cfg.gistId !== res.gistId) saveConfig({ ...cfg, gistId: res.gistId });
      const cur = getState().profile;
      if (cur?.id === p.id && cur.updatedAt !== startedAt) {
        // The user kept editing while we synced; merge again on the next pass.
        again = true;
      } else if (res.changedLocal) {
        await applySynced(res.merged);
        // Fill in card data for anything that arrived from another device.
        const missing = [...res.merged.collection, ...res.merged.watchlist].some((c) => !getState().profile?.cardCache[c.cardId]);
        if (missing) refreshPrices().catch(() => undefined);
      }
      await setBase(p.id, res.merged);
      emit({ syncing: false, lastSync: new Date().toISOString() });
      return true;
    } catch (e) {
      emit({ syncing: false, error: (e as Error).message });
      return false;
    }
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      setTimeout(() => void syncNow(), 1000);
    }
  });
  return running;
}

/** Check the token and passphrase, then turn sync on. */
export async function connect(token: string, passphrase: string): Promise<Envelope[]> {
  const cfg: SyncConfig = { token: token.trim(), passphrase, autoSync: true };
  const gistId = await ensureGist(cfg);
  const remote = await listRemote(cfg, gistId);
  // Verify the passphrase against any existing data before saving it.
  if (remote[0]) await decrypt(remote[0], passphrase);
  saveConfig({ ...cfg, gistId });
  return remote;
}

export function disconnect() {
  saveConfig(null);
  emit({ lastSync: null, error: null });
}

export function setAutoSync(on: boolean) {
  const cfg = loadConfig();
  if (cfg) saveConfig({ ...cfg, autoSync: on });
}

export async function remoteProfiles(): Promise<Envelope[]> {
  const cfg = loadConfig();
  if (!cfg) return [];
  return listRemote(cfg, await ensureGist(cfg));
}

/** Download a profile that exists on another device but not on this one. */
export async function downloadProfile(env: Envelope) {
  const cfg = loadConfig();
  if (!cfg) return;
  const p = await decrypt(env, cfg.passphrase);
  await addSyncedProfile(p);
  await setBase(p.id, p);
  emit({ lastSync: new Date().toISOString() });
  refreshPrices().catch(() => undefined);
}

let started = false;
export function startAutoSync() {
  if (started) return;
  started = true;
  const cfg = loadConfig();
  emit({ configured: !!cfg, autoSync: cfg?.autoSync ?? true });
  const auto = () => loadConfig()?.autoSync;
  let t: ReturnType<typeof setTimeout> | undefined;
  onSaved(() => {
    if (!auto()) return;
    if (t) clearTimeout(t);
    t = setTimeout(() => void syncNow(), 8000);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && auto()) void syncNow();
  });
  setInterval(() => auto() && void syncNow(), 5 * 60_000);
  if (auto()) void syncNow();
}
