import { Link } from "react-router-dom";
import { CardPicker, Change, Empty, PageHeader } from "../components/ui";
import { forecast } from "../lib/forecast";
import { pct, usd } from "../lib/deckstats";
import { change } from "../lib/prices";
import { update, useProfile } from "../lib/store";
import { historyKey, priceFor, uid, type WatchItem } from "../lib/types";

export default function WatchPage() {
  const p = useProfile();
  const edit = (id: string, patch: Partial<WatchItem>) => update((cur) => ({ ...cur, watchlist: cur.watchlist.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  const numOrUndef = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const unread = p.alerts.filter((a) => !a.read).length;

  return (
    <>
      <PageHeader title="Watchlist" sub="Set price targets and get alerted when prices are refreshed.">
        {"Notification" in window && Notification.permission !== "granted" && (
          <button className="btn" onClick={() => void Notification.requestPermission()}>Enable browser notifications</button>
        )}
      </PageHeader>
      <div className="card row gap">
        <CardPicker
          onPick={(c) => update((cur) => ({ ...cur, watchlist: [...cur.watchlist, { id: uid(), cardId: c.id, name: c.name, finish: c.finishes.includes("nonfoil") ? "nonfoil" : c.finishes[0], addedAt: new Date().toISOString() }] }))}
          placeholder="Watch a card…"
        />
      </div>
      {p.watchlist.length ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>Card</th><th>Finish</th><th className="num">Price</th><th className="num">7d</th><th className="num">30d</th><th className="num">30d forecast</th><th>Alert below $</th><th>Alert above $</th><th>Alert on ±% / week</th><th /></tr>
            </thead>
            <tbody>
              {p.watchlist.map((w) => {
                const card = p.cardCache[w.cardId];
                const s = p.priceHistory[historyKey(w.cardId, w.finish)];
                const price = priceFor(card, w.finish);
                const f = card ? forecast(card, s ?? [], price, 30) : null;
                return (
                  <tr key={w.id}>
                    <td><Link to={`/card/${w.cardId}`}>{w.name}</Link> <span className="muted small">{card?.set.toUpperCase()}</span></td>
                    <td>{w.finish}</td>
                    <td className="num">{usd(price)}</td>
                    <td className="num"><Change v={change(s, 7)} /></td>
                    <td className="num"><Change v={change(s, 30)} /></td>
                    <td className={`num ${f?.direction === "up" ? "up" : f?.direction === "down" ? "down" : ""}`}>{f ? pct(f.expectedPct) : "—"}</td>
                    <td><input value={w.below ?? ""} style={{ width: "5rem" }} onChange={(e) => edit(w.id, { below: numOrUndef(e.target.value) })} aria-label="Alert below" /></td>
                    <td><input value={w.above ?? ""} style={{ width: "5rem" }} onChange={(e) => edit(w.id, { above: numOrUndef(e.target.value) })} aria-label="Alert above" /></td>
                    <td><input value={w.pctMove ?? ""} style={{ width: "4rem" }} onChange={(e) => edit(w.id, { pctMove: numOrUndef(e.target.value) })} aria-label="Alert percent move" /></td>
                    <td><button className="btn small" onClick={() => update((cur) => ({ ...cur, watchlist: cur.watchlist.filter((x) => x.id !== w.id) }))} aria-label="Remove">×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Nothing on your watchlist yet.</Empty>
      )}

      <div className="card">
        <div className="row between">
          <h2>Alerts {unread > 0 && <span className="badge">{unread}</span>}</h2>
          <div className="row gap">
            <button className="btn small" onClick={() => update((cur) => ({ ...cur, alerts: cur.alerts.map((a) => ({ ...a, read: true })) }))}>Mark all read</button>
            <button className="btn small" onClick={() => update((cur) => ({ ...cur, alerts: [] }))}>Clear</button>
          </div>
        </div>
        {p.alerts.length ? (
          <table>
            <tbody>
              {p.alerts.map((a) => (
                <tr key={a.id} className={a.read ? "muted" : ""}>
                  <td>{!a.read && "● "}<Link to={`/card/${a.cardId}`}>{a.message}</Link></td>
                  <td className="small muted">{new Date(a.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted small">Alerts are checked every time prices refresh (automatically every {p.settings.autoRefreshHours}h when the app is open, or with Refresh prices).</p>
        )}
      </div>
    </>
  );
}
