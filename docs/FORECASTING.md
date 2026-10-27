# How EquipWorthy forecasts prices

The forecast is a transparent rules-plus-statistics model that runs entirely on the device. It is implemented twice, and the two must stay numerically identical:

- Web: `web/src/lib/forecast.ts`
- iOS: `ios/EquipWorthyKit/Sources/EquipWorthyKit/Forecast.swift`

## Inputs
- Up to 30 days of locally recorded daily prices for the card and finish
- Card metadata from Scryfall: release date, Reserved List flag, EDHREC rank, format legalities

## Signals
Each signal adds an impact, in % per 30 days, to the expected move:

| Signal | Rule | Impact |
|---|---|---|
| Momentum | Linear regression on log price over the last 30 days (needs ≥5 points spanning ≥5 days) | 0.4 × trend, capped at ±25% |
| Spike / dip reversion | Price more than 1.5 standard deviations from its 30-day mean | −0.3 × the gap from the mean, capped at ±20% |
| Reserved List | Can never be reprinted | +2% |
| Reprint risk | 0.4 × price factor + 0.35 × popularity + 0.25 × age (each 0–1) | −risk × 4% |
| Commander demand | EDHREC rank < 1000 / < 5000 | +1.5% / +0.5% |
| New-set dip | Released < 45 days ago | −6% |
| Settling | 45–120 days | −2% |
| Post-release recovery | 120–365 days | +1% |
| Standard rotation | Standard-legal and more than 30 months old | −2% |
| Ban | Banned in Commander, Modern, Pioneer, Standard or Legacy | −3% |
| Bulk floor | Price < $0.50 | negative impacts halved |

**Expected move** = the sum of impacts × (horizon ÷ 30).

**Range (80%)** = expected ± 1.2816 × σ × √horizon, where σ is the standard deviation of daily log returns. σ has a floor of 0.5%; with fewer than 5 returns it defaults by price tier (3% under $1, 2% under $10, 1.5% otherwise).

**Direction**: up if the expected move is above +2%, down if below −2%, flat otherwise.

**Confidence** = 0.5 × (history points ÷ 30) + 0.3 × (1 − σ ÷ 5%) + 0.2 × (signals ÷ 3), clamped to 0–1. High ≥ 0.66, Medium ≥ 0.4.

## Accuracy tracking
On each daily refresh, a 7-day forecast is logged for every collection and watchlist card. Once 7 days have passed, the actual move is filled in. The dashboard shows the direction hit rate and the mean absolute error.

## Limitations
- Scryfall publishes one price per day, and history only exists from when you start tracking a card.
- No order-book, buylist-spread or sales-volume data.
- Reprint announcements and bans are only picked up after they happen.
- Treat forecasts as one input among many, not financial advice.
