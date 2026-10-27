import { useState } from "react";
import { Link } from "react-router-dom";
import { CardPicker, Empty, PageHeader, PctSlider } from "../components/ui";
import { usd } from "../lib/deckstats";
import * as scry from "../lib/scryfall";
import { cacheCards, update, useProfile } from "../lib/store";
import { priceFor, uid, type CardSummary, type Finish, type Trade, type TradeSideCard } from "../lib/types";

const blank = (): Trade => {
  const now = new Date().toISOString();
  return { id: uid(), name: `Trade ${now.slice(0, 10)}`, mine: [], theirs: [], mineCash: 0, theirsCash: 0, createdAt: now, updatedAt: now };
};

const sideTotal = (cards: TradeSideCard[], cash: number) => cards.reduce((a, c) => a + c.price * c.quantity, 0) + cash;

/** Balance-beam illustration. Tilts toward the heavier side. */
export function Scale({ left, right }: { left: number; right: number }) {
  const total = left + right;
  const diff = right - left; // positive => right heavier
  const angle = total > 0 ? Math.max(-18, Math.min(18, (diff / total) * 40)) : 0;
  const rad = (angle * Math.PI) / 180;
  const L = 200; // half beam length
  const lx = 280 - L * Math.cos(rad), ly = 90 - L * Math.sin(rad);
  const rx = 280 + L * Math.cos(rad), ry = 90 + L * Math.sin(rad);
  const pan = (x: number, y: number, v: number, label: string) => (
    <g>
      <line x1={x} y1={y} x2={x - 55} y2={y + 80} className="string" />
      <line x1={x} y1={y} x2={x + 55} y2={y + 80} className="string" />
      <path d={`M${x - 70},${y + 80} Q${x},${y + 130} ${x + 70},${y + 80} Z`} className="pan" />
      <text x={x} y={y + 160} className="val">{usd(v)}</text>
      <text x={x} y={y + 178} className="lbl">{label}</text>
    </g>
  );
  return (
    <div className="scale-wrap">
      <svg viewBox="0 0 560 320" className="scale-svg" role="img" aria-label={`Trade scale: you give ${usd(left)}, you get ${usd(right)}`}>
        <rect x={230} y={290} width={100} height={14} rx={7} className="base" />
        <line x1={280} y1={90} x2={280} y2={292} className="post" />
        <line x1={lx} y1={ly} x2={rx} y2={ry} className="beam" />
        <circle cx={280} cy={90} r={10} className="pivot" />
        {pan(lx, ly, left, "You give")}
        {pan(rx, ry, right, "You get")}
      </svg>
    </div>
  );
}

