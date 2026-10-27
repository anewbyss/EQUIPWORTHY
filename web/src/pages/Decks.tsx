import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Empty, PageHeader } from "../components/ui";
import { parseList, type BatchLine } from "../lib/batch";
import { usd } from "../lib/deckstats";
import * as mox from "../lib/moxfield";
import { applySnapshot } from "../lib/prices";
import { resolveLines } from "../lib/resolve";
import { update, useProfile } from "../lib/store";
import { FORMATS, priceFor, uid, type Deck, type DeckCard, type Format, type Profile } from "../lib/types";

export function deckValue(d: Deck, p: Profile) {
  return d.cards.filter((c) => c.board !== "maybe").reduce((a, c) => a + (priceFor(p.cardCache[c.cardId], "nonfoil") ?? 0) * c.quantity, 0);
}

/** Cards in the deck you don't own (matched by card name, any printing). */
export function missingCards(d: Deck, p: Profile) {
  const owned = new Map<string, number>();
  for (const c of p.collection) owned.set(c.name, (owned.get(c.name) ?? 0) + c.quantity);
  const need = new Map<string, DeckCard>();
  for (const c of d.cards) {
    if (c.board === "maybe") continue;
    const prev = need.get(c.name);
    need.set(c.name, prev ? { ...prev, quantity: prev.quantity + c.quantity } : { ...c });
  }
  const out: (DeckCard & { missing: number })[] = [];
  for (const c of need.values()) {
    const missing = c.quantity - (owned.get(c.name) ?? 0);
    if (missing > 0) out.push({ ...c, missing });
  }
  return out;
}

export default function DecksPage() {
  const p = useProfile();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [format, setFormat] = useState<Format>("commander");
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const create = (deckName: string, fmt: Format, cards: DeckCard[] = [], source?: string) => {
    const now = new Date().toISOString();
    const d: Deck = { id: uid(), name: deckName || "Untitled deck", format: fmt, cards, source, createdAt: now, updatedAt: now };
    update((cur) => ({ ...cur, decks: [...cur.decks, d] }));
    return d;
  };

  const importDeck = async () => {
    setErr(null);
    const txt = importText.trim();
    if (!txt) return;
    let lines: BatchLine[];
    let deckName = name || "Imported deck";
    let fmt = format;
    let source: string | undefined;
    if (mox.deckIdFromUrl(txt)) {
      setBusy("Fetching from Moxfield…");
      try {
        const md = await mox.fetchDeck(txt);
        deckName = name || md.name;
        fmt = (FORMATS as string[]).includes(md.format) ? (md.format as Format) : format;
        source = txt;
        lines = md.cards.map((c, i) => ({ lineNo: i, raw: c.name, quantity: c.quantity, name: c.name, set: c.set, collectorNumber: c.collectorNumber, scryfallId: c.scryfallId, finish: "nonfoil", board: c.board }));
      } catch (e) {
        setBusy(null);
        return setErr(`Couldn't load that Moxfield deck from the browser (${(e as Error).message}). On Moxfield, open the deck, choose More → Export → Copy plain text, and paste it here.`);
      }
    } else lines = parseList(txt);
    setBusy(`Matching ${lines.length} cards…`);
    try {
      const res = await resolveLines(lines);
      const cards: DeckCard[] = [];
      for (const r of res) {
        if (!r.card) continue;
        const board = r.line.board ?? "main";
        const ex = cards.find((c) => c.cardId === r.card!.id && c.board === board);
        if (ex) ex.quantity += r.line.quantity;
        else cards.push({ cardId: r.card.id, name: r.card.name, quantity: r.line.quantity, board });
      }
      const nf = res.filter((r) => !r.card).map((r) => r.line.name);
      const d = create(deckName, fmt, cards, source);
      update((cur) => applySnapshot(cur, res.flatMap((r) => (r.card ? [r.card] : []))));
      if (nf.length) alert(`Imported. Couldn't find: ${nf.join(", ")}`);
      nav(`/deck/${d.id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Decks" sub="Build decks, check legality, and see what you still need to buy." />
      <div className="grid2">
        <div className="card stack">
          <h2>New deck</h2>
          <div className="row gap">
            <input placeholder="Deck name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Deck name" />
            <select value={format} onChange={(e) => setFormat(e.target.value as Format)} aria-label="Format">
              {FORMATS.map((f) => <option key={f}>{f}</option>)}
            </select>
            <button className="btn primary" onClick={() => nav(`/deck/${create(name, format).id}`)}>Create empty</button>
          </div>
          <h3>Or import</h3>
          <textarea rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={"Paste a Moxfield deck URL, or a decklist:\n\nCommander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring\n…"} aria-label="Deck import" />
          <button className="btn" disabled={!!busy || !importText.trim()} onClick={() => void importDeck()}>{busy ?? "Import"}</button>
          {err && <p className="error small">{err}</p>}
        </div>
        <div className="card">
          <h2>Your decks</h2>
          {p.decks.length ? (
            <table>
              <thead><tr><th>Deck</th><th>Format</th><th className="num">Cards</th><th className="num">Value</th><th className="num">To buy</th></tr></thead>
              <tbody>
                {p.decks.map((d) => {
                  const miss = missingCards(d, p);
                  const cost = miss.reduce((a, c) => a + (priceFor(p.cardCache[c.cardId], "nonfoil") ?? 0) * c.missing, 0);
                  return (
                    <tr key={d.id}>
                      <td><Link to={`/deck/${d.id}`}>{d.name}</Link></td>
                      <td>{d.format}</td>
                      <td className="num">{d.cards.filter((c) => c.board !== "maybe").reduce((a, c) => a + c.quantity, 0)}</td>
                      <td className="num">{usd(deckValue(d, p))}</td>
                      <td className="num">{miss.length ? usd(cost) : <span className="up">owned</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty>No decks yet.</Empty>
          )}
        </div>
      </div>
    </>
  );
}
