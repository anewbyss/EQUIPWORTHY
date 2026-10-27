import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, PageHeader, Thumb } from "../components/ui";
import { parseList, parseSetGrid } from "../lib/batch";
import { csvToBatch } from "../lib/csv";
import { usd } from "../lib/deckstats";
import { addPending, commitRows, toPending, type Destination } from "../lib/pending";
import { resolveLines } from "../lib/resolve";
import * as scry from "../lib/scryfall";
import { cacheCards, update, useProfile } from "../lib/store";
import { CONDITIONS, FINISHES, priceFor, uid, type CardSummary, type Condition, type Finish, type PendingRow } from "../lib/types";

type Tab = "list" | "grid" | "csv";

const EXAMPLE = `4 Lightning Bolt
1 Sol Ring (CMM) 410 *F*
2 Counterspell LP @ 1.50
Rhystic Study
1 Arcane Signet [CMM] #464 etched`;

export default function BatchPage() {
  const p = useProfile();
  const [tab, setTab] = useState<Tab>("list");
  const [text, setText] = useState("");
  const [setCode, setSetCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ingest = async (lines: ReturnType<typeof parseList>, source: PendingRow["source"]) => {
    if (!lines.length) return setErr("Nothing to add. Check the format.");
    setErr(null);
    setBusy(`Looking up ${lines.length} lines…`);
    try {
      const resolved = await resolveLines(lines, (d, t) => setBusy(`Matching ${d}/${t}…`));
      addPending(resolved.map((r) => toPending(r, source, { condition: p.settings.defaultCondition })), resolved.flatMap((r) => (r.card ? [r.card] : [])));
      setText("");
    } catch (e) {
      setErr(`Lookup failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (f: File) => {
    const { lines, error } = csvToBatch(await f.text());
    if (error) return setErr(error);
    await ingest(lines, "csv");
  };

  return (
    <>
      <PageHeader title="Batch Entry" sub="Add hundreds of cards at once. Everything lands in a review queue first, and the queue is saved as you go." />
      <div className="tabs">
        <button className={tab === "list" ? "on" : ""} onClick={() => setTab("list")}>Paste a list</button>
        <button className={tab === "grid" ? "on" : ""} onClick={() => setTab("grid")}>Set grid</button>
        <button className={tab === "csv" ? "on" : ""} onClick={() => setTab("csv")}>CSV import</button>
        <Link to="/scan" style={{ padding: "0.5rem 0.9rem" }}>Scan →</Link>
      </div>

      <div className="card stack">
        {tab === "list" && (
          <>
            <p className="muted small">
              One card per line. Works with Moxfield, Arena, MTGO and most other exports. Supports <code>4x Name</code>, <code>(SET) 123</code>, <code>*F*</code>/<code>foil</code>, <code>*E*</code>/<code>etched</code>, a condition (<code>LP</code>), <code>@ 2.50</code> for what you paid, and section headers like <code>Sideboard</code>. Typos are fine.
            </p>
            <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} aria-label="Card list" />
            <div className="row gap">
              <button className="btn primary" disabled={!!busy || !text.trim()} onClick={() => void ingest(parseList(text), "list")}>{busy ?? "Match cards"}</button>
              <button className="btn" onClick={() => setText(EXAMPLE)}>Load example</button>
            </div>
          </>
        )}
        {tab === "grid" && (
          <>
            <p className="muted small">
              Fastest way to enter a pile from one set. Pick the set, then type collector numbers: <code>12, 45, 45f, 3x88, 101e, 200-205</code> (f = foil, e = etched, 3x = quantity).
            </p>
            <div className="row gap">
              <input value={setCode} onChange={(e) => setSetCode(e.target.value.trim())} placeholder="Set code, e.g. DSK" style={{ width: "10rem" }} aria-label="Set code" />
              <a className="small" href="#/sets">Browse set codes</a>
            </div>
            <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="12, 45, 45f, 3x88, 101e" aria-label="Collector numbers" />
            <button className="btn primary" disabled={!!busy || !setCode || !text.trim()} onClick={() => void ingest(parseSetGrid(setCode, text), "grid")}>{busy ?? "Match cards"}</button>
          </>
        )}
        {tab === "csv" && (
          <>
            <p className="muted small">
              Import a CSV from Moxfield, ManaBox, Deckbox, Dragon Shield, TCGplayer, Delver Lens or an EquipWorthy export. Columns are detected automatically: quantity, name, set, collector number, foil, condition, language, purchase price, Scryfall ID.
            </p>
            <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} aria-label="CSV file" />
            {busy && <p className="muted">{busy}</p>}
          </>
        )}
        {err && <p className="error">{err}</p>}
      </div>

      <Review />
    </>
  );
}

function Review() {
  const p = useProfile();
  const rows = p.pendingBatch ?? [];
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dest, setDest] = useState<Destination["kind"]>("collection");
  const [binder, setBinder] = useState(p.settings.defaultBinder);
  const [deckId, setDeckId] = useState(p.decks[0]?.id ?? "");
  const [printings, setPrintings] = useState<Record<string, CardSummary[]>>({});
  const [done, setDone] = useState<string | null>(null);

  const setRows = (fn: (r: PendingRow[]) => PendingRow[]) => update((cur) => ({ ...cur, pendingBatch: fn(cur.pendingBatch ?? []) }));
  const edit = (key: string, patch: Partial<PendingRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const targets = sel.size ? sel : new Set(rows.map((r) => r.key));
  const applyAll = (patch: Partial<PendingRow>) => setRows((rs) => rs.map((r) => (targets.has(r.key) ? { ...r, ...patch } : r)));

  const ok = rows.filter((r) => r.cardId);
  const bad = rows.filter((r) => !r.cardId);
  const total = useMemo(() => ok.reduce((a, r) => a + (priceFor(p.cardCache[r.cardId!], r.finish) ?? 0) * r.quantity, 0), [ok, p.cardCache]);

  const loadPrintings = async (r: PendingRow) => {
    const card = r.cardId ? p.cardCache[r.cardId] : undefined;
    if (!card || printings[r.key]) return;
    const ps = await scry.prints(card);
    cacheCards(ps);
    setPrintings((x) => ({ ...x, [r.key]: ps }));
  };

  const retry = async (r: PendingRow, name: string) => {
    try {
      const c = await scry.named(name, true);
      cacheCards([c]);
      edit(r.key, { cardId: c.id, name: c.name, set: c.set, collectorNumber: c.collectorNumber, status: "fuzzy" });
    } catch {
      edit(r.key, { name, status: "notfound" });
    }
  };

  const commit = () => {
    const keys = new Set([...targets].filter((k) => rows.find((r) => r.key === k)?.cardId));
    if (!keys.size) return;
    let d: Destination;
    if (dest === "collection") d = { kind: "collection", binder };
    else if (dest === "deck") {
      let id = deckId;
      if (!id || id === "__new") {
        id = uid();
        const now = new Date().toISOString();
        update((cur) => ({ ...cur, decks: [...cur.decks, { id, name: `Batch import ${now.slice(0, 10)}`, format: "commander", cards: [], createdAt: now, updatedAt: now }] }));
      }
      d = { kind: "deck", deckId: id };
    } else d = { kind: dest };
    const n = [...keys].reduce((a, k) => a + (rows.find((r) => r.key === k)?.quantity ?? 0), 0);
    update((cur) => commitRows(cur, keys, d));
    setSel(new Set());
    setDone(`Added ${n} cards to ${dest === "collection" ? binder : dest}.`);
    setTimeout(() => setDone(null), 4000);
  };

  if (!rows.length) return done ? <p className="up">{done}</p> : <Empty>The review queue is empty. Paste a list, import a CSV or scan cards to start.</Empty>;

  return (
    <div className="card">
      <div className="row between">
        <h2>Review queue · {ok.length} matched{bad.length ? `, ${bad.length} need attention` : ""}</h2>
        <span>Batch value: <b>{usd(total)}</b></span>
      </div>
      <div className="row gap" style={{ marginBottom: "0.75rem" }}>
        <span className="small muted">{sel.size ? `${sel.size} selected:` : "Apply to all:"}</span>
        <select onChange={(e) => e.target.value && (applyAll({ condition: e.target.value as Condition }), (e.target.value = ""))} defaultValue="" aria-label="Set condition">
          <option value="" disabled>Condition…</option>
          {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select onChange={(e) => e.target.value && (applyAll({ finish: e.target.value as Finish }), (e.target.value = ""))} defaultValue="" aria-label="Set finish">
          <option value="" disabled>Finish…</option>
          {FINISHES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <input placeholder="Paid each $" style={{ width: "7rem" }} onKeyDown={(e) => e.key === "Enter" && applyAll({ purchasePrice: Number((e.target as HTMLInputElement).value) || undefined })} aria-label="Purchase price for all" />
        <button className="btn small danger" onClick={() => (setRows((rs) => rs.filter((r) => !targets.has(r.key))), setSel(new Set()))}>Remove</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())} aria-label="Select all" /></th>
              <th />
              <th>Card</th>
              <th>Printing</th>
              <th>Finish</th>
              <th>Cond</th>
              <th>Qty</th>
              <th className="num">Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const card = r.cardId ? p.cardCache[r.cardId] : undefined;
              return (
                <tr key={r.key}>
                  <td><input type="checkbox" checked={sel.has(r.key)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(r.key); else s.delete(r.key); setSel(s); }} aria-label="Select row" /></td>
                  <td><Thumb card={card} size={28} /></td>
                  <td>
                    {r.cardId ? (
                      <>
                        <Link to={`/card/${r.cardId}`}>{r.name}</Link>{" "}
                        {r.status === "fuzzy" && <span className="pill warn" title={`From: ${r.raw}`}>check</span>}
                      </>
                    ) : (
                      <>
                        <span className="pill bad">not found</span>{" "}
                        <input defaultValue={r.name || r.raw} onKeyDown={(e) => e.key === "Enter" && void retry(r, (e.target as HTMLInputElement).value)} aria-label="Fix card name" title="Fix the name and press Enter" />
                      </>
                    )}
                  </td>
                  <td>
                    {card ? (
                      <select
                        value={card.id}
                        onFocus={() => void loadPrintings(r)}
                        onChange={(e) => {
                          const c = printings[r.key]?.find((x) => x.id === e.target.value);
                          if (c) edit(r.key, { cardId: c.id, set: c.set, collectorNumber: c.collectorNumber, finish: c.finishes.includes(r.finish) ? r.finish : c.finishes[0] });
                        }}
                        aria-label="Printing"
                      >
                        {(printings[r.key] ?? [card]).map((c) => <option key={c.id} value={c.id}>{c.set.toUpperCase()} #{c.collectorNumber}</option>)}
                      </select>
                    ) : (
                      <span className="muted small">{r.set?.toUpperCase()} {r.collectorNumber}</span>
                    )}
                  </td>
                  <td>
                    <select value={r.finish} onChange={(e) => edit(r.key, { finish: e.target.value as Finish })} aria-label="Finish">
                      {(card?.finishes ?? FINISHES).map((f) => <option key={f}>{f}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={r.condition} onChange={(e) => edit(r.key, { condition: e.target.value as Condition })} aria-label="Condition">
                      {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td><input type="number" min={1} value={r.quantity} style={{ width: "4rem" }} onChange={(e) => edit(r.key, { quantity: Math.max(1, Number(e.target.value)) })} aria-label="Quantity" /></td>
                  <td className="num">{usd(priceFor(card, r.finish))}</td>
                  <td><button className="btn small" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove row">×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row gap" style={{ marginTop: "1rem" }}>
        <b>Add {sel.size ? "selected" : "all matched"} to:</b>
        <select value={dest} onChange={(e) => setDest(e.target.value as Destination["kind"])} aria-label="Destination">
          <option value="collection">Collection</option>
          <option value="deck">Deck</option>
          <option value="wishlist">Wishlist</option>
          <option value="watchlist">Watchlist</option>
        </select>
        {dest === "collection" && (
          <select value={binder} onChange={(e) => setBinder(e.target.value)} aria-label="Binder">
            {p.binders.map((b) => <option key={b}>{b}</option>)}
          </select>
        )}
        {dest === "deck" && (
          <select value={deckId} onChange={(e) => setDeckId(e.target.value)} aria-label="Deck">
            {p.decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="__new">+ New deck</option>
          </select>
        )}
        <button className="btn primary" onClick={commit} disabled={!ok.length}>Add {ok.filter((r) => targets.has(r.key)).length} entries</button>
      </div>
      {done && <p className="up">{done}</p>}
    </div>
  );
}
