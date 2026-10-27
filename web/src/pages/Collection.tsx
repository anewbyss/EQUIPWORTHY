import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, PageHeader, PctSlider, Stat, Thumb } from "../components/ui";
import { csvRow } from "../lib/csv";
import { buylistValue, usd } from "../lib/deckstats";
import { collectionToMoxfieldCsv } from "../lib/moxfield";
import * as scry from "../lib/scryfall";
import { download, update, useProfile } from "../lib/store";
import { CONDITIONS, FINISHES, priceFor, type CollectionItem, type Condition, type Finish } from "../lib/types";

type SortKey = "name" | "set" | "price" | "total" | "qty" | "added";

export default function CollectionPage() {
  const p = useProfile();
  const [tab, setTab] = useState<"cards" | "wishlist" | "sets">("cards");
  return (
    <>
      <PageHeader title="Collection" sub="Every printing, condition, binder and purchase price you own.">
        <Link className="btn primary" to="/batch">+ Add cards</Link>
      </PageHeader>
      <div className="tabs">
        <button className={tab === "cards" ? "on" : ""} onClick={() => setTab("cards")}>Cards ({p.collection.length})</button>
        <button className={tab === "wishlist" ? "on" : ""} onClick={() => setTab("wishlist")}>Wishlist ({p.wishlist.length})</button>
        <button className={tab === "sets" ? "on" : ""} onClick={() => setTab("sets")}>Set completion</button>
      </div>
      {tab === "cards" && <Cards />}
      {tab === "wishlist" && <Wishlist />}
      {tab === "sets" && <SetCompletion />}
    </>
  );
}

