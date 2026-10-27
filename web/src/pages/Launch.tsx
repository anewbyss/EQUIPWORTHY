import { Link, useNavigate } from "react-router-dom";
import { CardPicker, SaveButton } from "../components/ui";
import { usd } from "../lib/deckstats";
import { collectionValue } from "../lib/prices";
import { useProfile } from "../lib/store";
import type { Profile } from "../lib/types";

type Accent = "sky" | "violet" | "gold";

export interface Screen {
  to: string;
  title: string;
  blurb: string;
  icon: string; // SVG path data, 24×24 stroke icon
  accent: Accent;
  stat?: (p: Profile) => string | null;
}

/** Every screen in the app. The launcher and the sidebar both read this list. */
export const SCREENS: Screen[] = [
  {
    to: "/dashboard", title: "Dashboard", blurb: "Portfolio value, movers and alerts", accent: "sky",
    icon: "M3 3v18h18M7 15l4-4 3 3 5-6",
    stat: (p) => (p.collection.length ? usd(collectionValue(p)) : null),
  },
  { to: "/search", title: "Search", blurb: "Any card's price, history and forecast", accent: "violet", icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5" },
  {
    to: "/collection", title: "Collection", blurb: "Binders, conditions, set completion, exports", accent: "gold",
    icon: "M4 7l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4",
    stat: (p) => (p.collection.length ? `${p.collection.reduce((a, c) => a + c.quantity, 0).toLocaleString()} cards` : null),
  },
  {
    to: "/batch", title: "Batch Entry", blurb: "Paste lists, set grids and CSV imports", accent: "sky",
    icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    stat: (p) => (p.pendingBatch?.length ? `${p.pendingBatch.length} to review` : null),
  },
  { to: "/scan", title: "Scan", blurb: "Identify cards with your camera", accent: "violet", icon: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M9 9h6v6H9z" },
  {
    to: "/decks", title: "Decks", blurb: "Build, check legality, see what to buy", accent: "gold",
    icon: "M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM3 6v13M21 6v13",
    stat: (p) => (p.decks.length ? `${p.decks.length} deck${p.decks.length === 1 ? "" : "s"}` : null),
  },
  {
    to: "/watch", title: "Watchlist", blurb: "Price targets and alerts", accent: "sky",
    icon: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4",
    stat: (p) => {
      const n = p.alerts.filter((a) => !a.read).length;
      return n ? `${n} new alert${n === 1 ? "" : "s"}` : p.watchlist.length ? `${p.watchlist.length} watched` : null;
    },
  },
  { to: "/trade", title: "Trade Scale", blurb: "Balance a trade, store trade-in values", accent: "violet", icon: "M12 3v18M5 7h14M5 7l-3 7h6zM19 7l-3 7h6zM8 21h8" },
  {
    to: "/life", title: "Life & Dice", blurb: "Life, commander damage, counters, dice", accent: "gold",
    icon: "M12 21s-8-5.5-8-11a5 5 0 0 1 8-4 5 5 0 0 1 8 4c0 5.5-8 11-8 11z",
    stat: (p) => (p.game ? `Game in progress · turn ${p.game.turn}` : null),
  },
  { to: "/sets", title: "Sets & Spoilers", blurb: "Upcoming sets and every release", accent: "sky", icon: "M12 2l2.9 6.9L22 10l-5.5 4.8L18 22l-6-3.6L6 22l1.5-7.2L2 10l7.1-1.1z" },
  { to: "/settings", title: "Settings", blurb: "Profiles, sync, backups, buylist %", accent: "violet", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" },
];

export function Icon({ d, size = 26 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function LaunchPage() {
  const p = useProfile();
  const nav = useNavigate();
  return (
    <>
      <section className="launch-hero">
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="launch-kicker">EquipWorthy Tracking</div>
            <h1 className="launch-title">{greeting()}{p.name && p.name !== "My Collection" ? `, ${p.name}` : ""}</h1>
            <p className="launch-sub">Where do you want to go?</p>
          </div>
          <SaveButton />
        </div>
        <div className="launch-search">
          <CardPicker onPick={(c) => nav(`/card/${c.id}`)} placeholder="Quick lookup: type any card name…" />
        </div>
      </section>

      <nav className="launch-grid" aria-label="Screens">
        {SCREENS.map((s) => {
          const stat = s.stat?.(p);
          return (
            <Link key={s.to} to={s.to} className={`launch-tile accent-${s.accent}`}>
              <span className="launch-icon"><Icon d={s.icon} /></span>
              <span className="launch-name">{s.title}</span>
              <span className="launch-blurb">{s.blurb}</span>
              {stat && <span className="launch-stat">{stat}</span>}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
