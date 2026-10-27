import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LineChart } from "../components/LineChart";
import { CardPicker, Change, Empty, PageHeader, Stat, Thumb } from "../components/ui";
import { accuracy } from "../lib/forecast";
import { buylistValue, usd } from "../lib/deckstats";
import { change, collectionValue, trackedIds } from "../lib/prices";
import { useProfile } from "../lib/store";
import { historyKey, priceFor, type Finish } from "../lib/types";

export default function Dashboard() {
  const p = useProfile();
  const nav = useNavigate();

  const value = collectionValue(p);
  const cost = p.collection.reduce((a, c) => a + (c.purchasePrice ?? 0) * c.quantity, 0);
  const costed = p.collection.filter((c) => c.purchasePrice != null);
  const costedValue = costed.reduce((a, c) => a + (priceFor(p.cardCache[c.cardId], c.finish) ?? 0) * c.quantity, 0);
  const totalCards = p.collection.reduce((a, c) => a + c.quantity, 0);
  const cashValue = p.collection.reduce((a, c) => a + buylistValue(priceFor(p.cardCache[c.cardId], c.finish) ?? 0, p.settings.buylistCashPct, c.condition, p.settings) * c.quantity, 0);
  const acc = accuracy(p.forecastLog);

  const movers = useMemo(() => {
    const seen = new Set<string>();
    const rows: { id: string; name: string; finish: Finish; price: number; d7?: number; d30?: number }[] = [];
    for (const id of trackedIds(p)) {
      const card = p.cardCache[id];
      if (!card) continue;
      for (const f of ["nonfoil", "foil", "etched"] as Finish[]) {
        const s = p.priceHistory[historyKey(id, f)];
        if (!s || s.length < 2 || seen.has(id + f)) continue;
        seen.add(id + f);
        rows.push({ id, name: card.name + (f !== "nonfoil" ? ` (${f})` : ""), finish: f, price: s[s.length - 1][1], d7: change(s, 7), d30: change(s, 30) });
      }
    }
    const withMove = rows.filter((r) => r.d7 != null);
    return {
      gainers: [...withMove].sort((a, b) => b.d7! - a.d7!).filter((r) => r.d7! > 0).slice(0, 8),
      losers: [...withMove].sort((a, b) => a.d7! - b.d7!).filter((r) => r.d7! < 0).slice(0, 8),
    };
  }, [p]);

  const top = useMemo(
    () =>
      [...p.collection]
        .map((c) => ({ c, v: (priceFor(p.cardCache[c.cardId], c.finish) ?? 0) * c.quantity }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 8),
    [p],
  );

  return (
    <>
      <PageHeader title="Dashboard" sub={p.lastPriceRefresh ? `Prices updated ${new Date(p.lastPriceRefresh).toLocaleString()} · updates automatically once a day` : "Prices not refreshed yet"} />

      <div className="card row gap">
        <CardPicker onPick={(c) => nav(`/card/${c.id}`)} placeholder="Look up any card's price, history and forecast…" />
        <Link className="btn" to="/scan">Scan</Link>
        <Link className="btn" to="/batch">Batch entry</Link>
      </div>

      <div className="stats">
        <Stat label="Collection value" value={usd(value)} sub={`${totalCards} cards · ${p.collection.length} entries`} />
        <Stat label="Gain / loss" value={costed.length ? <span className={costedValue - cost >= 0 ? "up" : "down"}>{usd(costedValue - cost)}</span> : "—"} sub={costed.length ? `on ${costed.length} entries with a purchase price` : "Add purchase prices to track"} />
        <Stat label={`Store cash (${p.settings.buylistCashPct}%)`} value={usd(cashValue)} sub="Condition-adjusted estimate" />
        <Stat label="Forecast accuracy" value={acc ? `${Math.round(acc.directionHitRate * 100)}%` : "—"} sub={acc ? `direction right on ${acc.count} 7-day calls · avg error ${acc.meanAbsErrorPct}%` : "Builds up after a week of refreshes"} />
      </div>

      <div className="card">
        <h2>Portfolio value</h2>
        <LineChart series={p.portfolioHistory} label="Collection value" />
      </div>

      <div className="grid2">
        <MoverTable title="Top gainers (7 days)" rows={movers.gainers} />
        <MoverTable title="Top losers (7 days)" rows={movers.losers} />
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Most valuable cards</h2>
          {top.length ? (
            <table>
              <tbody>
                {top.map(({ c, v }) => (
                  <tr key={c.id}>
                    <td style={{ width: 40 }}><Thumb card={p.cardCache[c.cardId]} size={32} /></td>
                    <td>
                      <Link to={`/card/${c.cardId}`}>{c.name}</Link>
                      <div className="muted small">{c.set.toUpperCase()} #{c.collectorNumber} · {c.finish} · ×{c.quantity}</div>
                    </td>
                    <td className="num">{usd(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Your collection is empty. Use <Link to="/batch">Batch Entry</Link> or <Link to="/scan">Scan</Link> to add cards.</Empty>
          )}
        </div>
        <div className="card">
          <h2>Recent alerts</h2>
          {p.alerts.length ? (
            <ul className="stack" style={{ paddingLeft: "1rem", margin: 0 }}>
              {p.alerts.slice(0, 8).map((a) => (
                <li key={a.id} className={a.read ? "muted" : ""}>
                  <Link to={`/card/${a.cardId}`}>{a.message}</Link> <span className="muted small">{new Date(a.createdAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No alerts. Add cards to your <Link to="/watch">Watchlist</Link> with price targets.</Empty>
          )}
          <p className="muted small">Tracking {trackedIds(p).length} unique printings across your collection, decks, watchlist and trades.</p>
        </div>
      </div>
    </>
  );
}

function MoverTable({ title, rows }: { title: string; rows: { id: string; name: string; price: number; d7?: number; d30?: number }[] }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {rows.length ? (
        <table>
          <thead>
            <tr><th>Card</th><th className="num">Price</th><th className="num">7d</th><th className="num">30d</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id + r.name}>
                <td><Link to={`/card/${r.id}`}>{r.name}</Link></td>
                <td className="num">{usd(r.price)}</td>
                <td className="num"><Change v={r.d7} /></td>
                <td className="num"><Change v={r.d30} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>Movers show up once you have at least two days of price snapshots for your tracked cards.</Empty>
      )}
    </div>
  );
}