function Cards() {
  const p = useProfile();
  const [q, setQ] = useState("");
  const [binder, setBinder] = useState("");
  const [finish, setFinish] = useState<"" | Finish>("");
  const [rarity, setRarity] = useState("");
  const [color, setColor] = useState("");
  const [sort, setSort] = useState<SortKey>("total");
  const [desc, setDesc] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [newBinder, setNewBinder] = useState("");

  const price = (c: CollectionItem) => priceFor(p.cardCache[c.cardId], c.finish) ?? 0;
  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    const r = p.collection.filter((c) => {
      const card = p.cardCache[c.cardId];
      if (ql && !c.name.toLowerCase().includes(ql) && !c.set.includes(ql) && !(card?.typeLine.toLowerCase().includes(ql))) return false;
      if (binder && c.binder !== binder) return false;
      if (finish && c.finish !== finish) return false;
      if (rarity && card?.rarity !== rarity) return false;
      if (color === "C" && card && card.colorIdentity.length) return false;
      if (color === "M" && card && card.colorIdentity.length < 2) return false;
      if (color && !"CM".includes(color) && !card?.colorIdentity.includes(color)) return false;
      return true;
    });
    const key = (c: CollectionItem): string | number =>
      sort === "name" ? c.name : sort === "set" ? `${c.set}${c.collectorNumber.padStart(5, "0")}` : sort === "price" ? price(c) : sort === "total" ? price(c) * c.quantity : sort === "qty" ? c.quantity : c.addedAt;
    r.sort((a, b) => {
      const ka = key(a), kb = key(b);
      const v = typeof ka === "number" ? ka - (kb as number) : String(ka).localeCompare(String(kb));
      return desc ? -v : v;
    });
    return r;
  }, [p, q, binder, finish, rarity, color, sort, desc]);

  const total = rows.reduce((a, c) => a + price(c) * c.quantity, 0);
  const cash = rows.reduce((a, c) => a + buylistValue(price(c), p.settings.buylistCashPct, c.condition, p.settings) * c.quantity, 0);
  const credit = rows.reduce((a, c) => a + buylistValue(price(c), p.settings.buylistCreditPct, c.condition, p.settings) * c.quantity, 0);
  const count = rows.reduce((a, c) => a + c.quantity, 0);

  const edit = (id: string, patch: Partial<CollectionItem>) => update((cur) => ({ ...cur, collection: cur.collection.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const bulk = (patch: Partial<CollectionItem> | "delete") => {
    if (patch === "delete" && !confirm(`Delete ${sel.size} entries?`)) return;
    update((cur) => ({
      ...cur,
      collection: patch === "delete" ? cur.collection.filter((c) => !sel.has(c.id)) : cur.collection.map((c) => (sel.has(c.id) ? { ...c, ...patch } : c)),
    }));
    if (patch === "delete") setSel(new Set());
  };
  const th = (k: SortKey, label: string, cls = "") => (
    <th className={`sortable ${cls}`} onClick={() => (sort === k ? setDesc(!desc) : (setSort(k), setDesc(k !== "name" && k !== "set")))}>
      {label} {sort === k ? (desc ? "↓" : "↑") : ""}
    </th>
  );

  const exportAs = (kind: "csv" | "moxfield" | "tcg" | "text") => {
    const items = sel.size ? rows.filter((r) => sel.has(r.id)) : rows;
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "moxfield") return download(`equipworthy-moxfield-${stamp}.csv`, collectionToMoxfieldCsv(items), "text/csv");
    if (kind === "tcg") return download(`equipworthy-tcgplayer-${stamp}.txt`, items.map((i) => `${i.quantity} ${i.name} [${i.set.toUpperCase()}]`).join("\n"));
    if (kind === "text") return download(`equipworthy-list-${stamp}.txt`, items.map((i) => `${i.quantity} ${i.name} (${i.set.toUpperCase()}) ${i.collectorNumber}${i.finish === "foil" ? " *F*" : i.finish === "etched" ? " *E*" : ""}`).join("\n"));
    const head = ["Quantity", "Name", "Set code", "Collector number", "Finish", "Condition", "Language", "Binder", "Location", "Purchase price", "Market price", "Scryfall ID"];
    const body = items.map((i) => csvRow([String(i.quantity), i.name, i.set, i.collectorNumber, i.finish, i.condition, i.language, i.binder, i.location ?? "", i.purchasePrice?.toFixed(2) ?? "", price(i).toFixed(2), i.cardId]));
    download(`equipworthy-collection-${stamp}.csv`, [csvRow(head), ...body].join("\n"), "text/csv");
  };

  return (
    <>
      <div className="stats">
        <Stat label="Showing" value={count.toLocaleString()} sub={`${rows.length} entries`} />
        <Stat label="Market value" value={usd(total)} />
        <Stat label={`Store cash @ ${p.settings.buylistCashPct}%`} value={usd(cash)} sub="condition-adjusted" />
        <Stat label={`Store credit @ ${p.settings.buylistCreditPct}%`} value={usd(credit)} />
      </div>
      <div className="card grid2">
        <PctSlider label="Store cash" value={p.settings.buylistCashPct} onChange={(v) => update((cur) => ({ ...cur, settings: { ...cur.settings, buylistCashPct: v } }))} />
        <PctSlider label="Store credit" value={p.settings.buylistCreditPct} onChange={(v) => update((cur) => ({ ...cur, settings: { ...cur.settings, buylistCreditPct: v } }))} />
      </div>
      <div className="card row gap">
        <input placeholder="Filter name, set, type…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 160 }} aria-label="Filter" />
        <select value={binder} onChange={(e) => setBinder(e.target.value)} aria-label="Binder">
          <option value="">All binders</option>
          {p.binders.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select value={finish} onChange={(e) => setFinish(e.target.value as Finish | "")} aria-label="Finish">
          <option value="">All finishes</option>
          {FINISHES.map((f) => <option key={f}>{f}</option>)}
        </select>
        <select value={rarity} onChange={(e) => setRarity(e.target.value)} aria-label="Rarity">
          <option value="">All rarities</option>
          {["common", "uncommon", "rare", "mythic", "special"].map((r) => <option key={r}>{r}</option>)}
        </select>
        <select value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color">
          <option value="">All colors</option>
          {[["W", "White"], ["U", "Blue"], ["B", "Black"], ["R", "Red"], ["G", "Green"], ["M", "Multicolor"], ["C", "Colorless"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select onChange={(e) => (e.target.value && exportAs(e.target.value as "csv"), (e.target.value = ""))} defaultValue="" aria-label="Export">
          <option value="" disabled>Export{sel.size ? ` ${sel.size} selected` : ""}…</option>
          <option value="csv">EquipWorthy CSV</option>
          <option value="moxfield">Moxfield CSV</option>
          <option value="tcg">TCGplayer mass entry</option>
          <option value="text">Text list</option>
        </select>
      </div>

      {sel.size > 0 && (
        <div className="card row gap">
          <b>{sel.size} selected</b>
          <select onChange={(e) => e.target.value && (bulk({ binder: e.target.value }), (e.target.value = ""))} defaultValue="" aria-label="Move to binder">
            <option value="" disabled>Move to binder…</option>
            {p.binders.map((b) => <option key={b}>{b}</option>)}
          </select>
          <select onChange={(e) => e.target.value && (bulk({ condition: e.target.value as Condition }), (e.target.value = ""))} defaultValue="" aria-label="Set condition">
            <option value="" disabled>Set condition…</option>
            {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input placeholder="Set location…" onKeyDown={(e) => e.key === "Enter" && bulk({ location: (e.target as HTMLInputElement).value })} aria-label="Set location" />
          <button className="btn danger" onClick={() => bulk("delete")}>Delete</button>
          <button className="btn" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      {rows.length ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" checked={sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="Select all" /></th>
                <th />
                {th("name", "Card")}
                {th("set", "Set")}
                <th>Finish</th>
                <th>Cond</th>
                {th("qty", "Qty")}
                <th>Binder</th>
                <th>Location</th>
                <th className="num">Paid</th>
                {th("price", "Price", "num")}
                {th("total", "Total", "num")}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const card = p.cardCache[c.cardId];
                return (
                  <tr key={c.id}>
                    <td><input type="checkbox" checked={sel.has(c.id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(c.id); else s.delete(c.id); setSel(s); }} aria-label={`Select ${c.name}`} /></td>
                    <td><Thumb card={card} size={28} /></td>
                    <td><Link to={`/card/${c.cardId}`}>{c.name}</Link></td>
                    <td className="small">{c.set.toUpperCase()} #{c.collectorNumber}</td>
                    <td>
                      <select value={c.finish} onChange={(e) => edit(c.id, { finish: e.target.value as Finish })} aria-label="Finish">
                        {(card?.finishes ?? FINISHES).map((f) => <option key={f}>{f}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={c.condition} onChange={(e) => edit(c.id, { condition: e.target.value as Condition })} aria-label="Condition">
                        {CONDITIONS.map((x) => <option key={x}>{x}</option>)}
                      </select>
                    </td>
                    <td><input type="number" min={0} value={c.quantity} style={{ width: "4rem" }} onChange={(e) => edit(c.id, { quantity: Math.max(0, Number(e.target.value)) })} aria-label="Quantity" /></td>
                    <td>
                      <select value={c.binder} onChange={(e) => edit(c.id, { binder: e.target.value })} aria-label="Binder">
                        {p.binders.map((b) => <option key={b}>{b}</option>)}
                      </select>
                    </td>
                    <td><input value={c.location ?? ""} style={{ width: "7rem" }} onChange={(e) => edit(c.id, { location: e.target.value || undefined })} aria-label="Location" /></td>
                    <td className="num"><input value={c.purchasePrice ?? ""} style={{ width: "5rem" }} onChange={(e) => edit(c.id, { purchasePrice: e.target.value ? Number(e.target.value.replace(/[^0-9.]/g, "")) : undefined })} aria-label="Purchase price" /></td>
                    <td className="num">{usd(price(c))}</td>
                    <td className="num">{usd(price(c) * c.quantity)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No cards match. <Link to="/batch">Add cards in bulk</Link>.</Empty>
      )}

      <div className="card row gap">
        <b>Binders:</b>
        {p.binders.map((b) => (
          <span key={b} className="pill">
            {b} ({p.collection.filter((c) => c.binder === b).reduce((a, c) => a + c.quantity, 0)})
            {b !== "Main" && (
              <button className="btn small" style={{ marginLeft: 4, padding: "0 0.3rem" }} onClick={() => confirm(`Delete binder "${b}"? Cards move to Main.`) && update((cur) => ({ ...cur, binders: cur.binders.filter((x) => x !== b), collection: cur.collection.map((c) => (c.binder === b ? { ...c, binder: "Main" } : c)) }))} aria-label={`Delete binder ${b}`}>×</button>
            )}
          </span>
        ))}
        <input placeholder="New binder" value={newBinder} onChange={(e) => setNewBinder(e.target.value)} style={{ width: "9rem" }} aria-label="New binder name" />
        <button className="btn small" disabled={!newBinder.trim() || p.binders.includes(newBinder.trim())} onClick={() => (update((cur) => ({ ...cur, binders: [...cur.binders, newBinder.trim()] })), setNewBinder(""))}>Add binder</button>
        <button className="btn small" onClick={() => update((cur) => ({ ...cur, collection: cur.collection.filter((c) => c.quantity > 0) }))}>Remove 0-qty entries</button>
      </div>
    </>
  );
}

function Wishlist() {
  const p = useProfile();
  const total = p.wishlist.reduce((a, w) => a + (priceFor(p.cardCache[w.cardId], w.finish) ?? 0) * w.quantity, 0);
  if (!p.wishlist.length) return <Empty>Your wishlist is empty. Add cards from any card page.</Empty>;
  return (
    <div className="card table-wrap">
      <p>Cost to buy everything: <b>{usd(total)}</b></p>
      <table>
        <thead><tr><th>Card</th><th>Finish</th><th>Qty</th><th className="num">Max price</th><th className="num">Price</th><th /></tr></thead>
        <tbody>
          {p.wishlist.map((w) => {
            const pr = priceFor(p.cardCache[w.cardId], w.finish);
            const deal = w.maxPrice != null && pr != null && pr <= w.maxPrice;
            return (
              <tr key={w.id}>
                <td><Link to={`/card/${w.cardId}`}>{w.name}</Link> {deal && <span className="pill ok">under max</span>}</td>
                <td>{w.finish}</td>
                <td><input type="number" min={1} value={w.quantity} onChange={(e) => update((cur) => ({ ...cur, wishlist: cur.wishlist.map((x) => (x.id === w.id ? { ...x, quantity: Number(e.target.value) } : x)) }))} aria-label="Quantity" /></td>
                <td className="num"><input value={w.maxPrice ?? ""} style={{ width: "5rem" }} onChange={(e) => update((cur) => ({ ...cur, wishlist: cur.wishlist.map((x) => (x.id === w.id ? { ...x, maxPrice: e.target.value ? Number(e.target.value) : undefined } : x)) }))} aria-label="Max price" /></td>
                <td className="num">{usd(pr)}</td>
                <td><button className="btn small danger" onClick={() => update((cur) => ({ ...cur, wishlist: cur.wishlist.filter((x) => x.id !== w.id) }))}>Remove</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SetCompletion() {
  const p = useProfile();
  const [sets, setSets] = useState<scry.SetInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    scry.sets().then(setSets, (e) => setErr((e as Error).message));
  }, []);
  const owned = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of p.collection) {
      if (c.quantity <= 0) continue;
      if (!m.has(c.set)) m.set(c.set, new Set());
      m.get(c.set)!.add(c.collectorNumber);
    }
    return m;
  }, [p.collection]);
  if (err) return <p className="error">{err}</p>;
  if (!owned.size) return <Empty>Add cards to see how close you are to completing each set.</Empty>;
  const rows = [...owned.entries()]
    .map(([code, nums]) => ({ code, have: nums.size, info: sets?.find((s) => s.code === code) }))
    .sort((a, b) => b.have / (b.info?.card_count || 1) - a.have / (a.info?.card_count || 1));
  return (
    <div className="card table-wrap">
      <table>
        <thead><tr><th>Set</th><th className="num">Owned</th><th className="num">Total</th><th style={{ width: "40%" }}>Progress</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const pctDone = r.info?.card_count ? Math.min(100, (100 * r.have) / r.info.card_count) : 0;
            return (
              <tr key={r.code}>
                <td>{r.info?.name ?? r.code.toUpperCase()} <span className="muted small">{r.code.toUpperCase()}</span></td>
                <td className="num">{r.have}</td>
                <td className="num">{r.info?.card_count ?? "…"}</td>
                <td>
                  <div className="range-bar"><div className="fill" style={{ left: 0, width: `${pctDone}%`, background: "var(--accent)" }} /></div>
                  <span className="small muted">{pctDone.toFixed(0)}%</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
