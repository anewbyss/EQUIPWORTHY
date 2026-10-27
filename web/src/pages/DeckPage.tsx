import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bars } from "../components/LineChart";
import { CardPicker, Empty, PageHeader, Stat, Thumb } from "../components/ui";
import { atLeast, colorCounts, legality, manaCurve, shuffle, typeCounts, usd } from "../lib/deckstats";
import * as edhrec from "../lib/edhrec";
import { applySnapshot } from "../lib/prices";
import { download, update, useProfile } from "../lib/store";
import { FORMATS, priceFor, uid, type Board, type CardSummary, type Deck, type DeckCard, type Format } from "../lib/types";
import { deckValue, missingCards } from "./Decks";

const BOARDS: [Board, string][] = [
  ["commander", "Commander"],
  ["main", "Main deck"],
  ["side", "Sideboard"],
  ["maybe", "Maybeboard"],
];

export function deckToText(d: Deck): string {
  const out: string[] = [];
  for (const [b, label] of BOARDS) {
    const cards = d.cards.filter((c) => c.board === b);
    if (!cards.length) continue;
    out.push(label === "Main deck" ? "Deck" : label);
    cards.forEach((c) => out.push(`${c.quantity} ${c.name}`));
    out.push("");
  }
  return out.join("\n").trim();
}

