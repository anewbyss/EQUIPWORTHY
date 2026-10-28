import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, PageHeader, Thumb } from "../components/ui";
import { usd } from "../lib/deckstats";
import { applySnapshot } from "../lib/prices";
import {
  ACCOUNT_URL, CHECKLIST, STORE_URL, countdown, dropState, dropValue, etaText, isChecked, launchUrl, newDrop, queueEstimate, readiness,
} from "../lib/secretlair";
import { catalogStale, loadCatalog, tick } from "../lib/secretLairRunner";
import { cacheCards, getState, update, useProfile } from "../lib/store";
import { FINISHES, uid, type Finish, type Profile, type SecretLairDrop } from "../lib/types";

const toLocalInput = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined);

export const patchDrop = (id: string, fn: (d: SecretLairDrop) => SecretLairDrop) =>
  update((p) => ({ ...p, secretLair: (p.secretLair ?? []).map((d) => (d.id === id ? { ...fn(d), updatedAt: new Date().toISOString() } : d)) }));

/** Re-render every second so countdowns tick. */
function useClock(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function SecretLairPage() {
  const p = useProfile();
  const [tab, setTab] = useState<"mine" | "catalog">("mine");
  const [name, setName] = useState("");
  const drops = [...(p.secretLair ?? [])].sort((a, b) => (a.saleStart ?? "9").localeCompare(b.saleStart ?? "9"));
  const canNotify = "Notification" in window;

  const add = () => {
    const d = newDrop(name.trim() || "New Secret Lair drop");
    update((cur) => ({ ...cur, secretLair: [d, ...(cur.secretLair ?? [])] }));
    setName("");
  };

  return (
    <>
      <PageHeader title="Secret Lair" sub="Follow drops, get reminded before they go on sale, open the drop the moment it's live, and track your place in line.">
        <a className="btn" href={STORE_URL} target="_blank" rel="noreferrer">Secret Lair store ↗</a>
      </PageHeader>

      {canNotify && Notification.permission !== "granted" && (
        <div className="card row gap">
          <span>🔔 Turn on notifications to get sale reminders and "you're almost through" alerts.</span>
          <button className="btn primary small" onClick={() => void Notification.requestPermission()}>Enable notifications</button>
          <span className="muted small">Reminders only fire while EquipWorthy is open (a Home Screen app or a browser tab). For reminders when it's closed, use the iPhone app.</span>
        </div>
      )}

      <div className="tabs">
        <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>Following ({drops.length})</button>
        <button className={tab === "catalog" ? "on" : ""} onClick={() => setTab("catalog")}>Recent drops</button>
      </div>

      {tab === "mine" && (
        <>
          <div className="card row gap">
            <input placeholder="Drop name, e.g. 'Secret Lair x …'" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 200 }} aria-label="New drop name" />
            <button className="btn primary" onClick={add}>+ Add upcoming drop</button>
          </div>
          {drops.length ? drops.map((d) => <DropCard key={d.id} drop={d} profile={p} />) : (
            <Empty>Add an upcoming drop above, or follow one from <button className="linkish" onClick={() => setTab("catalog")}>Recent drops</button>.</Empty>
          )}
        </>
      )}
      {tab === "catalog" && <Catalog onFollowed={() => setTab("mine")} />}
    </>
  );
}

