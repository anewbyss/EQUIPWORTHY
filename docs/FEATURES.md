# EquipWorthy features

✅ = in both the web and iOS apps. Notes mark platform differences.

## 0. Launch page
- ✅ The app opens on a home screen with a tile for every screen (Dashboard, Search, Collection, Batch Entry, Scan, Decks, Watchlist, Trade Scale, Life & Dice, Sets & Spoilers, Settings)
- ✅ Tiles show live details: collection value, card count, cards waiting for review, unread alerts, a game in progress
- ✅ Quick card lookup right on the home screen
- ✅ Web: the logo and the "Home" link return to it. iOS: it's the Home tab

## 1. Price hub
- ✅ Live TCGplayer market price (USD) for every printing and finish (non-foil, foil, etched), via Scryfall
- ✅ Price history chart (7D / 30D / 90D / 1Y / All) with a crosshair tooltip, built from daily on-device snapshots
- ✅ 7-day and 30-day change on every tracked card
- ✅ Market movers: biggest 7-day gainers and losers among your tracked cards
- ✅ Portfolio value over time, plus gain or loss against what you paid
- ✅ Watchlist with alert targets: price ≤ X, price ≥ Y, or a ±Z% weekly move
- ✅ Alerts list. Web: browser notifications while open. iOS: local notifications from a background refresh about every 6 h
- ✅ Automatic daily refresh (interval is configurable) and a manual Refresh
- ✅ Card page links to TCGplayer, EDHREC, Scryfall and Moxfield
- ✅ EDHREC panel: deck count, inclusion %, rank, top commanders, high-synergy cards
- ✅ All printings of a card with each printing's prices
- ✅ Sets & Spoilers browser: upcoming sets with cards previewed so far, and every released set sortable by price
- ✅ Full Scryfall search syntax with presets

## 1b. Price updates, fast movers and synergy watch ([MARKET.md](MARKET.md))
- ✅ Prices update automatically once a day; the ↻ refresh button next to Save on every screen updates them on demand
- ✅ Fast-mover alerts on your own cards: spikes and crashes past your thresholds (default ±15%/day or ±25%/week, ignoring cards under $1)
- ✅ Daily market scan of the most popular Commander cards (175–1,050, adjustable) for market-wide spikes and drops
- ✅ Synergy watch: reads every new card in recent and upcoming sets and ranks older cards likely to rise, especially ones that fit a new commander, with reasons
- ✅ Synergy picks add an "Incoming synergy" factor to forecasts
- ✅ Market Watch screen and launch tile; one-tap Watch on any mover or pick

## 2. Price forecasting
- ✅ 7-day and 30-day forecast: direction (up / flat / down), expected % move with a target price, and an 80% range
- ✅ Confidence level (Low / Medium / High) based on how much history exists and how volatile the price is
- ✅ "Why" panel listing each signal and its impact: momentum, spike or dip reversion, reprint risk, Reserved List, Commander demand, new-set dip and recovery, Standard rotation, bans
- ✅ Reprint-risk score (0–100%)
- ✅ Self-scoring: 7-day forecasts are logged daily and checked against actual prices, and the direction hit rate and average error show on the dashboard
- See [FORECASTING.md](FORECASTING.md)

## 3. Collection
- ✅ Track the exact printing, finish, condition (NM/LP/MP/HP/DMG), language, quantity, purchase price and date, binder, and physical location
- ✅ Binders, including a default Trade Binder; add or remove your own
- ✅ Filter by name, set, type, binder, finish, rarity and color; sort by value, price, name or date added
- ✅ Bulk edit: move binder, set condition, set location, delete
- ✅ Totals: market value, store cash value and store credit value
- ✅ Wishlist with max-price targets and total cost
- ✅ Set completion progress per set
- ✅ Export: EquipWorthy CSV, Moxfield CSV, TCGplayer mass entry, plain text list

## 4. Batch entry
- ✅ **Paste a list**: handles Moxfield, Arena and MTGO exports, `4x Name`, `(SET) 123`, `*F*`, `*E*`, conditions, `@ price` for what you paid, section headers (Commander, Deck, Sideboard, Maybeboard) and typos (fuzzy matching)
- ✅ **Set grid**: choose a set, then type `12, 45f, 3x88, 101e, 200-205`
- ✅ **CSV import** with automatic column detection for Moxfield, ManaBox, Deckbox, Dragon Shield, TCGplayer, Delver Lens and EquipWorthy files
- ✅ **Review queue**: matched, "check" and not-found rows, a printing picker, per-row finish, condition and quantity, apply-to-all, batch value, then send to Collection (choose a binder), a Deck, the Wishlist or the Watchlist
- ✅ The queue is saved with your profile, so nothing is lost if the app closes mid-batch

