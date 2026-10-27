// Local profile storage (IndexedDB) with frequent autosave and manual save.
//
// Saving happens:
//   - 1.5s after any change (debounced)
//   - every `settings.autosaveSeconds` while there are unsaved changes
//   - when the tab is hidden or closed (visibilitychange / pagehide)
//   - when the user presses Save (button on every page, or Ctrl/Cmd+S)

import { get, set, del } from "idb-keyval";
import { useSyncExternalStore } from "react";
import { newProfile, SCHEMA_VERSION, type CardSummary, type Profile } from "./types";

export interface ProfileMeta {
  id: string;
  name: string;
  updatedAt: string;
  cards: number;
}

export interface StoreState {
  profile: Profile | null;
  profiles: ProfileMeta[];
  dirty: boolean;
  saving: boolean;
  lastSaved: string | null;
  error: string | null;
}

const INDEX_KEY = "ew:profiles";
const ACTIVE_KEY = "ew:active";
const profileKey = (id: string) => `ew:profile:${id}`;
const DEBOUNCE_MS = 1500;

let state: StoreState = { profile: null, profiles: [], dirty: false, saving: false, lastSaved: null, error: null };
const listeners = new Set<() => void>();
let debounce: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;

function emit(patch: Partial<StoreState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getState = () => state;
export const useStore = () => useSyncExternalStore(subscribe, getState);
export function useProfile(): Profile {
  const s = useStore();
  if (!s.profile) throw new Error("No profile loaded");
  return s.profile;
}

const meta = (p: Profile): ProfileMeta => ({
  id: p.id,
  name: p.name,
  updatedAt: p.updatedAt,
  cards: p.collection.reduce((a, c) => a + c.quantity, 0),
});

/** Bring older backups up to the current schema. */
export function migrate(raw: Partial<Profile>): Profile {
  const base = newProfile(raw.name ?? "Imported");
  const p: Profile = { ...base, ...raw, settings: { ...base.settings, ...(raw.settings ?? {}) } } as Profile;
  p.schemaVersion = SCHEMA_VERSION;
  return p;
}

export async function init() {
  const profiles = ((await get(INDEX_KEY)) as ProfileMeta[] | undefined) ?? [];
  let activeId = (await get(ACTIVE_KEY)) as string | undefined;
  let profile: Profile | undefined;
  if (activeId) profile = await get(profileKey(activeId));
  if (!profile && profiles[0]) profile = await get(profileKey(profiles[0].id));
  if (!profile) {
    profile = newProfile("My Collection");
    await set(profileKey(profile.id), profile);
    profiles.push(meta(profile));
    await set(INDEX_KEY, profiles);
  }
  profile = migrate(profile);
  activeId = profile.id;
  await set(ACTIVE_KEY, activeId);
  emit({ profile, profiles, dirty: false, lastSaved: profile.updatedAt });
  installAutosave();
}

function installAutosave() {
  if (typeof window === "undefined") return;
  const flush = () => {
    if (state.dirty) void save();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) {
      flush();
      e.preventDefault();
    }
  });
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  });
  resetInterval();
}

function resetInterval() {
  if (interval) clearInterval(interval);
  const secs = Math.max(5, state.profile?.settings.autosaveSeconds ?? 20);
  interval = setInterval(() => {
    if (state.dirty) void save();
  }, secs * 1000);
}

/** Apply a change to the active profile and schedule an autosave. */
export function update(fn: (p: Profile) => Profile) {
  if (!state.profile) return;
  const prevSecs = state.profile.settings.autosaveSeconds;
  const next = { ...fn(state.profile), updatedAt: new Date().toISOString() };
  emit({ profile: next, dirty: true });
  if (next.settings.autosaveSeconds !== prevSecs) resetInterval();
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => void save(), DEBOUNCE_MS);
}

/** Listeners called after every successful save (used to schedule sync). */
const saveListeners = new Set<() => void>();
export const onSaved = (fn: () => void) => {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
};

