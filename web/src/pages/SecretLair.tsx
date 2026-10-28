import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, PageHeader, Thumb } from "../components/ui";
import { usd } from "../lib/deckstats";
import { applySnapshot } from "../lib/prices";
import {
  ACCOUNT_URL, CHECKLIST, DROP_SORTS, GROUP_SORTS, STORE_URL, TYPICAL_PRICE, compareDrop, compareSummary, countdown, dropState, dropValue, etaText, icsFor,
  isChecked, isUpcoming, launchUrl, newDrop, pastDropTrend, queueEstimate, readiness, scryfallGroupUrl, sortDrops, sortGroups, upcomingGroups,
  type DropSort, type GroupSort,
} from "../lib/secretlair";
import { catalogStale, loadCatalog, loadReprints, tick } from "../lib/secretLairRunner";
import { cacheCards, download, getState, update, useProfile } from "../lib/store";
import { FINISHES, uid, type CardSummary, type Finish, type Profile, type SecretLairDrop, type SecretLairGroup } from "../lib/types";

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
  const [tab, setTab] = useState<"mine" | "upcoming" | "catalog">("mine");
  const [name, setName] = useState("");
  const [dropSort, setDropSort] = useSort<DropSort>("following", "sale");
  const drops = sortDrops(p.secretLair ?? [], dropSort);
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
          <span className="muted small">Browser reminders only fire while EquipWorthy is open. For reminders when it's closed, turn on push alerts or texts in <Link to="/settings">Settings → Reminder delivery</Link>, or use 📅 Add to calendar.</span>
        </div>
      )}

      <div className="tabs">
        <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>Following ({drops.length})</button>
        <button className={tab === "upcoming" ? "on" : ""} onClick={() => setTab("upcoming")}>Upcoming & announced</button>
        <button className={tab === "catalog" ? "on" : ""} onClick={() => setTab("catalog")}>All drops</button>
      </div>

      {tab === "mine" && (
        <>
          <div className="card row gap">
            <input placeholder="Drop name, e.g. 'Secret Lair x …'" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 200 }} aria-label="New drop name" />
            <button className="btn primary" onClick={add}>+ Add upcoming drop</button>
            <SortSelect value={dropSort} options={DROP_SORTS} onChange={setDropSort} />
          </div>
          {drops.length ? drops.map((d) => <DropCard key={d.id} drop={d} profile={p} />) : (
            <Empty>Add an upcoming drop above, or follow one from <button className="linkish" onClick={() => setTab("upcoming")}>Upcoming & announced</button>.</Empty>
          )}
        </>
      )}
      {tab === "upcoming" && <Upcoming onFollowed={() => setTab("mine")} />}
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
        {d.announcementUrl && <a className="btn small" href={d.announcementUrl} target="_blank" rel="noreferrer">Announcement ↗</a>}
        <label className="row gap small"><input type="checkbox" checked={d.marked} onChange={(e) => set({ marked: e.target.checked })} /> Remind me</label>
        {d.saleStart && (
          <button className="btn small" onClick={() => { const ics = icsFor(d); if (ics) download(`${d.name.replace(/[^\w]+/g, "-")}.ics`, ics, "text/calendar"); }} title="Adds the sale to your calendar with alerts 24h, 1h, 15m and 5m before and at launch">
            📅 Add to calendar
          </button>
        )}
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
            <label className="small">Announcement link (optional)
              <input placeholder="https://magic.wizards.com/…" value={d.announcementUrl ?? ""} onChange={(e) => { const v = e.target.value.trim(); set({ announcementUrl: /^https:\/\//i.test(v) ? v : undefined }); }} style={{ width: "100%" }} />
            </label>
            <p className="muted small">Reminders: 24 hours, 1 hour, 15 minutes and 5 minutes before, then at launch, with a button to open the drop.</p>
            {d.cardIds.length > 0 && (
              <div className="hand">{d.cardIds.slice(0, 12).map((id) => <Link key={id} to={`/card/${id}`}><Thumb card={p.cardCache[id] ?? p.secretLairCatalog?.cards[id]} size={56} /></Link>)}</div>
            )}
            {d.cardIds.length > 0 && <PriceCompare cardIds={d.cardIds} cards={{ ...p.secretLairCatalog?.cards, ...p.cardCache }} price={d.price} foilPrice={d.foilPrice} />}
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

/** Remember each list's sort choice on this device. */
function useSort<T extends string>(list: string, initial: T): [T, (v: T) => void] {
  const key = `ew:sl-sort:${list}`;
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = (x: T) => {
    setV(x);
    try {
      localStorage.setItem(key, x);
    } catch {
      /* storage unavailable */
    }
  };
  return [v, set];
}

function SortSelect<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="row gap small">
      Sort
      <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label="Sort drops">
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  );
}

const isFollowed = (drops: SecretLairDrop[], g: SecretLairGroup) =>
  drops.some((d) => (g.cardIds.length > 0 && d.cardIds.join() === g.cardIds.join()) || d.name.toLowerCase() === g.name.toLowerCase());

function followGroup(g: SecretLairGroup) {
  const cat = getState().profile?.secretLairCatalog;
  cacheCards(g.cardIds.map((id) => cat?.cards[id]).filter((c): c is CardSummary => !!c));
  if (isFollowed(getState().profile?.secretLair ?? [], g)) return;
  const d = newDrop(g.name, {
    cardIds: g.cardIds, marked: !!g.saleStart, announcementUrl: g.announcementUrl,
    saleStart: g.saleStart, price: g.price, foilPrice: g.foilPrice, url: g.url, notes: g.notes,
  });
  update((cur) => ({ ...cur, secretLair: [d, ...(cur.secretLair ?? [])] }));
}

const sourceLabel = (g: SecretLairGroup) =>
  (g.sources ?? ["scryfall"]).map((s) => (s === "calendar" ? "EquipWorthy calendar" : "Scryfall")).join(" + ");

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

/** Load the catalog when it's stale; shared by the Upcoming and All drops tabs. */
function useCatalogLoader() {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
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
  return { busy, err, load };
}

/** Pre-drop price comparison: drop price vs Secret Lair market vs cheapest other printings. */
function PriceCompare({ cardIds, cards, price, foilPrice, compact }: { cardIds: string[]; cards: Record<string, CardSummary | undefined>; price?: number; foilPrice?: number; compact?: boolean }) {
  const p = useProfile();
  const reprints = p.secretLairCatalog?.reprints ?? {};
  const [finish, setFinish] = useState<"nonfoil" | "foil">("nonfoil");
  const [show, setShow] = useState(!compact);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = cardIds.join();
  const fetchReprints = async (force = false) => {
    setBusy(true);
    setErr(null);
    try {
      await loadReprints(cardIds.map((id) => cards[id]), force);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!compact) void fetchReprints(); // compact tiles are fetched in one batch by their list
  }, [key]);
  const c = compareDrop(cardIds, cards, reprints, { finish, price: finish === "foil" ? foilPrice : price });
  return (
    <div className="compare">
      <div className="row gap small">
        <b>Price check</b>
        <select value={finish} onChange={(e) => setFinish(e.target.value as "nonfoil" | "foil")} aria-label="Version">
          <option value="nonfoil">Non-foil</option>
          <option value="foil">Foil</option>
        </select>
        <span>{usd(c.price)}{c.priceIsTypical && <span className="muted"> (typical price)</span>}</span>
        {compact && <button className="btn small" onClick={() => setShow(!show)}>{show ? "Hide" : "Compare prices"}</button>}
        {busy && <span className="muted">Checking other printings…</span>}
      </div>
      <p className="small" style={{ margin: "0.3rem 0" }}>{compareSummary(c)}</p>
      {show && (
        <>
          <div className="table-wrap">
            <table className="small">
              <thead><tr><th>Card</th><th>Secret Lair</th><th>Cheapest elsewhere</th></tr></thead>
              <tbody>
                {c.rows.map((r) => (
                  <tr key={r.cardId}>
                    <td><Link to={`/card/${r.cardId}`}>{r.name}</Link></td>
                    <td>{r.sld != null ? usd(r.sld) : <span className="muted">no price yet</span>}</td>
                    <td>{r.isNew ? <span className="pill">new card</span> : r.reprint != null ? <>{usd(r.reprint)} <span className="muted">{r.reprintSet}</span></> : <span className="muted">–</span>}</td>
                  </tr>
                ))}
                <tr>
                  <td><b>Total</b></td>
                  <td><b>{c.sldPriced ? usd(c.sldTotal) : "–"}</b>{c.sldPriced > 0 && c.sldPriced < c.rows.length && <span className="muted"> ({c.sldPriced}/{c.rows.length})</span>}</td>
                  <td><b>{c.reprintPriced ? usd(c.reprintTotal) : "–"}</b>{c.reprintPriced > 0 && c.reprintPriced < c.rows.length && <span className="muted"> ({c.reprintPriced}/{c.rows.length})</span>}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">Secret Lair prices are TCGplayer market or pre-order prices from Scryfall, which can be thin before a drop ships. "Cheapest elsewhere" is the cheapest {finish === "foil" ? "foil " : ""}copy in any other set. <button className="linkish" onClick={() => void fetchReprints(true)} disabled={busy}>Re-check</button></p>
          {err && <p className="error small">{err}</p>}
        </>
      )}
    </div>
  );
}

function Upcoming({ onFollowed }: { onFollowed: () => void }) {
  const p = useProfile();
  const { busy, err, load } = useCatalogLoader();
  const cat = p.secretLairCatalog;
  const now = new Date();
  const [sort, setSort] = useSort<GroupSort>("upcoming", "soonest");
  const base = cat ? upcomingGroups(cat.groups, now) : [];
  const groups = cat ? sortGroups(base, sort, { cards: cat.cards, reprints: cat.reprints }) : [];
  const trend = cat ? pastDropTrend(cat, now) : null;
  const [checking, setChecking] = useState(false);
  const groupKey = base.map((g) => g.key).join();
  useEffect(() => {
    if (!cat || !base.length) return;
    setChecking(true);
    loadReprints(base.flatMap((g) => g.cardIds.map((id) => cat.cards[id]))).catch(() => undefined).finally(() => setChecking(false));
  }, [groupKey]);
  return (
    <>
      <div className="card row gap">
        <span className="small" style={{ flex: 1, minWidth: 200 }}>
          Drops from Scryfall (every Secret Lair set, as soon as cards are previewed) and the <a href={CALENDAR_EDIT_URL} target="_blank" rel="noreferrer">EquipWorthy drop calendar</a>, which has sale times and prices for announced drops.
        </span>
        <SortSelect value={sort} options={GROUP_SORTS} onChange={setSort} />
        <button className="btn" onClick={() => void load()} disabled={!!busy}>{busy ?? "Reload"}</button>
      </div>
      {trend && (
        <p className="small">
          📈 Past drops (2 months to 2 years old) are now worth a median <b className={trend.median >= 1 ? "up" : "down"}>{Math.round(trend.median * 100)}%</b> of the usual {usd(TYPICAL_PRICE.nonfoil)} price, across {trend.drops} drops.
        </p>
      )}
      {err && <p className="error small">{err}</p>}
      {checking && <p className="muted small">Checking prices of other printings…</p>}
      {!cat && !busy && <Empty>Loading Secret Lair drops…</Empty>}
      {cat && !groups.length && <Empty>No announced or recent drops found. Check back after the next Secret Lair announcement.</Empty>}
      {groups.map((g) => <UpcomingCard key={g.key} group={g} cards={cat!.cards} followed={isFollowed(p.secretLair ?? [], g)} now={now} onFollow={() => (followGroup(g), onFollowed())} />)}
    </>
  );
}

const CALENDAR_EDIT_URL = "https://github.com/anewbyss/EQUIPWORTHY/blob/main/web/public/secret-lair-drops.json";

function UpcomingCard({ group: g, cards, followed, now, onFollow }: { group: SecretLairGroup; cards: Record<string, CardSummary>; followed: boolean; now: Date; onFollow: () => void }) {
  const upcoming = isUpcoming(g, now);
  const when = g.saleStart
    ? `On sale ${new Date(g.saleStart).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : `${upcoming ? "Release" : "Released"} ${fmtDay(g.releasedAt)}`;
  const count = g.cardIds.length || g.cardCount;
  return (
    <div className="card">
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <b>{g.name}</b>
          <div className="muted small">
            {upcoming && <><span className="pill">Upcoming</span>{" "}</>}
            {g.tentative && <><span className="pill">Date not confirmed</span>{" "}</>}
            {when}
            {g.price != null && <> · {usd(g.price)}{g.foilPrice != null && <> / foil {usd(g.foilPrice)}</>}</>}
            {count ? <> · {count} card{count === 1 ? "" : "s"}</> : null}
            {g.announcedAt && <> · Announced {fmtDay(g.announcedAt)}{g.announcementSource && <> by {g.announcementSource}</>}</>}
          </div>
          {g.notes && <div className="small" style={{ marginTop: "0.25rem" }}>{g.notes}</div>}
          <div className="muted small">From {sourceLabel(g)}</div>
        </div>
        <div className="hand">{g.cardIds.slice(0, 6).map((id) => <Link key={id} to={`/card/${id}`}><Thumb card={cards[id]} size={44} /></Link>)}</div>
      </div>
      <div className="row gap" style={{ margin: "0.5rem 0" }}>
        {g.announcementUrl && <a className="btn small" href={g.announcementUrl} target="_blank" rel="noreferrer">Announcement ↗</a>}
        {g.url && <a className="btn small" href={g.url} target="_blank" rel="noreferrer">Product page ↗</a>}
        {g.cardIds.length > 0 && <a className="btn small" href={scryfallGroupUrl(g, cards)} target="_blank" rel="noreferrer">Cards on Scryfall ↗</a>}
        {followed ? <span className="pill">Following</span> : <button className="btn small primary" onClick={onFollow}>{g.saleStart ? "Follow & remind me" : "Follow"}</button>}
      </div>
      {g.cardIds.length > 0
        ? <PriceCompare cardIds={g.cardIds} cards={cards} price={g.price} foilPrice={g.foilPrice} compact />
        : <p className="muted small">Cards aren't on Scryfall yet, so there's no price check. It appears here automatically once they're listed.</p>}
    </div>
  );
}

function Catalog({ onFollowed }: { onFollowed: () => void }) {
  const p = useProfile();
  const { busy, err, load } = useCatalogLoader();
  const [q, setQ] = useState("");
  const [sort, setSort] = useSort<GroupSort>("all", "latest");
  const cat = p.secretLairCatalog;

  const follow = (g: SecretLairGroup) => (followGroup(g), onFollowed());

  const filtered = (cat?.groups ?? []).filter((g) => !q || g.name.toLowerCase().includes(q.toLowerCase()) || g.cardIds.some((id) => cat!.cards[id]?.name.toLowerCase().includes(q.toLowerCase())));
  const groups = cat ? sortGroups(filtered, sort, { cards: cat.cards, reprints: cat.reprints }) : [];
  return (
    <>
      <div className="card row gap">
        <SortSelect value={sort} options={GROUP_SORTS.filter((o) => o.key !== "deal")} onChange={setSort} />
        <input placeholder="Filter by card name" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Filter drops" />
        <button className="btn" onClick={() => void load()} disabled={!!busy}>{busy ?? "Reload"}</button>
        {cat && <span className="muted small">Updated {new Date(cat.fetchedAt).toLocaleDateString()} · {Object.keys(cat.cards).length} cards</span>}
      </div>
      <p className="muted small">
        From Scryfall's Secret Lair sets and the EquipWorthy drop calendar. Secret Lair Drop cards are grouped by release date and collector number; Scryfall doesn't name those drops, so they're named after their cards (rename them after you follow one).
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
              <span className="muted small">{g.releasedAt} · {g.cardIds.length || g.cardCount || 0} card{(g.cardIds.length || g.cardCount) === 1 ? "" : "s"}{g.price != null && <> · {usd(g.price)}</>}</span>
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
