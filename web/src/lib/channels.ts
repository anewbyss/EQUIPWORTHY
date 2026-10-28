// Extra ways to deliver Secret Lair reminders, so they arrive even when
// EquipWorthy is closed:
//   - ntfy: free push alerts through the ntfy app (scheduled up to 3 days ahead)
//   - text messages: your own EquipWorthy SMS worker (Twilio), scheduled any time ahead
// Calendar files (icsFor) are generated in secretlair.ts.

import { plannedReminders, type PlannedReminder } from "./secretlair";
import { getState, update } from "./store";
import type { Profile, SecretLairDrop, Settings } from "./types";

export const NTFY_MAX_AHEAD_MS = 3 * 86400_000 - 10 * 60_000; // ntfy.sh holds scheduled messages up to 3 days

/** A hard-to-guess topic name; anyone who knows it can read the alerts. */
export function newTopic(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return "equipworthy-" + Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 18);
}

const trimSlash = (u: string) => u.replace(/\/+$/, "");

/** Which ntfy reminders still need scheduling, and their "key@saleStart" tags. */
export function ntfyPlan(d: SecretLairDrop, now = new Date()): { reminder: PlannedReminder; tag: string }[] {
  const done = new Set(d.pushScheduled ?? []);
  return plannedReminders(d, now)
    .filter((r) => Date.parse(r.at) - now.getTime() <= NTFY_MAX_AHEAD_MS)
    .map((r) => ({ reminder: r, tag: `${r.key}@${d.saleStart}` }))
    .filter((x) => !done.has(x.tag));
}

export async function ntfySend(s: Pick<Settings, "ntfyServer" | "ntfyTopic">, r: { title: string; body: string; url?: string; at?: string }, fetcher = fetch) {
  if (!s.ntfyTopic) throw new Error("No ntfy topic set");
  const headers: Record<string, string> = { Title: r.title, Tags: "sparkles", Priority: "high" };
  if (r.url) headers.Click = r.url;
  if (r.at) headers.At = String(Math.floor(Date.parse(r.at) / 1000));
  const res = await fetcher(`${trimSlash(s.ntfyServer || "https://ntfy.sh")}/${encodeURIComponent(s.ntfyTopic)}`, { method: "POST", headers, body: r.body });
  if (!res.ok) throw new Error(`ntfy returned ${res.status}`);
}

/** Schedule any ntfy reminders that are now within ntfy's 3-day window. */
export async function syncNtfy(p: Profile, now = new Date(), fetcher = fetch): Promise<number> {
  if (!p.settings.ntfyEnabled || !p.settings.ntfyTopic) return 0;
  let n = 0;
  for (const d of p.secretLair ?? []) {
    const plan = ntfyPlan(d, now);
    if (!plan.length) continue;
    const done: string[] = [];
    for (const { reminder, tag } of plan) {
      await ntfySend(p.settings, reminder, fetcher);
      done.push(tag);
      n++;
    }
    update((cur) => ({ ...cur, secretLair: (cur.secretLair ?? []).map((x) => (x.id === d.id ? { ...x, pushScheduled: [...(x.pushScheduled ?? []), ...done].slice(-40) } : x)) }));
  }
  return n;
}

/** Everything the SMS worker should hold: all future reminders, plus ids to remove. */
export function smsPayload(p: Profile, previousIds: string[], now = new Date()) {
  const reminders = (p.secretLair ?? []).flatMap((d) => plannedReminders(d, now)).map((r) => ({ id: r.id, at: r.at, body: `${r.title}: ${r.body}`, url: r.url }));
  const keep = new Set(reminders.map((r) => r.id));
  return { reminders, remove: previousIds.filter((id) => !keep.has(id)) };
}

async function smsFetch(s: Pick<Settings, "smsWorkerUrl" | "smsKey">, path: string, body: unknown, fetcher = fetch) {
  if (!s.smsWorkerUrl || !s.smsKey) throw new Error("Text reminders aren't set up");
  const res = await fetcher(`${trimSlash(s.smsWorkerUrl)}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${s.smsKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ? `Text service: ${j.error}` : `Text service returned ${res.status}`);
  return j;
}

const SMS_IDS_KEY = "ew:sms-ids";
const loadIds = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(SMS_IDS_KEY) ?? "[]");
  } catch {
    return [];
  }
};

/** Push the full reminder schedule to the SMS worker (idempotent: same ids are replaced). */
export async function syncSms(p: Profile, now = new Date(), fetcher = fetch): Promise<number> {
  if (!p.settings.smsEnabled || !p.settings.smsWorkerUrl || !p.settings.smsKey) return 0;
  const payload = smsPayload(p, loadIds(), now);
  if (!payload.reminders.length && !payload.remove.length) return 0;
  await smsFetch(p.settings, "/reminders", payload, fetcher);
  try {
    localStorage.setItem(SMS_IDS_KEY, JSON.stringify(payload.reminders.map((r) => r.id)));
  } catch {
    /* storage unavailable */
  }
  return payload.reminders.length;
}

export const testSms = (s: Settings) => smsFetch(s, "/test", {});
export const testNtfy = (s: Settings) => ntfySend(s, { title: "EquipWorthy", body: "Push alerts are working. 🎉" });

let lastSignature = "";
let running = false;
export let channelError: string | null = null;

/** Run after saves and on start-up: schedule anything new, but only when drops or settings changed (or hourly for ntfy's rolling window). */
export async function syncChannels(force = false) {
  const p = getState().profile;
  if (!p || running) return;
  const s = p.settings;
  if (!s.ntfyEnabled && !s.smsEnabled) return;
  const sig = JSON.stringify([s.ntfyEnabled, s.ntfyTopic, s.smsEnabled, s.smsWorkerUrl, (p.secretLair ?? []).map((d) => [d.id, d.marked, d.saleStart, d.url, d.name, !!d.owned]), Math.floor(Date.now() / 3600_000)]);
  if (!force && sig === lastSignature) return;
  running = true;
  try {
    await syncNtfy(p);
    await syncSms(getState().profile!);
    lastSignature = sig;
    channelError = null;
  } catch (e) {
    channelError = (e as Error).message;
  } finally {
    running = false;
  }
}