function DropCard({ drop: d, profile: p }: { drop: SecretLairDrop; profile: Profile }) {
  const now = useClock();
  const state = dropState(d, now);
  const cd = countdown(d.saleStart, now);
  const value = dropValue(d.cardIds, p.cardCache, "nonfoil");
  const foilValue = dropValue(d.cardIds, p.cardCache, "foil");
  const est = d.queue ? queueEstimate(d.queue, now) : null;
  const ready = readiness(d);
  const [pos, setPos] = useState("");
  const [open, setOpen] = useState(state === "soon" || state === "live" || !d.saleStart);
  const set = (patch: Partial<SecretLairDrop>) => patchDrop(d.id, (x) => ({ ...x, ...patch }));

  const addReading = () => {
    const n = Number(pos.replace(/[^0-9]/g, ""));
    if (!pos.trim() || !Number.isFinite(n)) return;
    patchDrop(d.id, (x) => ({ ...x, queue: { startedAt: x.queue?.startedAt ?? new Date().toISOString(), entries: [...(x.queue?.entries ?? []), [new Date().toISOString(), n]], notified: x.queue?.notified ?? [] } }));
    setPos("");
    setTimeout(() => tick(), 50);
  };

  return (
    <div className={`card drop-card state-${state}`}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <input className="drop-name" value={d.name} onChange={(e) => set({ name: e.target.value })} aria-label="Drop name" />
          <div className="muted small">
            {d.saleStart ? `On sale ${new Date(d.saleStart).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "Sale time not set"}
            {d.price != null && <> · {usd(d.price)}{d.foilPrice != null && <> / foil {usd(d.foilPrice)}</>}</>}
          </div>
        </div>
        <div className="drop-countdown">
          {state === "live" ? <span className="live-dot">● LIVE</span> : state === "ended" ? <span className="muted">Sale ended</span> : cd ? <span>{cd}</span> : null}
        </div>
      </div>

      <div className="row gap" style={{ marginTop: "0.6rem" }}>
        <a className={`btn ${state === "live" || state === "soon" ? "primary launch-btn" : ""}`} href={launchUrl(d)} target="_blank" rel="noreferrer">
          {state === "live" ? "Open the drop now ↗" : "Open drop page ↗"}
        </a>
        <label className="row gap small"><input type="checkbox" checked={d.marked} onChange={(e) => set({ marked: e.target.checked })} /> Remind me</label>
        <span className="pill">{Math.round(ready * 100)}% ready</span>
        {d.cardIds.length > 0 && (
          <span className="small">
            Cards worth <b>{usd(value.total)}</b>{foilValue.total > value.total && <> (foil {usd(foilValue.total)})</>}
            {d.price != null && value.priced > 0 && <> · <span className={value.total >= d.price ? "up" : "down"}>{value.total >= d.price ? "worth more than" : "worth less than"} the {usd(d.price)} price</span></>}
          </span>
        )}
        <button className="btn small" onClick={() => setOpen(!open)}>{open ? "Hide details" : "Details"}</button>
      </div>

      {(state === "soon" || state === "live" || d.queue) && !d.owned && (
        <div className="queue-box">
          <h3>In line?</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            When the official waiting room shows your place in line, type it here every minute or two. EquipWorthy estimates your wait and alerts you when you're nearly through. Leave the store tab alone while you wait.
          </p>
          <div className="row gap">
            <input inputMode="numeric" placeholder="Place in line" value={pos} onChange={(e) => setPos(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addReading()} style={{ width: "10rem" }} aria-label="Place in line" />
            <button className="btn primary small" onClick={addReading}>Update</button>
            {d.queue && !d.queue.admittedAt && <button className="btn small" onClick={() => patchDrop(d.id, (x) => (x.queue ? { ...x, queue: { ...x.queue, admittedAt: new Date().toISOString() } } : x))}>I'm through!</button>}
            {d.queue && <button className="btn small" onClick={() => set({ queue: undefined })}>Reset</button>}
          </div>
          <p className="queue-eta">{d.queue?.admittedAt ? "You're through. Go check out!" : etaText(est)}</p>
          {est?.etaAt && est.etaMinutes != null && est.etaMinutes > 0 && !d.queue?.admittedAt && (
            <p className="small muted">Estimated through at {new Date(est.etaAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Estimates firm up with more readings.</p>
          )}
        </div>
      )}

      {open && (
        <div className="grid2" style={{ marginTop: "0.75rem" }}>
          <div className="stack">
            <h3>Sale details</h3>
            <label className="small">Goes on sale <input type="datetime-local" value={toLocalInput(d.saleStart)} onChange={(e) => set({ saleStart: fromLocalInput(e.target.value), remindersSent: [] })} /></label>
            <label className="small">Sale ends (optional) <input type="datetime-local" value={toLocalInput(d.saleEnd)} onChange={(e) => set({ saleEnd: fromLocalInput(e.target.value) })} /></label>
            <div className="row gap small">
              <label>Price $<input type="number" min={0} step="0.01" value={d.price ?? ""} onChange={(e) => set({ price: e.target.value ? Number(e.target.value) : undefined })} style={{ width: "6rem" }} /></label>
              <label>Foil $<input type="number" min={0} step="0.01" value={d.foilPrice ?? ""} onChange={(e) => set({ foilPrice: e.target.value ? Number(e.target.value) : undefined })} style={{ width: "6rem" }} /></label>
            </div>
            <label className="small">Drop link (from the Secret Lair site or Wizards' announcement)
              <input placeholder="https://secretlair.wizards.com/…" value={d.url ?? ""} onChange={(e) => set({ url: e.target.value.trim() || undefined })} style={{ width: "100%" }} />
            </label>
            <p className="muted small">Reminders: 24 hours, 1 hour, 15 minutes and 5 minutes before, then at launch, with a button to open the drop.</p>
            {d.cardIds.length > 0 && (
              <div className="hand">{d.cardIds.slice(0, 12).map((id) => <Link key={id} to={`/card/${id}`}><Thumb card={p.cardCache[id] ?? p.secretLairCatalog?.cards[id]} size={56} /></Link>)}</div>
            )}
            <Owned drop={d} />
            <button className="btn small danger" onClick={() => confirm(`Stop following ${d.name}?`) && update((cur) => ({ ...cur, secretLair: (cur.secretLair ?? []).filter((x) => x.id !== d.id) }))}>Remove drop</button>
          </div>
          <div className="stack">
            <h3>Be ready to buy</h3>
            {CHECKLIST.map((c) => (
              <label key={c.key} className="check-row">
                <input type="checkbox" checked={isChecked(d, c.key)} onChange={(e) => set({ checklist: { ...d.checklist, [c.key]: e.target.checked } })} />
                <span>
                  <b>{c.label}</b>
                  {c.link && <> · <a href={c.link} target="_blank" rel="noreferrer">open ↗</a></>}
                  <span className="muted small" style={{ display: "block" }}>{c.detail}</span>
                </span>
              </label>
            ))}
            <p className="muted small">EquipWorthy doesn't join the line or buy for you. Automated entries break Secret Lair's terms of sale and can get orders cancelled. It gets you to the official page at the right moment, ready to check out.</p>
            <a className="small" href={ACCOUNT_URL} target="_blank" rel="noreferrer">Wizards account ↗</a>
          </div>
        </div>
      )}
    </div>
  );
}

function Owned({ drop: d }: { drop: SecretLairDrop }) {
  const [finish, setFinish] = useState<Finish>("nonfoil");
  const [qty, setQty] = useState(1);
  const [paid, setPaid] = useState(d.price != null ? String(d.price) : "");
  const [toCollection, setToCollection] = useState(true);
  if (d.owned) {
    return (
      <p className="small">
        ✓ You bought {d.owned.quantity}× ({d.owned.finish}){d.owned.paid != null && <> for {usd(d.owned.paid)} each</>}.{" "}
        <button className="linkish small" onClick={() => patchDrop(d.id, (x) => ({ ...x, owned: undefined }))}>Undo</button>
      </p>
    );
  }
  const record = () => {
    const paidNum = paid ? Number(paid) : undefined;
    update((cur) => {
      let next: Profile = { ...cur, secretLair: (cur.secretLair ?? []).map((x) => (x.id === d.id ? { ...x, owned: { finish, quantity: qty, paid: paidNum, boughtAt: new Date().toISOString() }, updatedAt: new Date().toISOString() } : x)) };
      if (toCollection && d.cardIds.length) {
        const binders = next.binders.includes("Secret Lair") ? next.binders : [...next.binders, "Secret Lair"];
        const perCard = paidNum != null ? Math.round((paidNum / d.cardIds.length) * 100) / 100 : undefined;
        const items = d.cardIds.map((id) => {
          const c = next.cardCache[id] ?? next.secretLairCatalog?.cards[id];
          const f: Finish = c?.finishes.includes(finish) ? finish : c?.finishes[0] ?? finish;
          return { id: uid(), cardId: id, name: c?.name ?? "Secret Lair card", set: c?.set ?? "sld", collectorNumber: c?.collectorNumber ?? "", finish: f, condition: "NM" as const, language: "en", quantity: qty, purchasePrice: perCard, purchaseDate: new Date().toISOString().slice(0, 10), binder: "Secret Lair", addedAt: new Date().toISOString() };
        });
        next = { ...next, binders, collection: [...next.collection, ...items] };
        const fresh = d.cardIds.map((id) => next.cardCache[id] ?? next.secretLairCatalog?.cards[id]).filter((c): c is NonNullable<typeof c> => !!c);
        next = applySnapshot(next, fresh);
      }
      return next;
    });
  };
  return (
    <div className="row gap small">
      <b>Got it?</b>
      <select value={finish} onChange={(e) => setFinish(e.target.value as Finish)} aria-label="Finish">{FINISHES.map((f) => <option key={f}>{f}</option>)}</select>
      <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} style={{ width: "4rem" }} aria-label="Quantity" />
      <label>paid $<input value={paid} onChange={(e) => setPaid(e.target.value.replace(/[^0-9.]/g, ""))} style={{ width: "5rem" }} /></label>
      {d.cardIds.length > 0 && <label className="row gap"><input type="checkbox" checked={toCollection} onChange={(e) => setToCollection(e.target.checked)} /> add cards to collection</label>}
      <button className="btn small primary" onClick={record}>I bought it</button>
    </div>
  );
}

function Catalog({ onFollowed }: { onFollowed: () => void }) {
  const p = useProfile();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const cat = p.secretLairCatalog;

  const load = async () => {
    setErr(null);
    try {
      await loadCatalog((s) => setBusy(s));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => {
    if (catalogStale()) void load();
  }, []);

  const follow = (g: NonNullable<typeof cat>["groups"][number]) => {
    const cards = g.cardIds.map((id) => cat!.cards[id]).filter(Boolean);
    cacheCards(cards);
    const existing = getState().profile?.secretLair?.find((d) => d.cardIds.join() === g.cardIds.join());
    if (!existing) update((cur) => ({ ...cur, secretLair: [newDrop(g.name, { cardIds: g.cardIds, marked: false }), ...(cur.secretLair ?? [])] }));
    onFollowed();
  };

  const groups = (cat?.groups ?? []).filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase()) || g.cardIds.some((id) => cat!.cards[id]?.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="card row gap">
        <input placeholder="Filter by card name" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Filter drops" />
        <button className="btn" onClick={() => void load()} disabled={!!busy}>{busy ?? "Reload"}</button>
        {cat && <span className="muted small">Updated {new Date(cat.fetchedAt).toLocaleDateString()} · {Object.keys(cat.cards).length} cards</span>}
      </div>
      <p className="muted small">
        Grouped from Scryfall's Secret Lair listings by release date and collector number. Scryfall doesn't name drops, so groups are named after their cards; rename them after you follow one. Upcoming drops appear once their cards are previewed.
      </p>
      {err && <p className="error small">{err}</p>}
      {!cat && !busy && <Empty>Loading Secret Lair drops…</Empty>}
      <div className="drop-grid">
        {groups.slice(0, 80).map((g) => {
          const v = dropValue(g.cardIds, cat!.cards, "nonfoil");
          const fv = dropValue(g.cardIds, cat!.cards, "foil");
          return (
            <div key={g.key} className="card drop-tile">
              <div className="hand">{g.cardIds.slice(0, 4).map((id) => <Link key={id} to={`/card/${id}`}><Thumb card={cat!.cards[id]} size={44} /></Link>)}</div>
              <b className="small">{g.name}</b>
              <span className="muted small">{g.releasedAt} · {g.cardIds.length} card{g.cardIds.length === 1 ? "" : "s"}</span>
              <span className="small">Worth {usd(v.total)}{fv.total > v.total && <> · foil {usd(fv.total)}</>}</span>
              <button className="btn small" onClick={() => follow(g)}>Follow</button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** App-wide strip shown from 15 minutes before a followed drop until 2 hours after it opens. */
export function LaunchStrip() {
  const p = useProfile();
  const now = useClock();
  const hot = (p.secretLair ?? []).filter((d) => {
    if (!d.marked || !d.saleStart || d.owned) return false;
    const t = Date.parse(d.saleStart) - now.getTime();
    return t <= 15 * 60_000 && t > -2 * 3600_000;
  });
  if (!hot.length) return null;
  return (
    <div className="launch-strip" role="status">
      {hot.map((d) => (
        <div key={d.id} className="row gap between">
          <span><b>{d.name}</b> {dropState(d, now) === "live" ? "is LIVE" : `goes live in ${countdown(d.saleStart, now)}`}</span>
          <span className="row gap">
            <a className="btn small primary" href={launchUrl(d)} target="_blank" rel="noreferrer">Open the drop ↗</a>
            <Link className="btn small" to="/secret-lair">Line tracker</Link>
          </span>
        </div>
      ))}
    </div>
  );
}
