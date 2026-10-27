import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { LineChart } from "../components/LineChart";
import { Change, PageHeader, PctSlider } from "../components/ui";
import { buylistValue, pct, usd } from "../lib/deckstats";
import * as edhrec from "../lib/edhrec";
import { forecast, type Forecast } from "../lib/forecast";
import { applySnapshot, change, trackedIds } from "../lib/prices";
import * as scry from "../lib/scryfall";
import { cacheCards, getState, update, useProfile } from "../lib/store";
import { CONDITIONS, historyKey, priceFor, today, uid, type CardSummary, type Condition, type Finish } from "../lib/types";

export default function CardPage() {
  const { id = "" } = useParams();
  const p = useProfile();
  const nav = useNavigate();
  const cached = p.cardCache[id];
  const [card, setCard] = useState<CardSummary | undefined>(cached);
  const [err, setErr] = useState<string | null>(null);
  const [finish, setFinish] = useState<Finish>("nonfoil");
  const [horizon, setHorizon] = useState(30);
  const [ed, setEd] = useState<edhrec.EdhrecCardInfo | null | undefined>(undefined);
  const [printings, setPrintings] = useState<CardSummary[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setCard(getState().profile?.cardCache[id]);
    setPrintings(null);
    setEd(undefined);
    scry.byId(id).then(
      (c) => {
        if (!live) return;
        setCard(c);
        const prof = getState().profile!;
        if (trackedIds(prof).includes(c.id)) update((cur) => applySnapshot(cur, [c]));
        else cacheCards([c]);
        if (!c.finishes.includes("nonfoil") && c.finishes[0]) setFinish(c.finishes[0]);
        edhrec.cardInfo(c.name).then((i) => live && setEd(i));
      },
      (e) => live && !getState().profile?.cardCache[id] && setErr((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const series = p.priceHistory[historyKey(id, finish)] ?? [];
  const price = priceFor(card, finish);
  const synergy = p.market?.synergy.find((x) => x.cardId === id || (card?.oracleId && p.market?.cards[x.cardId]?.oracleId === card.oracleId));
  const fc = useMemo(() => (card ? forecast(card, series, price, horizon, new Date(), synergy) : null), [card, series, price, horizon, synergy]);

  if (err) return <p className="error">{err}</p>;
  if (!card) return <p className="muted">Loading…</p>;

  const owned = p.collection.filter((c) => c.cardId === id);
  const ownedAll = p.collection.filter((c) => p.cardCache[c.cardId]?.oracleId === card.oracleId);
  const watched = p.watchlist.some((w) => w.cardId === id && w.finish === finish);
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 2500);
  };

  return (
    <>
      <PageHeader title={card.name} sub={`${card.setName} (${card.set.toUpperCase()}) #${card.collectorNumber} · ${card.rarity}${card.reserved ? " · Reserved List" : ""}`}>
        <button className="btn" onClick={() => nav(-1)}>Back</button>
      </PageHeader>
      {msg && <p className="up small">{msg}</p>}
      <div className="grid3">
        <div>
          {card.image && <img className="card-img" src={card.image} alt={card.name} />}
          <div className="card" style={{ marginTop: "1rem" }}>
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>
              <b>{card.typeLine}</b> {card.manaCost}
              {card.oracleText && <p>{card.oracleText}</p>}
            </div>
            <div className="row gap small">
              {card.tcgplayerUrl && <a className="btn small" href={card.tcgplayerUrl} target="_blank" rel="noreferrer">TCGplayer</a>}
              <a className="btn small" href={card.edhrecUrl ?? edhrec.cardUrl(card.name)} target="_blank" rel="noreferrer">EDHREC</a>
              {card.scryfallUrl && <a className="btn small" href={card.scryfallUrl} target="_blank" rel="noreferrer">Scryfall</a>}
              <a className="btn small" href={`https://moxfield.com/search?q=${encodeURIComponent(`!"${card.name}"`)}`} target="_blank" rel="noreferrer">Moxfield</a>
            </div>
          </div>
        </div>

        <div style={{ gridColumn: "span 2" }}>
          <div className="card">
            <h2>Prices (TCGplayer market, USD)</h2>
            <table>
              <thead>
                <tr><th>Finish</th><th className="num">Market</th><th className="num">7d</th><th className="num">30d</th><th className="num">Store cash</th><th className="num">Store credit</th><th /></tr>
              </thead>
              <tbody>
                {card.finishes.map((f) => {
                  const pr = priceFor(card, f);
                  const s = p.priceHistory[historyKey(id, f)];
                  return (
                    <tr key={f} style={f === finish ? { fontWeight: 600 } : undefined}>
                      <td>{f}</td>
                      <td className="num">{usd(pr)}</td>
                      <td className="num"><Change v={change(s, 7)} /></td>
                      <td className="num"><Change v={change(s, 30)} /></td>
                      <td className="num">{pr != null ? usd(buylistValue(pr, p.settings.buylistCashPct, "NM", p.settings)) : "—"}</td>
                      <td className="num">{pr != null ? usd(buylistValue(pr, p.settings.buylistCreditPct, "NM", p.settings)) : "—"}</td>
                      <td><button className="btn small" onClick={() => setFinish(f)} disabled={f === finish}>View</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Price history · {finish}</h2>
            <LineChart series={series} label={`${finish} price`} />
            {!trackedIds(p).includes(id) && (
              <p className="muted small">This card isn't tracked yet. Add it to your collection, a deck or your watchlist and EquipWorthy will record its price every day.</p>
            )}
          </div>

          {fc && <ForecastPanel fc={fc} horizon={horizon} setHorizon={setHorizon} />}

          <BuylistPanel price={price} />

          <div className="grid2">
            <AddToCollection card={card} finish={finish} onDone={flash} />
            <div className="card stack">
              <h2>Track</h2>
              <button
                className="btn"
                onClick={() => {
                  if (watched) update((cur) => ({ ...cur, watchlist: cur.watchlist.filter((w) => !(w.cardId === id && w.finish === finish)) }));
                  else update((cur) => ({ ...cur, watchlist: [...cur.watchlist, { id: uid(), cardId: id, name: card.name, finish, addedAt: new Date().toISOString(), below: price ? Math.round(price * 0.85 * 100) / 100 : undefined }] }));
                  flash(watched ? "Removed from watchlist" : "Added to watchlist. Set alert targets on the Watchlist page.");
                }}
              >
                {watched ? "★ Watching" : "☆ Add to watchlist"}
              </button>
              <button className="btn" onClick={() => (update((cur) => ({ ...cur, wishlist: [...cur.wishlist, { id: uid(), cardId: id, name: card.name, finish, quantity: 1, addedAt: new Date().toISOString() }] })), flash("Added to wishlist"))}>
                Add to wishlist
              </button>
              <AddToDeck card={card} onDone={flash} />
              <p className="muted small">
                You own {owned.reduce((a, c) => a + c.quantity, 0)} of this printing and {ownedAll.reduce((a, c) => a + c.quantity, 0)} across all printings.
              </p>
            </div>
          </div>

          <div className="card">
            <h2>EDHREC</h2>
            {ed === undefined ? (
              <p className="muted small">Loading…</p>
            ) : ed ? (
              <div className="grid2">
                <div>
                  <p>
                    In <b>{ed.numDecks?.toLocaleString() ?? "?"}</b> decks{ed.inclusionPct != null && <> ({ed.inclusionPct.toFixed(1)}% of {ed.potentialDecks?.toLocaleString()} possible)</>}.
                    {card.edhrecRank != null && <> Rank #{card.edhrecRank}.</>}
                  </p>
                  <h3>Top commanders</h3>
                  <ul className="small">{ed.topCommanders.map((c) => <li key={c.name}><a href={edhrec.commanderUrl(c.name)} target="_blank" rel="noreferrer">{c.name}</a></li>)}</ul>
                </div>
                <div>
                  <h3>High-synergy cards</h3>
                  <ul className="small">{ed.synergies.map((c) => <li key={c.name}>{c.name}</li>)}</ul>
                </div>
              </div>
            ) : (
              <p className="muted small">
                {card.edhrecRank != null ? <>EDHREC rank #{card.edhrecRank}. </> : null}
                Detailed EDHREC data couldn't be loaded from this browser. <a href={card.edhrecUrl ?? edhrec.cardUrl(card.name)} target="_blank" rel="noreferrer">Open on EDHREC</a>.
              </p>
            )}
          </div>

          <div className="card">
            <div className="row between">
              <h2>Printings</h2>
              {!printings && <button className="btn small" onClick={() => scry.prints(card).then((ps) => (setPrintings(ps), cacheCards(ps)))}>Load all printings</button>}
            </div>
            {printings && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Set</th><th>#</th><th>Released</th><th className="num">Normal</th><th className="num">Foil</th><th className="num">Etched</th></tr></thead>
                  <tbody>
                    {printings.map((pr) => (
                      <tr key={pr.id} style={pr.id === id ? { fontWeight: 600 } : undefined}>
                        <td><Link to={`/card/${pr.id}`}>{pr.setName}</Link></td>
                        <td>{pr.collectorNumber}</td>
                        <td>{pr.releasedAt}</td>
                        <td className="num">{usd(pr.prices.usd)}</td>
                        <td className="num">{usd(pr.prices.usdFoil)}</td>
                        <td className="num">{usd(pr.prices.usdEtched)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ForecastPanel({ fc, horizon, setHorizon }: { fc: Forecast; horizon: number; setHorizon: (h: number) => void }) {
  const lo = Math.min(fc.lowPct, -1), hi = Math.max(fc.highPct, 1);
  const span = Math.max(Math.abs(lo), Math.abs(hi));
  const pos = (v: number) => `${50 + (v / span) * 50}%`;
  const target = fc.price * (1 + fc.expectedPct / 100);
  return (
    <div className="card">
      <div className="row between">
        <h2>Forecast</h2>
        <div className="seg">
          {[7, 30].map((h) => (
            <button key={h} className={horizon === h ? "on" : ""} onClick={() => setHorizon(h)}>{h} days</button>
          ))}
        </div>
      </div>
      <div className="forecast-head">
        <span className={`forecast-big ${fc.direction === "up" ? "up" : fc.direction === "down" ? "down" : ""}`}>
          {fc.direction === "up" ? "▲ Likely up" : fc.direction === "down" ? "▼ Likely down" : "◆ Likely flat"}
        </span>
        <span>
          {pct(fc.expectedPct)} → about <b>{usd(target)}</b>
        </span>
        <span className="pill">{fc.confidenceLabel} confidence</span>
      </div>
      <div className="range-bar" aria-label={`80% range ${pct(fc.lowPct)} to ${pct(fc.highPct)}`}>
        <div className="fill" style={{ left: pos(fc.lowPct), width: `calc(${pos(fc.highPct)} - ${pos(fc.lowPct)})` }} />
        <div className="zero" style={{ left: "50%" }} />
        <div className="mid" style={{ left: pos(fc.expectedPct) }} />
      </div>
      <p className="muted small">
        80% range: {pct(fc.lowPct)} to {pct(fc.highPct)} ({usd(fc.price * (1 + fc.lowPct / 100))} – {usd(fc.price * (1 + fc.highPct / 100))}). Reprint risk {Math.round(fc.reprintRisk * 100)}%. Based on {fc.historyPoints} day{fc.historyPoints === 1 ? "" : "s"} of local history.
      </p>
      <h3>Why</h3>
      {fc.factors.length ? (
        fc.factors.map((f) => (
          <div className="factor" key={f.label}>
            <div>
              <b>{f.label}</b>
              <div className="muted small">{f.detail}</div>
            </div>
            <span className={`num ${f.impactPct > 0 ? "up" : f.impactPct < 0 ? "down" : ""}`}>{pct(f.impactPct)}/30d</span>
          </div>
        ))
      ) : (
        <p className="muted small">No strong signals.</p>
      )}
      <p className="muted small">Statistical estimate, not financial advice. Check the dashboard to see how accurate past forecasts were.</p>
    </div>
  );
}

function BuylistPanel({ price }: { price?: number }) {
  const p = useProfile();
  const [cond, setCond] = useState<Condition>("NM");
  const s = p.settings;
  const setPct = (k: "buylistCashPct" | "buylistCreditPct", v: number) => update((cur) => ({ ...cur, settings: { ...cur.settings, [k]: v } }));
  return (
    <div className="card">
      <h2>What would a store pay?</h2>
      <div className="grid2">
        <PctSlider label="Cash offer" value={s.buylistCashPct} onChange={(v) => setPct("buylistCashPct", v)} />
        <PctSlider label="Store credit" value={s.buylistCreditPct} onChange={(v) => setPct("buylistCreditPct", v)} />
      </div>
      <div className="row gap" style={{ marginTop: "0.75rem" }}>
        <label className="small">
          Condition{" "}
          <select value={cond} onChange={(e) => setCond(e.target.value as Condition)}>
            {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <span>Cash: <b>{price != null ? usd(buylistValue(price, s.buylistCashPct, cond, s)) : "—"}</b></span>
        <span>Credit: <b>{price != null ? usd(buylistValue(price, s.buylistCreditPct, cond, s)) : "—"}</b></span>
      </div>
      <p className="muted small">Most local game stores pay 40–60% of market in cash and 55–75% in credit. Your slider settings are saved and used across the app.</p>
    </div>
  );
}

function AddToCollection({ card, finish, onDone }: { card: CardSummary; finish: Finish; onDone: (m: string) => void }) {
  const p = useProfile();
  const [qty, setQty] = useState(1);
  const [cond, setCond] = useState<Condition>(p.settings.defaultCondition);
  const [binder, setBinder] = useState(p.settings.defaultBinder);
  const [f, setF] = useState<Finish>(finish);
  const [cost, setCost] = useState("");
  useEffect(() => setF(finish), [finish]);
  const add = () => {
    update((cur) => {
      const existing = cur.collection.find((c) => c.cardId === card.id && c.finish === f && c.condition === cond && c.binder === binder && c.language === "en");
      const collection = existing
        ? cur.collection.map((c) => (c === existing ? { ...c, quantity: c.quantity + qty } : c))
        : [...cur.collection, { id: uid(), cardId: card.id, name: card.name, set: card.set, collectorNumber: card.collectorNumber, finish: f, condition: cond, language: "en", quantity: qty, binder, purchasePrice: cost ? Number(cost) : undefined, purchaseDate: cost ? today() : undefined, addedAt: new Date().toISOString() }];
      return applySnapshot({ ...cur, collection }, [card]);
    });
    onDone(`Added ${qty}× ${card.name} to ${binder}`);
  };
  return (
    <div className="card stack">
      <h2>Add to collection</h2>
      <div className="row gap">
        <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} aria-label="Quantity" />
        <select value={f} onChange={(e) => setF(e.target.value as Finish)} aria-label="Finish">
          {card.finishes.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select value={cond} onChange={(e) => setCond(e.target.value as Condition)} aria-label="Condition">
          {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="row gap">
        <select value={binder} onChange={(e) => setBinder(e.target.value)} aria-label="Binder">
          {p.binders.map((b) => <option key={b}>{b}</option>)}
        </select>
        <input placeholder="Paid $ (optional)" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ""))} style={{ width: "9rem" }} aria-label="Purchase price" />
      </div>
      <button className="btn primary" onClick={add}>Add</button>
    </div>
  );
}

function AddToDeck({ card, onDone }: { card: CardSummary; onDone: (m: string) => void }) {
  const p = useProfile();
  const [deckId, setDeckId] = useState(p.decks[0]?.id ?? "");
  if (!p.decks.length) return <Link className="btn" to="/decks">Create a deck to add this card</Link>;
  return (
    <div className="row gap">
      <select value={deckId} onChange={(e) => setDeckId(e.target.value)} aria-label="Deck">
        {p.decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <button
        className="btn"
        onClick={() => {
          update((cur) => ({
            ...cur,
            decks: cur.decks.map((d) => {
              if (d.id !== deckId) return d;
              const ex = d.cards.find((c) => c.cardId === card.id && c.board === "main");
              const cards = ex ? d.cards.map((c) => (c === ex ? { ...c, quantity: c.quantity + 1 } : c)) : [...d.cards, { cardId: card.id, name: card.name, quantity: 1, board: "main" as const }];
              return { ...d, cards, updatedAt: new Date().toISOString() };
            }),
          }));
          onDone(`Added to ${p.decks.find((d) => d.id === deckId)?.name}`);
        }}
      >
        Add to deck
      </button>
    </div>
  );
}
