# Secret Lair

Code: `web/src/lib/secretlair.ts`, `secretLairRunner.ts`, `pages/SecretLair.tsx` (web), and `ios/EquipWorthy.swiftpm/Sources/EquipWorthyKit/SecretLair.swift`, `Sources/App/SecretLairNotifier.swift`, `Views/SecretLairView.swift` (iOS).

## What it does
- **Follow drops:** add an announced drop by hand, or follow one from **Recent drops**. Recent drops are Scryfall's Secret Lair cards, grouped by release date and consecutive collector numbers, because Scryfall doesn't name drops. A followed drop's cards get daily prices, alerts and forecasts like any tracked card.
- **Upcoming & announced:** drops appear as soon as Scryfall lists their previewed cards, usually within a day of the announcement, soonest release first, plus anything released in the last 30 days. Each one shows when it was announced and by whom, with an **Announcement** link (Scryfall's preview source for the cards) and a **Cards on Scryfall** link. Following a drop keeps its announcement link.
- **Pre-drop price check** on every upcoming and followed drop, non-foil or foil:
  - the drop's price (its real price once you enter it; until then the usual $29.99, or $39.99 foil)
  - **Secret Lair market:** TCGplayer market or pre-order prices for the Secret Lair versions, once they exist
  - **Cheapest elsewhere:** the cheapest copy of each card in any other set (cards with no other printing are marked *new card*)
  - a one-line read such as "Secret Lair copies trade $10.01 above the price; the cards cost $19.99 less in other printings".
  - A **past drops** line gives context: the median value of drops released 2 months to 2 years ago, as a share of the usual price.
  - Reprint prices are looked up in batched Scryfall searches and refreshed every 2 days, or on demand with **Re-check**.
- **Sale details:** sale start and end, price, foil price, and the **official product link** from the Secret Lair site or Wizards' announcement.
- **Reminders** 24 hours, 1 hour, 15 minutes and 5 minutes before the sale, then **at launch**. The launch and 5-minute notifications open the drop page when tapped. From 15 minutes before until 2 hours after, a launch strip with an **Open the drop** button stays at the top of every screen.
  - iOS: scheduled as local notifications, so they fire even when the app is closed. Launch notifications are marked time-sensitive.
  - Web: browsers can't run sites in the background, so reminders only fire while EquipWorthy is open (as a Home Screen app or a tab). Only the most recent due reminder is shown, never a backlog. Use one of the options below to get them with the site closed.
- **Reminder delivery** (Settings, web and iOS), so reminders reach you with EquipWorthy closed:
  - **Push alerts (ntfy):** install the free [ntfy app](https://ntfy.sh), tap **New** for a private topic and subscribe to it in the app. EquipWorthy schedules each reminder on ntfy (up to 3 days ahead, topping up as drops get closer), and tapping one opens the drop page. Code: `web/src/lib/channels.ts`, `EquipWorthyKit/Channels.swift`, `App/ReminderChannels.swift`.
  - **Text messages:** real SMS through your own small service on Cloudflare + Twilio. Setup guide: [sms-worker/README.md](../sms-worker/README.md). Your Twilio keys live only in that service, and it only ever texts your number.
  - **Calendar:** *Add to calendar* on a drop creates an event at the sale time with alerts at 24 h, 1 h, 15 min, 5 min and launch, plus the drop link (web: `.ics` file; iOS: the system Add Event sheet).
- **Be ready to buy** checklist: signed in, address saved, payment ready, version and quantity decided, link added, plan to open the page early without extra tabs or refreshes, device charged and online. Progress shows as "% ready".
- **Place-in-line tracker:** type the position the official waiting room shows every minute or two. EquipWorthy fits a line through your last six readings to estimate how fast the line moves and when you'll get through. It notifies you at about 5 minutes and about 1 minute to go. On iOS these are scheduled from your latest estimate, so they arrive while you're in Safari.
- **Value check:** current market value of the drop's cards (non-foil and foil) against its price.
- **I bought it:** records version, quantity and price paid, and can add the cards to a "Secret Lair" binder with the cost split per card.

## What it doesn't do
EquipWorthy never joins the waiting room, refreshes the store, or buys anything for you. Automated entries break Secret Lair's terms of sale, can get orders cancelled, and are what the waiting room exists to stop. EquipWorthy's job is to get you to the official page at the right moment, ready to check out yourself.

## Data and sync
Followed drops, checklists, line readings and purchases are part of your profile and sync between devices. The Recent drops catalog is downloaded on each device and isn't synced.
