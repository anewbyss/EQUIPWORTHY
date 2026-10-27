# Data model and backup format

A profile is a single JSON document. The web app keeps it in IndexedDB (`ew:profile:<id>`). The iOS app keeps it at `Application Support/Profiles/<id>.json`. Exported backups use exactly the same JSON, so they import on either platform.

Source of truth: `web/src/lib/types.ts` and `ios/EquipWorthyKit/Sources/EquipWorthyKit/Models.swift`.

```jsonc
{
  "schemaVersion": 1,
  "id": "uuid", "name": "My Collection", "createdAt": "ISO", "updatedAt": "ISO",
  "settings": {
    "autosaveSeconds": 20, "buylistCashPct": 50, "buylistCreditPct": 65,
    "defaultCondition": "NM", "defaultBinder": "Main",
    "conditionMultipliers": { "NM": 1, "LP": 0.9, "MP": 0.75, "HP": 0.55, "DMG": 0.35 },
    "autoRefreshHours": 12, "notifications": true
  },
  "binders": ["Main", "Trade Binder"],
  "collection": [{ "id", "cardId", "name", "set", "collectorNumber", "finish", "condition", "language",
                   "quantity", "purchasePrice?", "purchaseDate?", "binder", "location?", "addedAt" }],
  "wishlist":   [{ "id", "cardId", "name", "finish", "quantity", "maxPrice?", "addedAt" }],
  "decks":      [{ "id", "name", "format", "cards": [{ "cardId", "name", "quantity", "board" }], "notes?", "source?", "createdAt", "updatedAt" }],
  "watchlist":  [{ "id", "cardId", "name", "finish", "below?", "above?", "pctMove?", "addedAt" }],
  "alerts":     [{ "id", "cardId", "name", "kind": "below|above|move", "message", "createdAt", "read" }],
  "trades":     [{ "id", "name", "mine": [TradeSideCard], "theirs": [TradeSideCard], "mineCash", "theirsCash", "createdAt", "updatedAt" }],
  "priceHistory": { "<scryfallId>:<finish>": [["2026-10-27", 12.34], ...] },
  "portfolioHistory": [["2026-10-27", 1234.56], ...],
  "forecastLog": [{ "cardId", "finish", "madeOn", "horizonDays", "startPrice", "expectedPct", "resolvedPct?" }],
  "cardCache": { "<scryfallId>": CardSummary },
  "lastPriceRefresh": "ISO",
  "pendingBatch": [PendingRow]   // batch-entry review queue
}
```

- `finish`: `nonfoil` | `foil` | `etched`
- `condition`: `NM` | `LP` | `MP` | `HP` | `DMG`
- `board`: `commander` | `main` | `side` | `maybe`
- `format`: `commander` | `standard` | `pioneer` | `modern` | `legacy` | `vintage` | `pauper` | `limited`
- Dates in price series are UTC `YYYY-MM-DD`, with one point per day, capped at 730 points.
- Readers fill missing fields with defaults, so older backups keep working.
