import { useState } from "react";
import { Link } from "react-router-dom";
import { Change, Empty, PageHeader, Thumb } from "../components/ui";
import { usd } from "../lib/deckstats";
import { refreshAll, useRefreshStatus } from "../lib/refresh";
import { update, useProfile } from "../lib/store";
import { uid, type Mover } from "../lib/types";

type Tab = "movers" | "synergy";

export default function MarketPage() {
  const p = useProfile();
  const st = useRefreshStatus();
  const [tab, setTab] = useState<Tab>("movers");
  const m = p.market;
  const movers = m?.movers ?? [];
  const yours = movers.filter((x) => x.tracked);
  const market = movers.filter((x) => !x.tracked);
  const watched = new Set(p.watchlist.map((w) => w.cardId));

  const watch = (cardId: string, name: string) =>
    update((cur) => (cur.watchlist.some((w) => w.cardId === cardId) ? cur : { ...cur, watchlist: [...cur.watchlist, { id: uid(), cardId, name, finish: "nonfoil", pctMove: cur.settings.spikePct7d, addedAt: new Date().toISOString() }] }));

  return (
    <>
      <PageHeader
        title="Market Watch"
        sub={m?.lastScan ? `Last market scan ${new Date(m.lastScan).toLocaleString()} · ${Object.keys(m.history).length} popular Commander cards tracked daily` : "Scans popular Commander cards once a day for fast movers and new-set synergies."}
      >
        <button className="btn primary" disabled={st.running} onClick={() => void refreshAll({ force: true })}>{st.running ? st.step ?? "Scanning…" : "Scan now"}</button>
      </PageHeader>
      {!p.settings.marketScan && <p className="small">Market scanning is off. Turn it on in <Link to="/settings">Settings</Link>.</p>}
      {st.error && <p className="error small">{st.error}</p>}

      <div className="tabs">
        <button className={tab === "movers" ? "on" : ""} onClick={() => setTab("movers")}>Fast movers ({movers.length})</button>
        <button className={tab === "synergy" ? "on" : ""} onClick={() => setTab("synergy")}>Synergy watch ({m?.synergy.length ?? 0})</button>
      </div>

      {tab === "movers" && (
        <>
          <p className="muted small">
            A card counts as moving fast when it changes {p.settings.spikePct1d}%+ in a day or {p.settings.spikePct7d}%+ in a week (cards under {usd(p.settings.moverMinPrice)} ignored). Change the thresholds in <Link to="/settings">Settings</Link>. Your own cards also raise alerts.
          </p>
          <MoverTable title="Your cards" rows={yours} empty="None of your cards are moving fast right now." watched={watched} onWatch={watch} cards={p} />
          <div className="grid2">
            <MoverTable title="Market spikes ▲" rows={market.filter((x) => x.kind === "spike")} empty={m ? "No spikes past your threshold." : "Run a scan to start building market history."} watched={watched} onWatch={watch} cards={p} />
            <MoverTable title="Market drops ▼" rows={market.filter((x) => x.kind === "crash")} empty={m ? "No sharp drops past your threshold." : "Market history builds up one day at a time."} watched={watched} onWatch={watch} cards={p} />
          </div>
          {m && Object.values(m.history).every((s) => s.length < 2) && (
            <p className="muted small">Market history starts today. Day-over-day moves appear after tomorrow's update, and weekly moves after a week.</p>
          )}
        </>
      )}

      {tab === "synergy" && (
        <>
          <div className="card">
            <h2>What this is</h2>
            <p className="small muted" style={{ margin: 0 }}>
              When new cards are revealed, older cards that play well with them (especially with a new commander) often jump in price. EquipWorthy reads the rules text of every new card in recent and upcoming sets, matches mechanics, themes and creature types against popular cards and your own, and ranks the ones most likely to benefit. It's a heads-up list, not a guarantee.
            </p>
            {m?.newSets.length ? (
              <p className="small" style={{ marginBottom: 0 }}>
                Sets analyzed: {m.newSets.map((s) => `${s.name} (${s.releasedAt ?? "TBA"})`).join(", ")}
              </p>
            ) : null}
          </div>
          {m?.synergy.length ? (
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr><th /><th>Card</th><th className="num">Score</th><th>Why</th><th className="num">Price</th><th /></tr>
                </thead>
                <tbody>
                  {m.synergy.map((s) => (
                    <tr key={s.cardId}>
                      <td><Thumb card={m.cards[s.cardId] ?? p.cardCache[s.cardId]} size={32} /></td>
                      <td>
                        <Link to={`/card/${s.cardId}`}>{s.name}</Link>
                        <div className="muted small">{s.set.toUpperCase()}{p.collection.some((c) => c.cardId === s.cardId) && <> · <span className="up">you own this</span></>}</div>
                      </td>
                      <td className="num"><span className="pill ok">{s.score.toFixed(1)}</span></td>
                      <td className="small">
                        {s.reasons.map((r) => <div key={r}>{r}</div>)}
                        <div className="muted">New cards: {s.sources.slice(0, 3).join(", ")}{s.sources.length > 3 ? "…" : ""}</div>
                      </td>
                      <td className="num">{usd(s.price)}</td>
                      <td>{watched.has(s.cardId) ? <span className="muted small">watching</span> : <button className="btn small" onClick={() => watch(s.cardId, s.name)}>Watch</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{m ? "No strong synergy picks from the current new sets." : "Run a scan to analyze new and upcoming sets."}</Empty>
          )}
        </>
      )}
    </>
  );
}

function MoverTable({ title, rows, empty, watched, onWatch, cards }: { title: string; rows: Mover[]; empty: string; watched: Set<string>; onWatch: (id: string, name: string) => void; cards: ReturnType<typeof useProfile> }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th /><th>Card</th><th className="num">Price</th><th className="num">1 day</th><th className="num">7 days</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.cardId + r.finish}>
                  <td><Thumb card={cards.cardCache[r.cardId] ?? cards.market?.cards[r.cardId]} size={28} /></td>
                  <td><Link to={`/card/${r.cardId}`}>{r.name}</Link> <span className="muted small">{r.set.toUpperCase()}</span></td>
                  <td className="num">{usd(r.price)}</td>
                  <td className="num"><Change v={r.d1} /></td>
                  <td className="num"><Change v={r.d7} /></td>
                  <td>{r.tracked || watched.has(r.cardId) ? null : <button className="btn small" onClick={() => onWatch(r.cardId, r.name)}>Watch</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{empty}</Empty>
      )}
    </div>
  );
}
