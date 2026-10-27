# EquipWorthy Tracking

An all-purpose Magic: The Gathering app for tracking card prices, forecasting price moves, and managing your collection and decks. It comes as a **web app** and a **native iOS app (Swift / SwiftUI)**, and both store everything locally on your device.

| | |
|---|---|
| **Prices** | TCGplayer market prices in USD (via Scryfall), daily history, movers, watchlist alerts, portfolio value |
| **Forecasts** | 7- and 30-day direction and size estimates with an 80% range, a confidence level and a "why" breakdown, plus a running accuracy score |
| **Collection** | Printings, finishes, condition, language, binders, location, purchase price, set completion, wishlist, exports |
| **Batch entry** | Paste lists, set-grid collector numbers, CSV import from Moxfield/ManaBox/Deckbox/etc., and a review queue that survives reloads |
| **Scanning** | iOS: live camera with card-edge detection and Vision text recognition. Web: camera or photo with Tesseract.js |
| **Decks** | Builder, Moxfield import, legality, mana curve, owned vs. needed, shopping list, sample hands, draw odds |
| **Trade Scale** | Put cards on each side and watch the scale tip, with suggestions from your trade binder to balance it |
| **Store buylist** | Cash and store-credit sliders (% of market), adjusted for condition, shown across the app |
| **Hub** | TCGplayer, EDHREC, Scryfall and Moxfield links and data on every card, plus a sets and spoilers browser |

Full feature list: [docs/FEATURES.md](docs/FEATURES.md). How forecasts work: [docs/FORECASTING.md](docs/FORECASTING.md). Shared data format: [docs/DATA_MODEL.md](docs/DATA_MODEL.md).

## Repository layout

```
web/                 React + TypeScript + Vite web app
  src/lib/           core logic (parsers, forecasting, storage, API clients) + tests
  src/pages/         screens
ios/
  project.yml        XcodeGen spec for the app
  EquipWorthy/       SwiftUI app (views, scanner, local storage, background refresh)
  EquipWorthyKit/    Swift package: models, parsers, forecasting, Scryfall/EDHREC/Moxfield clients + tests
docs/                feature, forecasting and data-model docs
```

## Web app

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # static site in web/dist (host anywhere: GitHub Pages, Netlify, …)
```

Data lives in the browser's IndexedDB. The app saves 1.5 s after every change, on a timer (20 s by default), and when the tab is hidden or closed. Every page also has a **Save** button, and Ctrl/Cmd+S saves too.

## iOS app

Requires Xcode 16+ and iOS 17+.

```bash
brew install xcodegen
cd ios
xcodegen            # creates EquipWorthy.xcodeproj
open EquipWorthy.xcodeproj
```

Run the core tests with `cd ios/EquipWorthyKit && swift test`.

Profiles are JSON files in the app's Application Support folder. Autosave works the same way as on the web, plus a save whenever the app is backgrounded, and every screen has a Save button in its toolbar. A background refresh updates prices about every 6 hours and posts local notifications for watchlist alerts.

**Moving data between devices:** Settings → Export backup creates a `.json` file. Import it with Settings → Import on the other device, on either platform. The format is identical.

## Data sources

- **Scryfall**: card data, images, and daily TCGplayer market prices (USD). Requests are rate-limited to about 9 per second as Scryfall asks.
- **EDHREC**: Commander popularity, top commanders and synergy cards. EDHREC has no official API, so the app uses its public JSON pages, and some browsers may block them (the app falls back to a link).
- **Moxfield**: deck import by URL, and collection CSV import and export. Moxfield has no public API. URL import usually works on iOS, but browsers often block it, so the app asks you to paste the exported text instead.

Scryfall only publishes today's price, so price history is built on your device from daily snapshots of the cards you track: collection, decks, watchlist, wishlist and trades. History, movers and forecasts get better the longer the app runs.

*Not affiliated with Wizards of the Coast, Scryfall, TCGplayer, EDHREC or Moxfield. Forecasts are statistical estimates, not financial advice.*
