import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import * as scry from "../lib/scryfall";
import { cacheCards, save, useStore } from "../lib/store";
import { syncNow, useSyncStatus } from "../lib/syncManager";
import type { CardSummary } from "../lib/types";

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(iso).toLocaleString();
}

/** Manual save control shown on every page, with autosave status. */
export function SaveButton() {
  const s = useStore();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const status = s.saving ? "Saving…" : s.dirty ? "Unsaved changes" : `Saved ${ago(s.lastSaved)}`;
  return (
    <div className="save">
      <span className={`save-status ${s.dirty ? "dirty" : ""}`} title="Autosaves after every change and on a timer. Ctrl/Cmd+S also saves.">
        {s.error ?? status}
      </span>
      <button className="btn small" onClick={() => void save()} disabled={s.saving}>
        Save
      </button>
      <SyncButton />
    </div>
  );
}

/** Sync status + manual sync, shown next to Save once sync is set up. */
export function SyncButton() {
  const st = useSyncStatus();
  if (!st.configured) return null;
  const label = st.syncing ? "Syncing…" : st.error ? "Sync failed" : st.lastSync ? `Synced ${ago(st.lastSync)}` : "Not synced yet";
  return (
    <button className={`btn small sync-btn ${st.error ? "danger" : ""}`} onClick={() => void syncNow()} disabled={st.syncing} title={st.error ?? "Sync with your other devices now"}>
      ⇅ {label}
    </button>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      <div className="row gap">
        {children}
        <SaveButton />
      </div>
    </header>
  );
}

/** Card name search with Scryfall autocomplete. Calls onPick with a full card. */
export function CardPicker({ onPick, placeholder = "Search a card…", autoFocus }: { onPick: (c: CardSummary) => void; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setOpts([]);
      return;
    }
    timer.current = setTimeout(() => {
      scry.autocomplete(q).then((o) => {
        setOpts(o.slice(0, 10));
        setHi(0);
      }, () => setOpts([]));
    }, 200);
  }, [q]);

  const pick = async (name: string) => {
    setBusy(true);
    setErr(null);
    try {
      const c = await scry.named(name, true);
      cacheCards([c]);
      onPick(c);
      setQ("");
      setOpts([]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="picker">
      <input
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHi((h) => Math.min(opts.length - 1, h + 1));
          else if (e.key === "ArrowUp") setHi((h) => Math.max(0, h - 1));
          else if (e.key === "Enter" && q.trim()) void pick(opts[hi] ?? q);
          else if (e.key === "Escape") setOpts([]);
        }}
        aria-label={placeholder}
      />
      {busy && <span className="picker-busy">…</span>}
      {opts.length > 0 && (
        <ul className="picker-list" role="listbox">
          {opts.map((o, i) => (
            <li key={o} className={i === hi ? "hi" : ""} onMouseDown={() => void pick(o)} role="option" aria-selected={i === hi}>
              {o}
            </li>
          ))}
        </ul>
      )}
      {err && <div className="error small">{err}</div>}
    </div>
  );
}

export function CardLink({ id, name }: { id: string; name: string }) {
  return <Link to={`/card/${id}`}>{name}</Link>;
}

export function Thumb({ card, size = 48 }: { card?: CardSummary; size?: number }) {
  if (!card?.imageSmall) return <div className="thumb empty" style={{ width: size, height: size * 1.4 }} />;
  return <img className="thumb" src={card.imageSmall} alt={card.name} width={size} height={Math.round(size * 1.4)} loading="lazy" />;
}

export function Change({ v }: { v: number | undefined }) {
  if (v == null) return <span className="muted">—</span>;
  const cls = v > 0.05 ? "up" : v < -0.05 ? "down" : "muted";
  return (
    <span className={cls}>
      {v > 0 ? "▲" : v < 0 ? "▼" : ""} {Math.abs(v).toFixed(1)}%
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** Market-% slider used for store buylist estimates. */
export function PctSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>
        {label}: <b>{value}%</b> of market
      </span>
      <input type="range" min={0} max={100} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
