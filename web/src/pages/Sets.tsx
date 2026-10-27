import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui";
import { usd } from "../lib/deckstats";
import * as scry from "../lib/scryfall";
import { cacheCards } from "../lib/store";
import type { CardSummary } from "../lib/types";

const MAIN_TYPES = new Set(["expansion", "core", "masters", "draft_innovation", "commander", "funny", "starter"]);

export default function SetsPage() {
  const [sets, setSets] = useState<scry.SetInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<scry.SetInfo | null>(null);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [sort, setSort] = useState<"set" | "price">("set");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    scry.sets().then(setSets, (e) => setErr((e as Error).message));
  }, []);

  const openSet = async (s: scry.SetInfo) => {
    setOpen(s);
    setCards([]);
    setLoading(true);
    try {
      let page = 1;
      const out: CardSummary[] = [];
      for (;;) {
        const r = await scry.setCards(s.code, page);
        out.push(...r.cards);
        setCards([...out]);
        if (!r.hasMore || page >= 6) break;
        page++;
      }
      cacheCards(out);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const list = (sets ?? []).filter((s) => all || MAIN_TYPES.has(s.set_type));
  const upcoming = list.filter((s) => (s.released_at ?? "") > today).reverse();
  const recent = list.filter((s) => (s.released_at ?? "") <= today).slice(0, all ? 400 : 60);
  const shown = sort === "price" ? [...cards].sort((a, b) => (b.prices.usd ?? b.prices.usdFoil ?? 0) - (a.prices.usd ?? a.prices.usdFoil ?? 0)) : cards;

  if (open)
    return (
      <>
        <PageHeader title={open.name} sub={`${open.code.toUpperCase()} · ${open.released_at ?? "TBA"} · ${open.card_count} cards`}>
          <select value={sort} onChange={(e) => setSort(e.target.value as "set")} aria-label="Sort">
            <option value="set">Set order</option>
            <option value="price">Price</option>
          </select>
          <button className="btn" onClick={() => setOpen(null)}>All sets</button>
        </PageHeader>
        {loading && <p className="muted small">Loading cards… {cards.length}</p>}
        {!loading && !cards.length && <p className="muted">No cards previewed yet.</p>}
        <div className="card-grid">
          {shown.map((c) => (
            <Link key={c.id} to={`/card/${c.id}`} title={c.name}>
              {c.image ? <img src={c.image} alt={c.name} loading="lazy" /> : <div className="card">{c.name}</div>}
              <div className="row between small">
                <span className="muted">#{c.collectorNumber}</span>
                <span>{usd(c.prices.usd ?? c.prices.usdFoil)}</span>
              </div>
            </Link>
          ))}
        </div>
      </>
    );

  const tile = (s: scry.SetInfo) => (
    <button key={s.code} className="set-tile" onClick={() => void openSet(s)}>
      {s.icon_svg_uri && <img src={s.icon_svg_uri} alt="" />}
      <div><b>{s.name}</b></div>
      <div className="muted small">{s.code.toUpperCase()} · {s.released_at ?? "TBA"} · {s.card_count} cards</div>
    </button>
  );

  return (
    <>
      <PageHeader title="Sets & Spoilers" sub="Upcoming sets with preview cards revealed so far, and every released set.">
        <label className="row gap small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show all set types</label>
      </PageHeader>
      {err && <p className="error">{err}</p>}
      {!sets && !err && <p className="muted">Loading sets…</p>}
      {upcoming.length > 0 && (
        <div className="card">
          <h2>Upcoming & spoilers</h2>
          <div className="set-grid">{upcoming.map(tile)}</div>
        </div>
      )}
      <div className="card">
        <h2>Released</h2>
        <div className="set-grid">{recent.map(tile)}</div>
      </div>
    </>
  );
}
