# EquipWorthy Tracking

An all-purpose Magic: The Gathering app for tracking card prices, forecasting price moves, and managing your collection and decks. It comes as a **web app** and a **native iOS app (Swift / SwiftUI)**, and both store everything locally on your device.

| | |
|---|---|
| **Prices** | TCGplayer market prices in USD (via Scryfall), daily history, movers, watchlist alerts, portfolio value |
| **Market Watch** | Daily automatic price updates plus a refresh button everywhere, alerts when cards spike or crash, a market-wide scan of popular Commander cards, and synergy picks for cards likely to rise because of new sets |
| **Forecasts** | 7- and 30-day direction and size estimates with an 80% range, a confidence level and a "why" breakdown, plus a running accuracy score |
| **Collection** | Printings, finishes, condition, language, binders, location, purchase price, set completion, wishlist, exports |
| **Batch entry** | Paste lists, set-grid collector numbers, CSV import from Moxfield/ManaBox/Deckbox/etc., and a review queue that survives reloads |
| **Scanning** | iOS: live camera with card-edge detection and Vision text recognition. Web: camera or photo with Tesseract.js |
| **Decks** | Builder, Moxfield import, legality, mana curve, owned vs. needed, shopping list, sample hands, draw odds |
| **Trade Scale** | Put cards on each side and watch the scale tip, with suggestions from your trade binder to balance it |
| **Life & Dice** | Life totals, commander damage, poison and other counters, turn tracking, game log, and dice (d4–d100), coin flips and random player picks |
| **Store buylist** | Cash and store-credit sliders (% of market), adjusted for condition, shown across the app |
| **Hub** | TCGplayer, EDHREC, Scryfall and Moxfield links and data on every card, plus a sets and spoilers browser |

Full feature list: [docs/FEATURES.md](docs/FEATURES.md). How forecasts work: [docs/FORECASTING.md](docs/FORECASTING.md). Shared data format: [docs/DATA_MODEL.md](docs/DATA_MODEL.md).

## Repository layout

```
web/                          React + TypeScript + Vite web app (installable on iPhone/iPad/Mac via Safari)
  src/lib/                    core logic (parsers, forecasting, storage, sync, API clients) + tests
  src/pages/                  screens
ios/
  EquipWorthy.swiftpm/        the iOS/iPadOS app: opens in Swift Playgrounds or Xcode
    Sources/App/              SwiftUI screens, scanner, storage, sync
    Sources/EquipWorthyKit/   shared core: models, parsers, forecasting, sync, Scryfall/EDHREC/Moxfield
  Package.swift, Tests/       run the core tests with `swift test`
docs/                         feature, forecasting, data-model and sync docs
```

## Web app (Safari, Chrome, anything)

**Use it in Safari:** the web app is a static site. Once this branch is merged to `main`, the included workflow publishes it to GitHub Pages. In the repo go to **Settings → Pages → Source: GitHub Actions** the first time. GitHub Pages on a **private** repo needs a paid GitHub plan; otherwise make the repo public or drag `web/dist` onto Netlify or Cloudflare Pages.

- **iPhone / iPad:** open the site in Safari, tap **Share → Add to Home Screen**. It then opens full-screen like an app, works offline, and Safari won't clear its storage.
- **Mac:** Safari → **File → Add to Dock**.
- The camera scanner needs the site served over HTTPS (GitHub Pages is).

Run it locally:

```bash
cd web
npm install
npm run dev        # http://localhost:5173  (add --host to open it from your phone on the same Wi-Fi)
npm test
npm run build      # static site in web/dist
```

## iOS / iPadOS app

**Swift Playgrounds (iPad or Mac):** copy the `ios/EquipWorthy.swiftpm` folder to your iPad or Mac, for example by downloading the repo as a ZIP and saving it to iCloud Drive, then open it in Swift Playgrounds 4.5 or later. Tap ▶ to run it. **App Settings → Install on device** puts it on your Home Screen.

**Xcode 16+ (Mac):** open `ios/EquipWorthy.swiftpm` directly in Xcode, pick your iPhone and press Run.

Run the core tests with `cd ios && swift test`.

Swift Playgrounds builds can't register background tasks, so in those builds prices and alerts refresh whenever you open the app instead of in the background.

## Saving and sync

Everything is stored on the device first. Each app saves 1.5 s after a change, on a timer, and when it closes, and every page or screen has a **Save** button.

**Sync between devices** (Settings → Sync between devices) keeps the web app, iPhone and iPad in step:

1. Create a GitHub token with only the **gist** permission ([link](https://github.com/settings/tokens/new?scopes=gist&description=EquipWorthy%20sync)).
2. Enter the token and a sync passphrase on each device (the same ones everywhere).

Profiles are **encrypted on the device** (PBKDF2-SHA256 + AES-256-GCM) and stored in a private Gist on your GitHub account, so GitHub can't read them. Sync runs on open, a few seconds after changes, every 5 minutes and on demand (the ⇅ button beside Save). If two devices edit at the same time, changes are **merged** rather than overwritten. Details: [docs/SYNC.md](docs/SYNC.md).

Manual backups still work too: Settings → Export backup creates a `.json` file that imports on either platform.

## Data sources

- **Scryfall**: card data, images, and daily TCGplayer market prices (USD). Requests are rate-limited to about 9 per second as Scryfall asks.
- **EDHREC**: Commander popularity, top commanders and synergy cards. EDHREC has no official API, so the app uses its public JSON pages, and some browsers may block them (the app falls back to a link).
- **Moxfield**: deck import by URL, and collection CSV import and export. Moxfield has no public API. URL import usually works on iOS, but browsers often block it, so the app asks you to paste the exported text instead.

Scryfall only publishes today's price, so price history is built on your device from daily snapshots of the cards you track: collection, decks, watchlist, wishlist and trades. History, movers and forecasts get better the longer the app runs.

*Not affiliated with Wizards of the Coast, Scryfall, TCGplayer, EDHREC or Moxfield. Forecasts are statistical estimates, not financial advice.*
