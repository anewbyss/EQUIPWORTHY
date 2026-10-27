import { useState } from "react";
import { PageHeader, PctSlider } from "../components/ui";
import { createProfile, deleteProfile, download, exportProfile, importProfile, save, switchProfile, update, useStore } from "../lib/store";
import { CONDITIONS, type Condition, type Settings } from "../lib/types";

export default function SettingsPage() {
  const s = useStore();
  const p = s.profile!;
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const setS = (patch: Partial<Settings>) => update((cur) => ({ ...cur, settings: { ...cur.settings, ...patch } }));

  const sizeKb = Math.round(new Blob([JSON.stringify(p)]).size / 1024);

  return (
    <>
      <PageHeader title="Settings" sub="Everything is stored locally on this device. Nothing is uploaded." />
      {msg && <p className="up">{msg}</p>}
      <div className="grid2">
        <div className="card stack">
          <h2>Profiles</h2>
          <p className="muted small">Each profile has its own collection, decks, watchlist, trades and price history, stored on this device.</p>
          <table>
            <tbody>
              {s.profiles.map((m) => (
                <tr key={m.id}>
                  <td>{m.id === p.id ? <b>{m.name} (active)</b> : m.name}</td>
                  <td className="muted small">{m.cards} cards</td>
                  <td className="right">
                    {m.id !== p.id && <button className="btn small" onClick={() => void switchProfile(m.id)}>Switch</button>}{" "}
                    <button className="btn small danger" onClick={() => confirm(`Delete profile "${m.name}" and all its data? Export a backup first if unsure.`) && void deleteProfile(m.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row gap">
            <label className="small">Rename active <input value={p.name} onChange={(e) => update((cur) => ({ ...cur, name: e.target.value }))} /></label>
          </div>
          <div className="row gap">
            <input placeholder="New profile name" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New profile name" />
            <button className="btn" disabled={!newName.trim()} onClick={() => (void createProfile(newName.trim()), setNewName(""))}>Create</button>
          </div>
        </div>

        <div className="card stack">
          <h2>Saving & backups</h2>
          <p className="muted small">
            EquipWorthy saves 1.5 seconds after every change, every {p.settings.autosaveSeconds} seconds while there are unsaved changes, and whenever you leave or hide the tab. Use the Save button on any page (or Ctrl/Cmd+S) to save right away.
          </p>
          <label className="small">
            Autosave interval{" "}
            <select value={p.settings.autosaveSeconds} onChange={(e) => setS({ autosaveSeconds: Number(e.target.value) })}>
              {[10, 20, 30, 60, 120].map((v) => <option key={v} value={v}>{v} seconds</option>)}
            </select>
          </label>
          <div className="row gap">
            <button className="btn primary" onClick={() => void save().then((ok) => setMsg(ok ? "Saved." : "Save failed."))}>Save now</button>
            <button className="btn" onClick={() => download(`equipworthy-${p.name.replace(/\W+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`, exportProfile(p), "application/json")}>Export backup (.json)</button>
          </div>
          <label className="small">
            Restore / import backup (also works with backups exported from the iOS app):{" "}
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const imp = await importProfile(await f.text());
                  setMsg(`Imported "${imp.name}".`);
                } catch (err) {
                  setMsg(`Import failed: ${(err as Error).message}`);
                }
              }}
            />
          </label>
          <p className="muted small">Profile size: {sizeKb.toLocaleString()} KB · {Object.keys(p.cardCache).length} cards cached for offline use · {Object.keys(p.priceHistory).length} price histories.</p>
        </div>

        <div className="card stack">
          <h2>Store buylist defaults</h2>
          <PctSlider label="Cash offer" value={p.settings.buylistCashPct} onChange={(v) => setS({ buylistCashPct: v })} />
          <PctSlider label="Store credit" value={p.settings.buylistCreditPct} onChange={(v) => setS({ buylistCreditPct: v })} />
          <h3>Condition multipliers</h3>
          <p className="muted small">How much of the NM price a card in each condition is worth.</p>
          <div className="row gap">
            {CONDITIONS.map((c: Condition) => (
              <label key={c} className="small">
                {c}{" "}
                <input type="number" min={0} max={1} step={0.05} value={p.settings.conditionMultipliers[c]} onChange={(e) => setS({ conditionMultipliers: { ...p.settings.conditionMultipliers, [c]: Number(e.target.value) } })} style={{ width: "4.5rem" }} />
              </label>
            ))}
          </div>
        </div>

        <div className="card stack">
          <h2>Defaults & prices</h2>
          <label className="small">
            Default condition for new cards{" "}
            <select value={p.settings.defaultCondition} onChange={(e) => setS({ defaultCondition: e.target.value as Condition })}>
              {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="small">
            Default binder{" "}
            <select value={p.settings.defaultBinder} onChange={(e) => setS({ defaultBinder: e.target.value })}>
              {p.binders.map((b) => <option key={b}>{b}</option>)}
            </select>
          </label>
          <label className="small">
            Auto-refresh prices every{" "}
            <select value={p.settings.autoRefreshHours} onChange={(e) => setS({ autoRefreshHours: Number(e.target.value) })}>
              {[6, 12, 24, 48].map((h) => <option key={h} value={h}>{h} hours</option>)}
            </select>
          </label>
          <label className="small row gap"><input type="checkbox" checked={p.settings.notifications} onChange={(e) => setS({ notifications: e.target.checked })} /> Price-alert notifications</label>
          <p className="muted small">Prices come from Scryfall, which publishes TCGplayer market prices in USD once a day. EquipWorthy keeps one snapshot per day per card on this device to build price history.</p>
        </div>
      </div>
    </>
  );
}
