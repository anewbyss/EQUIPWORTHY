import { useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { useStore } from "./lib/store";
import Dashboard from "./pages/Dashboard";
import LaunchPage, { SCREENS } from "./pages/Launch";
import SearchPage from "./pages/Search";
import CardPage from "./pages/CardPage";
import CollectionPage from "./pages/Collection";
import BatchPage from "./pages/Batch";
import ScanPage from "./pages/Scan";
import DecksPage from "./pages/Decks";
import DeckPage from "./pages/DeckPage";
import WatchPage from "./pages/Watchlist";
import TradePage from "./pages/Trade";
import MarketPage from "./pages/Market";
import SecretLairPage, { LaunchStrip } from "./pages/SecretLair";
import LifeTrackerPage from "./pages/LifeTracker";
import SetsPage from "./pages/Sets";
import SettingsPage from "./pages/Settings";

const NAV: [string, string][] = [["/", "Home"], ...SCREENS.map((x): [string, string] => [x.to, x.title])];

export default function App() {
  const s = useStore();
  const [menu, setMenu] = useState(false);
  const unread = s.profile?.alerts.filter((a) => !a.read).length ?? 0;

  return (
    <div className="app">
      <nav className={`sidebar ${menu ? "open" : ""}`}>
        <div className="brand">
          <Link to="/" className="brand-link" onClick={() => setMenu(false)} aria-label="EquipWorthy home">
            <img src="./favicon.svg" alt="" width={28} height={28} />
            <span>
              EquipWorthy<small>Tracking</small>
            </span>
          </Link>
          <button className="menu-btn" onClick={() => setMenu(!menu)} aria-label="Menu">☰</button>
        </div>
        <div className="nav-links" onClick={() => setMenu(false)}>
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              {label}
              {to === "/watch" && unread > 0 && <span className="badge">{unread}</span>}
            </NavLink>
          ))}
        </div>
        <div className="profile-chip muted small">Profile: {s.profile?.name}</div>
      </nav>
      <main className="content">
        <LaunchStrip />
        <Routes>
          <Route path="/" element={<LaunchPage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="*" element={<LaunchPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/card/:id" element={<CardPage />} />
          <Route path="/collection" element={<CollectionPage />} />
          <Route path="/batch" element={<BatchPage />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/deck/:id" element={<DeckPage />} />
          <Route path="/watch" element={<WatchPage />} />
          <Route path="/trade" element={<TradePage />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/secret-lair" element={<SecretLairPage />} />
          <Route path="/life" element={<LifeTrackerPage />} />
          <Route path="/sets" element={<SetsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        <footer className="muted small foot">
          Card data and prices from Scryfall (TCGplayer market, USD). Commander data from EDHREC. Not affiliated with Wizards of the Coast. Forecasts are estimates, not financial advice.
        </footer>
      </main>
    </div>
  );
}