/**
 * Replace the active profile with a merged copy from sync. Unlike update() this
 * keeps the merged `updatedAt`, so devices don't bounce changes back and forth.
 */
export async function applySynced(merged: Omit<Profile, "cardCache">) {
  if (!state.profile || state.profile.id !== merged.id) return;
  const next: Profile = migrate({ ...merged, cardCache: state.profile.cardCache });
  emit({ profile: next, dirty: true });
  await save(true);
}

export const getBase = async (id: string) => (await get(`ew:syncbase:${id}`)) as Omit<Profile, "cardCache"> | undefined;
export const setBase = (id: string, base: Omit<Profile, "cardCache">) => set(`ew:syncbase:${id}`, base);

/** Add a profile that came from sync (keeps its id so later syncs match). */
export async function addSyncedProfile(p: Omit<Profile, "cardCache">) {
  if (state.dirty) await save();
  const full = migrate({ ...p, cardCache: {} });
  await set(profileKey(full.id), full);
  const profiles = state.profiles.filter((m) => m.id !== full.id).concat(meta(full));
  await set(INDEX_KEY, profiles);
  emit({ profiles });
  await switchProfile(full.id);
}

export async function save(quiet = false): Promise<boolean> {
  const p = state.profile;
  if (!p) return false;
  if (debounce) clearTimeout(debounce);
  emit({ saving: true });
  try {
    await set(profileKey(p.id), p);
    const profiles = state.profiles.filter((m) => m.id !== p.id).concat(meta(p));
    profiles.sort((a, b) => a.name.localeCompare(b.name));
    await set(INDEX_KEY, profiles);
    // Only clear dirty if nothing changed while we were writing
    emit({ saving: false, dirty: state.profile !== p ? state.dirty : false, lastSaved: new Date().toISOString(), profiles, error: null });
    if (!quiet) saveListeners.forEach((l) => l());
    return true;
  } catch (e) {
    emit({ saving: false, error: `Save failed: ${(e as Error).message}` });
    return false;
  }
}

export async function switchProfile(id: string) {
  if (state.dirty) await save();
  const p = (await get(profileKey(id))) as Profile | undefined;
  if (!p) return;
  await set(ACTIVE_KEY, id);
  emit({ profile: migrate(p), dirty: false, lastSaved: p.updatedAt });
  resetInterval();
}

export async function createProfile(name: string) {
  if (state.dirty) await save();
  const p = newProfile(name);
  await set(profileKey(p.id), p);
  const profiles = [...state.profiles, meta(p)];
  await set(INDEX_KEY, profiles);
  await set(ACTIVE_KEY, p.id);
  emit({ profile: p, profiles, dirty: false, lastSaved: p.updatedAt });
}

export async function deleteProfile(id: string) {
  await del(profileKey(id));
  const profiles = state.profiles.filter((m) => m.id !== id);
  await set(INDEX_KEY, profiles);
  if (state.profile?.id === id) {
    if (profiles[0]) await switchProfile(profiles[0].id);
    else await createProfile("My Collection");
  } else emit({ profiles });
}

export async function importProfile(json: string): Promise<Profile> {
  const raw = JSON.parse(json);
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.collection)) throw new Error("Not an EquipWorthy backup file.");
  const p = migrate(raw);
  // Avoid clobbering an existing profile with the same id
  if (state.profiles.some((m) => m.id === p.id)) {
    p.id = crypto.randomUUID();
    p.name = `${p.name} (imported)`;
  }
  await set(profileKey(p.id), p);
  const profiles = [...state.profiles, meta(p)];
  await set(INDEX_KEY, profiles);
  await switchProfile(p.id);
  emit({ profiles });
  return p;
}

export function exportProfile(p: Profile): string {
  return JSON.stringify(p, null, 1);
}

export function cacheCards(cards: CardSummary[]) {
  if (!cards.length) return;
  update((p) => {
    const cardCache = { ...p.cardCache };
    for (const c of cards) cardCache[c.id] = { ...cardCache[c.id], ...c };
    return { ...p, cardCache };
  });
}

export function download(filename: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
