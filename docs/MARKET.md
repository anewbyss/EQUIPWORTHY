# Price updates, fast movers and synergy watch

Code: `web/src/lib/market.ts` + `refresh.ts` (web), and `ios/EquipWorthy.swiftpm/Sources/EquipWorthyKit/Market.swift` + `Sources/App/PriceRefresher.swift` (iOS). Both use the same rules and thresholds.

## Price refresh tool
- **Automatic:** once per calendar day, checked when the app opens, when it comes back to the foreground, and hourly while it's open. Settings can make it twice a day or every 6 hours. On iOS the background refresh also updates prices.
- **On demand:** the ↻ button next to Save on every screen. It updates your cards and re-runs the market scan.
- Scryfall publishes new TCGplayer prices about once a day, so refreshing more often rarely changes anything.

## Fast movers
- A card is a **spike** if it rose by at least *X%* in 1 day or *Y%* in 7 days, and a **crash** if it fell by that much. Defaults are 15% and 25%, set in Settings.
- Cards under the minimum price (default $1) are ignored, so bulk going from $0.10 to $0.30 doesn't flood you.
- **Your cards** (collection, decks, watchlist, wishlist, trades) raise an alert and notification, at most one per card per direction per day.
- **The market:** the daily scan records the price of the top *N* Commander cards by EDHREC popularity (default 525) and lists spikes and drops on Market Watch. The first daily changes appear after the second day of scans, and weekly changes after a week.

## Synergy watch (predictive)
When a new set is revealed, older cards that fit it, especially a new commander, often rise. Each daily scan:

1. Finds main sets released in the last 45 days or due in the next 120 days (spoiler season).
2. Loads every new (non-reprint) card from those sets.
3. Tags each card's strategy from its rules text: non-evergreen keywords (Proliferate, Landfall…), themes (+1/+1 counters, tokens, sacrifice, Treasure, graveyard, life gain, artifacts, enchantments, spells, blink, extra combats…) and creature types.
4. Scores every popular card and every card you track against the new cards:
   - shared mechanics and themes, weighted by how specific they are
   - creature-type synergy (e.g. a new card that says "Elves you control" boosts existing Elves)
   - ×1.5 when the new card is a **legendary creature** and the old card fits its colour identity, i.e. a new commander
   - top 5 contributions summed, then adjusted: mid-priced cards move most (×0.6 over $40, ×0.5 under $0.50), popular cards ×1.15, Reserved List ×1.1
5. Lists cards scoring ≥ 2 with the reasons and the new cards behind them.

A listed card also gets an **"Incoming synergy"** factor in its forecast: +0.8% per score point per 30 days, capped at +6%.

This is a heads-up list built from rules text, not a price guarantee. It can't see tournament results, buyouts or announcements that haven't been previewed yet.

## Data and sync
Market data (`profile.market`) is rebuilt on each device by its own daily scan, and isn't synced. Your cards' price history and alerts are synced as before.