## 5. Card scanning
- ✅ iOS: live camera, card-edge detection with perspective correction, Apple Vision text recognition, rapid mode (auto-add with sound and haptic), torch, scan from a photo
- ✅ Web: device camera or photo upload with Tesseract.js, rapid mode, beep and vibration
- ✅ Reads the title for the name, and the bottom-left set code and collector number for the exact printing on 2020+ cards. Older cards match by name, and you choose the printing in review
- ✅ Shows the price immediately, so it doubles as a quick price check
- ✅ Scans go into the Batch Entry review queue
- Foil can't be detected from a photo, so set it with the finish selector. Rapid mode won't add the same card twice in a row; raise the quantity in review instead

## 6. Decks
- ✅ Formats: Commander, Standard, Pioneer, Modern, Legacy, Vintage, Pauper, Limited
- ✅ Boards: Commander, Main, Sideboard, Maybeboard
- ✅ Import from a Moxfield URL (native app, or the web when the browser allows it) or a pasted list; export and share as text
- ✅ Legality checks: deck size, copy limits, banned or restricted cards, Commander color identity
- ✅ Mana curve, color and type breakdown
- ✅ Owned vs. needed for each card, cost to finish, shopping list, add-all-to-wishlist, TCGplayer mass-entry link
- ✅ Sample hand (new 7, mulligan, draw) and a hypergeometric draw-odds calculator
- ✅ Deck value, notes, EDHREC commander link

## 7. Trade Scale
- ✅ A balance-beam image that tips toward the side worth more
- ✅ Add cards to each side, set finish and quantity per card, override prices, add cash to either side
- ✅ "Balanced" when the sides are within 5%; otherwise it tells you how much to add or ask for
- ✅ Suggests cards from your Trade Binder that close the gap
- ✅ Store trade-in mode values your side at the store-credit %
- ✅ Saved trades, and a reprice button

## 8. Life & Dice (game tracker)
- ✅ 1–6 players, starting life 20 / 25 / 30 / 40 or a custom number, player names
- ✅ Big life totals with −5 / −1 / +1 / +5 buttons. Taps in quick succession are merged into one log entry ("Ann −3 (40 → 37)")
- ✅ Commander damage per opponent: subtracts the same amount of life and flags 21+ as lethal
- ✅ Poison (lethal at 10), energy, experience and commander tax counters
- ✅ Automatic elimination (life, poison or commander damage), with turn order skipping eliminated players
- ✅ Turn counter showing the active player, Next turn, Rematch (same players) and New game
- ✅ Game log of every life change, damage, counter and turn
- ✅ Dice: d4, d6, d8, d10, d12, d20, d100, multiple dice plus a modifier, coin flip, random player, roll history
- ✅ The game is saved with your profile, so it survives closing the app. iOS keeps the screen awake during a game

## 9. Store buylist estimate
- ✅ Cash % and store credit % sliders (defaults 50% / 65% of market)
- ✅ Condition multipliers (NM 100%, LP 90%, MP 75%, HP 55%, DMG 35%; editable)
- ✅ Shown on every card page, collection totals, the dashboard and the trade scale

## 10. Profiles, storage and saving
- ✅ Multiple local profiles per device; create, rename, switch and delete
- ✅ Everything stays on the device: IndexedDB on web, JSON files in Application Support on iOS
- ✅ Frequent autosave: 1.5 s after any change, every N seconds (configurable) while there are unsaved changes, and when the app or tab is backgrounded or closed
- ✅ A manual **Save** button on every page or screen with live status ("Unsaved changes" / "Saved 5s ago"), plus Ctrl/Cmd+S on web
- ✅ Export and import JSON backups in one format that works on both platforms
- ✅ iOS: optional offline card database (Scryfall bulk data) so search and scanning work with no signal

## 11. Sync and platforms
- ✅ Optional end-to-end encrypted sync between the web app, iPhone and iPad through a private GitHub Gist ([SYNC.md](SYNC.md))
- ✅ Three-way merge, so edits on two devices are combined rather than overwritten
- ✅ Automatic sync plus a sync button beside Save on every screen
- ✅ Download a profile created on another device
- ✅ Web app works in Safari, Chrome, Firefox and Edge; installable via Add to Home Screen or Add to Dock, and works offline
- ✅ iOS app opens in Swift Playgrounds (iPad / Mac) and in Xcode

## 12. Look and feel
- Color theme: sky blue, violet and mustard gold, with light and dark modes on web (following the system setting) and iOS
- Each player in the life tracker gets their own color (sky, violet, gold, teal, rose, slate)