export default function DeckPage() {
  const { id } = useParams();
  const p = useProfile();
  const nav = useNavigate();
  const deck = p.decks.find((d) => d.id === id);
  const [board, setBoard] = useState<Board>("main");
  const [copied, setCopied] = useState(false);

  if (!deck) return <Empty>Deck not found. <Link to="/decks">Back to decks</Link></Empty>;

  const setDeck = (fn: (d: Deck) => Deck) => update((cur) => ({ ...cur, decks: cur.decks.map((d) => (d.id === deck.id ? { ...fn(d), updatedAt: new Date().toISOString() } : d)) }));
  const setCards = (fn: (c: DeckCard[]) => DeckCard[]) => setDeck((d) => ({ ...d, cards: fn(d.cards).filter((c) => c.quantity > 0) }));
  const add = (c: CardSummary) => {
    setCards((cs) => {
      const ex = cs.find((x) => x.cardId === c.id && x.board === board);
      return ex ? cs.map((x) => (x === ex ? { ...x, quantity: x.quantity + 1 } : x)) : [...cs, { cardId: c.id, name: c.name, quantity: 1, board }];
    });
    update((cur) => applySnapshot(cur, [c]));
  };

  const issues = legality(deck, p.cardCache);
  const missing = missingCards(deck, p);
  const missingCost = missing.reduce((a, c) => a + (priceFor(p.cardCache[c.cardId], "nonfoil") ?? 0) * c.missing, 0);
  const mainCount = deck.cards.filter((c) => c.board === "main" || c.board === "commander").reduce((a, c) => a + c.quantity, 0);
  const commander = deck.cards.find((c) => c.board === "commander");

  return (
    <>
      <PageHeader title={deck.name} sub={`${deck.format} · ${mainCount} cards${deck.source ? " · imported" : ""}`}>
        <button className="btn" onClick={() => { void navigator.clipboard.writeText(deckToText(deck)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied!" : "Copy list"}</button>
        <button className="btn" onClick={() => download(`${deck.name}.txt`, deckToText(deck))}>Export</button>
        <button className="btn danger" onClick={() => { if (confirm(`Delete ${deck.name}?`)) { update((cur) => ({ ...cur, decks: cur.decks.filter((d) => d.id !== deck.id) })); nav("/decks"); } }}>Delete</button>
      </PageHeader>

      <div className="card row gap">
        <input value={deck.name} onChange={(e) => setDeck((d) => ({ ...d, name: e.target.value }))} aria-label="Deck name" />
        <select value={deck.format} onChange={(e) => setDeck((d) => ({ ...d, format: e.target.value as Format }))} aria-label="Format">
          {FORMATS.map((f) => <option key={f}>{f}</option>)}
        </select>
        {deck.source && <a href={deck.source} target="_blank" rel="noreferrer">Moxfield source</a>}
        {commander && <a href={edhrec.commanderUrl(commander.name)} target="_blank" rel="noreferrer">EDHREC page for {commander.name}</a>}
      </div>

      <div className="stats">
        <Stat label="Deck value" value={usd(deckValue(deck, p))} sub="non-foil market" />
        <Stat label="Cost to finish" value={missing.length ? usd(missingCost) : "—"} sub={missing.length ? `${missing.reduce((a, c) => a + c.missing, 0)} cards you don't own` : "You own every card"} />
        <Stat label="Legality" value={issues.length ? <span className="down">{issues.length} issue{issues.length > 1 ? "s" : ""}</span> : <span className="up">Legal</span>} sub={deck.format} />
      </div>

      <div className="grid2">
        <div>
          <div className="card row gap">
            <select value={board} onChange={(e) => setBoard(e.target.value as Board)} aria-label="Board">
              {BOARDS.map(([b, l]) => <option key={b} value={b}>{l}</option>)}
            </select>
            <CardPicker onPick={add} placeholder="Add a card…" />
          </div>
          {BOARDS.map(([b, label]) => {
            const cards = deck.cards.filter((c) => c.board === b);
            if (!cards.length) return null;
            return (
              <div className="card" key={b}>
                <h2>{label} ({cards.reduce((a, c) => a + c.quantity, 0)})</h2>
                <table>
                  <tbody>
                    {[...cards].sort((a, c) => (p.cardCache[a.cardId]?.cmc ?? 0) - (p.cardCache[c.cardId]?.cmc ?? 0) || a.name.localeCompare(c.name)).map((c) => {
                      const card = p.cardCache[c.cardId];
                      const miss = missing.find((m) => m.name === c.name);
                      return (
                        <tr key={c.cardId + c.board}>
                          <td style={{ width: 70 }}>
                            <input type="number" min={0} value={c.quantity} style={{ width: "3.6rem" }} onChange={(e) => setCards((cs) => cs.map((x) => (x === c ? { ...x, quantity: Number(e.target.value) } : x)))} aria-label="Quantity" />
                          </td>
                          <td>
                            <Link to={`/card/${c.cardId}`}>{c.name}</Link>{" "}
                            {miss ? <span className="pill bad" title="Not in your collection">need {miss.missing}</span> : <span className="pill ok">owned</span>}
                            <div className="muted small">{card?.typeLine} {card?.manaCost}</div>
                          </td>
                          <td className="num">{usd(priceFor(card, "nonfoil"))}</td>
                          <td>
                            <select value={c.board} onChange={(e) => setCards((cs) => cs.map((x) => (x === c ? { ...x, board: e.target.value as Board } : x)))} aria-label="Move to board">
                              {BOARDS.map(([bb, l]) => <option key={bb} value={bb}>{l}</option>)}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
          {!deck.cards.length && <Empty>Add cards with the search above, or import a list from the Decks page.</Empty>}
        </div>

        <div>
          {issues.length > 0 && (
            <div className="card">
              <h2>Legality issues</h2>
              <ul className="small">{issues.slice(0, 30).map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          )}
          <div className="card">
            <h2>Mana curve</h2>
            <Bars values={manaCurve(deck, p.cardCache)} labels={["0", "1", "2", "3", "4", "5", "6", "7+"]} />
          </div>
          <div className="grid2">
            <div className="card">
              <h3>Colors (nonland)</h3>
              <table><tbody>{Object.entries(colorCounts(deck, p.cardCache)).filter(([, v]) => v).map(([k, v]) => <tr key={k}><td>{{ W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" }[k]}</td><td className="num">{v}</td></tr>)}</tbody></table>
            </div>
            <div className="card">
              <h3>Types</h3>
              <table><tbody>{Object.entries(typeCounts(deck, p.cardCache)).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}</tbody></table>
            </div>
          </div>
          <SampleHand deck={deck} cards={p.cardCache} />
          <DrawOdds deckSize={mainCount} deck={deck} />
          {missing.length > 0 && (
            <div className="card">
              <div className="row between">
                <h2>Shopping list</h2>
                <button
                  className="btn small"
                  onClick={() =>
                    update((cur) => ({
                      ...cur,
                      wishlist: [...cur.wishlist, ...missing.filter((m) => !cur.wishlist.some((w) => w.cardId === m.cardId)).map((m) => ({ id: uid(), cardId: m.cardId, name: m.name, finish: "nonfoil" as const, quantity: m.missing, addedAt: new Date().toISOString() }))],
                    }))
                  }
                >
                  Add all to wishlist
                </button>
              </div>
              <table>
                <tbody>
                  {missing.sort((a, b) => (priceFor(p.cardCache[b.cardId], "nonfoil") ?? 0) - (priceFor(p.cardCache[a.cardId], "nonfoil") ?? 0)).map((m) => (
                    <tr key={m.name}><td>{m.missing}× {m.name}</td><td className="num">{usd((priceFor(p.cardCache[m.cardId], "nonfoil") ?? 0) * m.missing)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                <a href={`https://www.tcgplayer.com/massentry?productline=Magic&c=${encodeURIComponent(missing.map((m) => `${m.missing} ${m.name}`).join("||"))}`} target="_blank" rel="noreferrer">Buy on TCGplayer (mass entry)</a>
              </p>
            </div>
          )}
          <div className="card">
            <h3>Notes</h3>
            <textarea rows={4} value={deck.notes ?? ""} onChange={(e) => setDeck((d) => ({ ...d, notes: e.target.value }))} aria-label="Deck notes" />
          </div>
        </div>
      </div>
    </>
  );
}

function SampleHand({ deck, cards }: { deck: Deck; cards: Record<string, CardSummary> }) {
  const library = useMemo(() => deck.cards.filter((c) => c.board === "main").flatMap((c) => Array.from({ length: c.quantity }, () => c.cardId)), [deck]);
  const [order, setOrder] = useState<string[]>([]);
  const [drawn, setDrawn] = useState(0);
  const draw = (n: number) => {
    setOrder(shuffle(library));
    setDrawn(n);
  };
  return (
    <div className="card">
      <div className="row between">
        <h2>Sample hand</h2>
        <div className="row gap">
          <button className="btn small" onClick={() => draw(7)} disabled={library.length < 7}>New 7</button>
          <button className="btn small" onClick={() => draw(Math.max(1, (drawn || 7) - 1))} disabled={!drawn}>Mulligan</button>
          <button className="btn small" onClick={() => setDrawn((d) => Math.min(order.length, d + 1))} disabled={!drawn}>Draw</button>
        </div>
      </div>
      {drawn ? (
        <div className="hand">{order.slice(0, drawn).map((id, i) => (cards[id]?.imageSmall ? <img key={i} src={cards[id].imageSmall} alt={cards[id].name} title={cards[id].name} /> : <Thumb key={i} />))}</div>
      ) : (
        <p className="muted small">Draw an opening hand from your main deck.</p>
      )}
    </div>
  );
}

function DrawOdds({ deckSize, deck }: { deckSize: number; deck: Deck }) {
  const [K, setK] = useState(4);
  const [turn, setTurn] = useState(3);
  const [k, setKk] = useState(1);
  const [play, setPlay] = useState(true);
  const N = Math.max(deckSize - deck.cards.filter((c) => c.board === "commander").reduce((a, c) => a + c.quantity, 0), 1);
  const draws = 7 + turn - (play ? 1 : 0);
  const prob = atLeast(N, Math.min(K, N), Math.min(draws, N), k);
  return (
    <div className="card stack">
      <h2>Draw odds</h2>
      <div className="row gap small">
        <label>Copies in deck <input type="number" min={0} value={K} onChange={(e) => setK(Number(e.target.value))} /></label>
        <label>By turn <input type="number" min={1} value={turn} onChange={(e) => setTurn(Number(e.target.value))} /></label>
        <label>At least <input type="number" min={1} value={k} onChange={(e) => setKk(Number(e.target.value))} /></label>
        <label><input type="checkbox" checked={play} onChange={(e) => setPlay(e.target.checked)} /> On the play</label>
      </div>
      <p>
        Chance to see at least {k} of {K} by turn {turn}: <b style={{ fontSize: "1.3rem" }}>{(prob * 100).toFixed(1)}%</b>
        <span className="muted small"> ({draws} cards seen from {N})</span>
      </p>
    </div>
  );
}