export default function TradePage() {
  const p = useProfile();
  const [tradeId, setTradeId] = useState<string | null>(p.trades[0]?.id ?? null);
  const trade = p.trades.find((t) => t.id === tradeId);
  const [storeMode, setStoreMode] = useState(false);

  const newTrade = () => {
    const t = blank();
    update((cur) => ({ ...cur, trades: [t, ...cur.trades] }));
    setTradeId(t.id);
  };
  const setTrade = (fn: (t: Trade) => Trade) => trade && update((cur) => ({ ...cur, trades: cur.trades.map((t) => (t.id === trade.id ? { ...fn(t), updatedAt: new Date().toISOString() } : t)) }));

  if (!trade)
    return (
      <>
        <PageHeader title="Trade Scale" sub="Put cards on each side and balance the trade." />
        <Empty>
          <button className="btn primary" onClick={newTrade}>Start a trade</button>
        </Empty>
      </>
    );

  const give = sideTotal(trade.mine, trade.mineCash);
  const getRaw = sideTotal(trade.theirs, trade.theirsCash);
  // Store mode: the store pays you credit% of market for your cards
  const giveValued = storeMode ? give * (p.settings.buylistCreditPct / 100) : give;
  const get = getRaw;
  const diff = get - giveValued;
  const fair = Math.max(giveValued, get) === 0 || Math.abs(diff) / Math.max(giveValued, get) <= 0.05;

  const addCard = (side: "mine" | "theirs") => (c: CardSummary) => {
    const finish: Finish = c.finishes.includes("nonfoil") ? "nonfoil" : c.finishes[0];
    setTrade((t) => ({ ...t, [side]: [...t[side], { cardId: c.id, name: c.name, finish, quantity: 1, price: priceFor(c, finish) ?? 0 }] }));
  };

  const reprice = async () => {
    const ids = [...trade.mine, ...trade.theirs].map((c) => ({ id: c.cardId }));
    const { found } = await scry.collection(ids);
    cacheCards(found);
    const fix = (cs: TradeSideCard[]) => cs.map((c) => ({ ...c, price: priceFor(found.find((f) => f.id === c.cardId), c.finish) ?? c.price }));
    setTrade((t) => ({ ...t, mine: fix(t.mine), theirs: fix(t.theirs) }));
  };

  // Balancing suggestions from the trade binder
  const gap = Math.abs(diff);
  const needFromMe = diff > 0;
  const suggestions = needFromMe
    ? p.collection
        .filter((c) => c.binder === "Trade Binder" && !trade.mine.some((m) => m.cardId === c.cardId))
        .map((c) => ({ c, v: priceFor(p.cardCache[c.cardId], c.finish) ?? 0 }))
        .filter((x) => x.v > 0 && x.v <= gap * 1.1)
        .sort((a, b) => Math.abs(gap - a.v) - Math.abs(gap - b.v))
        .slice(0, 5)
    : [];

  return (
    <>
      <PageHeader title="Trade Scale" sub="Put cards on each side and balance the trade. Prices are TCGplayer market.">
        <select value={trade.id} onChange={(e) => setTradeId(e.target.value)} aria-label="Saved trades">
          {p.trades.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="btn" onClick={newTrade}>New</button>
        <button className="btn" onClick={() => void reprice()}>Refresh prices</button>
      </PageHeader>

      <div className="card">
        <Scale left={giveValued} right={get} />
        <p className={`balance ${fair ? "up" : ""}`}>
          {fair
            ? "⚖ Balanced (within 5%)"
            : diff > 0
              ? `You're getting ${usd(gap)} more. Add about ${usd(gap)} to your side to even it out.`
              : `You're giving ${usd(gap)} more. Ask for about ${usd(gap)} more from them.`}
        </p>
        <div className="row gap" style={{ justifyContent: "center" }}>
          <label className="row gap small">
            <input type="checkbox" checked={storeMode} onChange={(e) => setStoreMode(e.target.checked)} /> Trading in to a store (value my side at store credit)
          </label>
          {storeMode && <div style={{ minWidth: 260 }}><PctSlider label="Store credit" value={p.settings.buylistCreditPct} onChange={(v) => update((cur) => ({ ...cur, settings: { ...cur.settings, buylistCreditPct: v } }))} /></div>}
        </div>
      </div>

      <div className="grid2">
        <Side title="You give" cards={trade.mine} cash={trade.mineCash} onPick={addCard("mine")} onChange={(mine) => setTrade((t) => ({ ...t, mine }))} onCash={(mineCash) => setTrade((t) => ({ ...t, mineCash }))} total={give} />
        <Side title="You get" cards={trade.theirs} cash={trade.theirsCash} onPick={addCard("theirs")} onChange={(theirs) => setTrade((t) => ({ ...t, theirs }))} onCash={(theirsCash) => setTrade((t) => ({ ...t, theirsCash }))} total={getRaw} />
      </div>

      {suggestions.length > 0 && (
        <div className="card">
          <h2>Balance it from your Trade Binder</h2>
          <table>
            <tbody>
              {suggestions.map(({ c, v }) => (
                <tr key={c.id}>
                  <td><Link to={`/card/${c.cardId}`}>{c.name}</Link> <span className="muted small">{c.set.toUpperCase()} · {c.finish} · {c.condition}</span></td>
                  <td className="num">{usd(v)}</td>
                  <td><button className="btn small" onClick={() => setTrade((t) => ({ ...t, mine: [...t.mine, { cardId: c.cardId, name: c.name, finish: c.finish, quantity: 1, price: v }] }))}>Add to my side</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card row gap">
        <input value={trade.name} onChange={(e) => setTrade((t) => ({ ...t, name: e.target.value }))} aria-label="Trade name" />
        <button className="btn danger" onClick={() => { if (confirm("Delete this trade?")) { update((cur) => ({ ...cur, trades: cur.trades.filter((t) => t.id !== trade.id) })); setTradeId(null); } }}>Delete trade</button>
      </div>
    </>
  );
}

function Side(props: { title: string; cards: TradeSideCard[]; cash: number; total: number; onPick: (c: CardSummary) => void; onChange: (c: TradeSideCard[]) => void; onCash: (v: number) => void }) {
  const p = useProfile();
  const { cards, onChange } = props;
  const set = (i: number, patch: Partial<TradeSideCard>) => onChange(cards.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="card stack">
      <div className="row between">
        <h2>{props.title}</h2>
        <b>{usd(props.total)}</b>
      </div>
      <CardPicker onPick={props.onPick} placeholder="Add a card…" />
      {cards.length > 0 && (
        <table>
          <tbody>
            {cards.map((c, i) => {
              const card = p.cardCache[c.cardId];
              return (
                <tr key={i}>
                  <td><input type="number" min={1} value={c.quantity} style={{ width: "3.5rem" }} onChange={(e) => set(i, { quantity: Math.max(1, Number(e.target.value)) })} aria-label="Quantity" /></td>
                  <td>
                    <Link to={`/card/${c.cardId}`}>{c.name}</Link>
                    <div>
                      <select value={c.finish} onChange={(e) => { const f = e.target.value as Finish; set(i, { finish: f, price: priceFor(card, f) ?? c.price }); }} aria-label="Finish">
                        {(card?.finishes ?? ["nonfoil"]).map((f) => <option key={f}>{f}</option>)}
                      </select>
                    </div>
                  </td>
                  <td className="num"><input value={c.price} style={{ width: "5rem" }} onChange={(e) => set(i, { price: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} aria-label="Price override" title="Override price" /></td>
                  <td><button className="btn small" onClick={() => onChange(cards.filter((_, j) => j !== i))} aria-label="Remove">×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <label className="small row gap">Cash $ <input type="number" min={0} step="0.01" value={props.cash} onChange={(e) => props.onCash(Number(e.target.value) || 0)} /></label>
    </div>
  );
}
