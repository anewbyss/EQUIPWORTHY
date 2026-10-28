// EquipWorthy text-message reminders.
//
// The app schedules reminders here (POST /reminders); a once-a-minute cron sends
// the ones that are due through Twilio. Texts only ever go to TO_NUMBER, so even
// if the app key leaked, nobody could use this to text anyone else.

const MAX_BODY = 320;
const MAX_AHEAD_MS = 400 * 86400_000; // ignore reminders more than ~13 months out
const LATE_MS = 2 * 3600_000; // drop reminders that are over 2 hours late

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

/** Constant-time string compare so the app key can't be guessed by timing. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Validate one reminder from the app. Returns a clean object or an error string. */
export function validateReminder(r, now = Date.now()) {
  if (!r || typeof r !== "object") return "not an object";
  if (typeof r.id !== "string" || !/^[A-Za-z0-9_.:@-]{1,120}$/.test(r.id)) return "bad id";
  const at = Date.parse(r.at);
  if (Number.isNaN(at)) return "bad time";
  if (at > now + MAX_AHEAD_MS) return "too far ahead";
  if (typeof r.body !== "string" || !r.body.trim()) return "empty message";
  const url = typeof r.url === "string" && /^https:\/\//i.test(r.url) ? r.url : undefined;
  let body = r.body.trim();
  if (url) body += `\n${url}`;
  return { id: r.id, at: new Date(at).toISOString(), body: body.slice(0, MAX_BODY) };
}

function authorized(request, env) {
  const h = request.headers.get("Authorization") || "";
  const key = h.startsWith("Bearer ") ? h.slice(7) : "";
  return !!env.APP_KEY && safeEqual(key, env.APP_KEY);
}

export async function sendSms(env, body, fetcher = fetch) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const res = await fetcher(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: env.TO_NUMBER, From: env.TWILIO_FROM, Body: body }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Send every reminder that's due. Called by the cron trigger. */
export async function sendDue(env, now = Date.now(), fetcher = fetch) {
  let cursor;
  let sent = 0;
  do {
    const page = await env.REMINDERS.list({ cursor });
    for (const k of page.keys) {
      const r = await env.REMINDERS.get(k.name, "json");
      if (!r) continue;
      const at = Date.parse(r.at);
      if (at > now) continue;
      if (now - at <= LATE_MS) {
        await sendSms(env, r.body, fetcher);
        sent++;
      }
      await env.REMINDERS.delete(k.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return sent;
}

export async function handle(request, env, now = Date.now(), fetcher = fetch) {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(request.url);
  if (url.pathname === "/health") return json({ ok: true, configured: !!(env.APP_KEY && env.TWILIO_ACCOUNT_SID && env.TO_NUMBER) });
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401);

  // Replace / add reminders: { reminders: [{ id, at, body, url? }], remove?: [id] }
  if (url.pathname === "/reminders" && request.method === "POST") {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "bad json" }, 400);
    }
    const list = Array.isArray(payload.reminders) ? payload.reminders.slice(0, 200) : [];
    const saved = [];
    const rejected = [];
    for (const r of list) {
      const v = validateReminder(r, now);
      if (typeof v === "string") rejected.push({ id: r && r.id, error: v });
      else {
        await env.REMINDERS.put(v.id, JSON.stringify(v));
        saved.push(v.id);
      }
    }
    for (const id of Array.isArray(payload.remove) ? payload.remove.slice(0, 200) : []) {
      if (typeof id === "string") await env.REMINDERS.delete(id);
    }
    return json({ saved, rejected });
  }

  // Send a test text right now.
  if (url.pathname === "/test" && request.method === "POST") {
    try {
      await sendSms(env, "EquipWorthy: text reminders are working. 🎉", fetcher);
      return json({ ok: true });
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  }

  return json({ error: "not found" }, 404);
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (_event, env, ctx) => ctx.waitUntil(sendDue(env)),
};
