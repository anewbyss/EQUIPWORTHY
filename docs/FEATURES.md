# EquipWorthy features

✅ = in both the web and iOS apps. Notes mark platform differences.

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

## 8. Store buylist estimate
- ✅ Cash % and store credit % sliders (defaults 50% / 65% of market)
- ✅ Condition multipliers (NM 100%, LP 90%, MP 75%, HP 55%, DMG 35%; editable)
- ✅ Shown on every card page, collection totals, the dashboard and the trade scale

## 9. Profiles, storage and saving
- ✅ Multiple local profiles per device; create, rename, switch and delete
- ✅ Everything stays on the device: IndexedDB on web, JSON files in Application Support on iOS
- ✅ Frequent autosave: 1.5 s after any change, every N seconds (configurable) while there are unsaved changes, and when the app or tab is backgrounded or closed
- ✅ A manual **Save** button on every page or screen with live status ("Unsaved changes" / "Saved 5s ago"), plus Ctrl/Cmd+S on web
- ✅ Export and import JSON backups in one format that works on both platforms
- ✅ iOS: optional offline card database (Scryfall bulk data) so search and scanning work with no signal
