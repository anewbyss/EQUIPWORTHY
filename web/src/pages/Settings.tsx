import { useEffect, useState } from "react";
import { PageHeader, PctSlider } from "../components/ui";
import { createProfile, deleteProfile, download, exportProfile, importProfile, save, switchProfile, update, useStore } from "../lib/store";
import { CONDITIONS, type Condition, type Settings } from "../lib/types";
import { connect, disconnect, downloadProfile, loadConfig, remoteProfiles, setAutoSync, syncNow, useSyncStatus } from "../lib/syncManager";
import type { Envelope } from "../lib/sync";

export default function SettingsPage() {
  const s = useStore();
  const p = s.profile!;
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const setS = (patch: Partial<Settings>) => update((cur) => ({ ...cur, settings: { ...cur.settings, ...patch } }));

  const sizeKb = Math.round(new Blob([JSON.stringify(p)]).size / 1024);

  return (
    <>
      <PageHeader title="Settings" sub="Everything is stored on this device. Sync is optional and end-to-end encrypted." />
      {msg && <p className="up">{msg}</p>}
      <SyncSettings />
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

const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=gist&description=EquipWorthy%20sync";

function SyncSettings() {
  const st = useSyncStatus();
  const s = useStore();
  const [token, setToken] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [remote, setRemote] = useState<Envelope[] | null>(null);

  useEffect(() => {
    if (st.configured) remoteProfiles().then(setRemote, () => setRemote(null));
  }, [st.configured, st.lastSync]);

  const onConnect = async () => {
    setErr(null);
    if (pass.length < 8) return setErr("Use a passphrase of at least 8 characters.");
    if (pass !== pass2) return setErr("The passphrases don't match.");
    setBusy(true);
    try {
      setRemote(await connect(token, pass));
      setToken(""); setPass(""); setPass2("");
      await syncNow();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const missing = (remote ?? []).filter((r) => !s.profiles.some((m) => m.id === r.profileId));

  return (
    <div className="card stack">
      <h2>Sync between devices</h2>
      {!st.configured ? (
        <>
          <p className="muted small">
            Keep this browser, the iPhone/iPad app and your other devices in sync. Your profiles are encrypted with a passphrase on this device and stored in a private Gist on your own GitHub account. Nobody without the passphrase can read them, not even GitHub. Edits made on different devices are merged.
          </p>
          <ol className="small">
            <li><a href={TOKEN_URL} target="_blank" rel="noreferrer">Create a GitHub token</a> with only the <b>gist</b> permission (choose "No expiration" or set a reminder to renew it).</li>
            <li>Paste it below and choose a sync passphrase. Use the <b>same token and passphrase on every device</b>.</li>
          </ol>
          <div className="row gap">
            <input type="password" placeholder="GitHub token (ghp_…)" value={token} onChange={(e) => setToken(e.target.value)} style={{ flex: 1, minWidth: 220 }} aria-label="GitHub token" autoComplete="off" />
          </div>
          <div className="row gap">
            <input type="password" placeholder="Sync passphrase" value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Sync passphrase" autoComplete="new-password" />
            <input type="password" placeholder="Repeat passphrase" value={pass2} onChange={(e) => setPass2(e.target.value)} aria-label="Repeat passphrase" autoComplete="new-password" />
            <button className="btn primary" disabled={busy || !token || !pass} onClick={() => void onConnect()}>{busy ? "Connecting…" : "Turn on sync"}</button>
          </div>
          <p className="muted small">If you forget the passphrase, synced data can't be recovered, but each device keeps its own local copy.</p>
        </>
      ) : (
        <>
          <div className="row gap">
            <span className={st.error ? "error" : "up"}>{st.error ? `⚠ ${st.error}` : st.syncing ? "Syncing…" : st.lastSync ? `✓ Synced ${new Date(st.lastSync).toLocaleString()}` : "Connected"}</span>
            <button className="btn primary small" onClick={() => void syncNow()} disabled={st.syncing}>Sync now</button>
            <label className="row gap small"><input type="checkbox" checked={st.autoSync} onChange={(e) => setAutoSync(e.target.checked)} /> Sync automatically</label>
            <button className="btn small danger" onClick={() => confirm("Turn off sync on this device? Your local data stays here.") && disconnect()}>Turn off</button>
          </div>
          <p className="muted small">
            Syncs when the app opens, a few seconds after changes are saved, when you come back to the tab, and every 5 minutes. Card images and prices are downloaded again on each device rather than synced.
            {loadConfig()?.gistId && <> Gist: <code>{loadConfig()!.gistId!.slice(0, 8)}…</code></>}
          </p>
          {missing.length > 0 && (
            <div>
              <h3>Profiles on your other devices</h3>
              <table>
                <tbody>
                  {missing.map((r) => (
                    <tr key={r.profileId}>
                      <td>{r.name}</td>
                      <td className="muted small">updated {new Date(r.updatedAt).toLocaleString()}</td>
                      <td className="right"><button className="btn small" onClick={() => downloadProfile(r).catch((e) => setErr((e as Error).message))}>Download</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {err && <p className="error small">{err}</p>}
    </div>
  );
}
