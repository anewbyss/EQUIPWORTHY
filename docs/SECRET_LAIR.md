# Secret Lair

Code: `web/src/lib/secretlair.ts`, `secretLairRunner.ts`, `pages/SecretLair.tsx` (web), and `ios/EquipWorthy.swiftpm/Sources/EquipWorthyKit/SecretLair.swift`, `Sources/App/SecretLairNotifier.swift`, `Views/SecretLairView.swift` (iOS).

## What it does
- **Follow drops:** add an announced drop by hand, or follow one from **Recent drops**. Recent drops are Scryfall's Secret Lair cards, grouped by release date and consecutive collector numbers, because Scryfall doesn't name drops. A followed drop's cards get daily prices, alerts and forecasts like any tracked card.
- **Sale details:** sale start and end, price, foil price, and the **official product link** from the Secret Lair site or Wizards' announcement.
- **Reminders** 24 hours, 1 hour, 15 minutes and 5 minutes before the sale, then **at launch**. The launch and 5-minute notifications open the drop page when tapped. From 15 minutes before until 2 hours after, a launch strip with an **Open the drop** button stays at the top of every screen.
  - iOS: scheduled as local notifications, so they fire even when the app is closed. Launch notifications are marked time-sensitive.
  - Web: browsers can't run sites in the background, so reminders only fire while EquipWorthy is open (as a Home Screen app or a tab). Only the most recent due reminder is shown, never a backlog.
- **Be ready to buy** checklist: signed in, address saved, payment ready, version and quantity decided, link added, plan to open the page early without extra tabs or refreshes, device charged and online. Progress shows as "% ready".
- **Place-in-line tracker:** type the position the official waiting room shows every minute or two. EquipWorthy fits a line through your last six readings to estimate how fast the line moves and when you'll get through. It notifies you at about 5 minutes and about 1 minute to go. On iOS these are scheduled from your latest estimate, so they arrive while you're in Safari.
- **Value check:** current market value of the drop's cards (non-foil and foil) against its price.
- **I bought it:** records version, quantity and price paid, and can add the cards to a "Secret Lair" binder with the cost split per card.

## What it doesn't do
EquipWorthy never joins the waiting room, refreshes the store, or buys anything for you. Automated entries break Secret Lair's terms of sale, can get orders cancelled, and are what the waiting room exists to stop. EquipWorthy's job is to get you to the official page at the right moment, ready to check out yourself.

## Data and sync
Followed drops, checklists, line readings and purchases are part of your profile and sync between devices. The Recent drops catalog is downloaded on each device and isn't synced.
