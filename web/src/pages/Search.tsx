import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Empty, PageHeader } from "../components/ui";
import { usd } from "../lib/deckstats";
import * as scry from "../lib/scryfall";
import { cacheCards } from "../lib/store";
import type { CardSummary } from "../lib/types";

const PRESETS: [string, string][] = [
  ["Most expensive in Commander", "f:commander usd>=20 order:usd"],
  ["Reserved List", "is:reserved"],
  ["Newest set", "s:latest"],
  ["Cheap staples (EDHREC top)", "f:commander usd<=2 order:edhrec"],
];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [order, setOrder] = useState(params.get("order") ?? "edhrec");
  const [res, setRes] = useState<{ cards: CardSummary[]; total: number; hasMore: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (query = q, pg = 1) => {
    if (!query.trim()) return;
    setBusy(true);
    setErr(null);
    setParams({ q: query, order });
    try {
      const r = await scry.search(query, { order, page: pg });
      cacheCards(r.cards);
      setRes(r);
      setPage(pg);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Search" sub={<>Full <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noreferrer">Scryfall syntax</a> supported, e.g. <code>t:dragon c:r usd&lt;5</code></>} />
      <form className="card row gap" onSubmit={(e) => (e.preventDefault(), void run())}>
        <input style={{ flex: 1, minWidth: 200 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cards…" aria-label="Search query" />
        <select value={order} onChange={(e) => setOrder(e.target.value)} aria-label="Sort order">
          <option value="edhrec">EDHREC popularity</option>
          <option value="usd">Price</option>
          <option value="name">Name</option>
          <option value="released">Release date</option>
          <option value="set">Set</option>
        </select>
        <button className="btn primary" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
      </form>
      <div className="row gap" style={{ marginBottom: "1rem" }}>
        {PRESETS.map(([l, query]) => (
          <button key={l} className="btn small" onClick={() => (setQ(query), void run(query))}>{l}</button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      {res && (
        <>
          <p className="muted small">{res.total.toLocaleString()} cards</p>
          {res.cards.length ? (
            <div className="card-grid">
              {res.cards.map((c) => (
                <Link key={c.id} to={`/card/${c.id}`} title={c.name}>
                  {c.imageSmall ? <img src={c.image ?? c.imageSmall} alt={c.name} loading="lazy" /> : <div className="card">{c.name}</div>}
                  <div className="row between small">
                    <span className="muted">{c.set.toUpperCase()}</span>
                    <span>{usd(c.prices.usd ?? c.prices.usdFoil)}</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>No cards found.</Empty>
          )}
          <div className="row gap" style={{ marginTop: "1rem" }}>
            {page > 1 && <button className="btn" onClick={() => void run(q, page - 1)}>Previous</button>}
            {res.hasMore && <button className="btn" onClick={() => void run(q, page + 1)}>Next page</button>}
          </div>
        </>
      )}
    </>
  );
}
