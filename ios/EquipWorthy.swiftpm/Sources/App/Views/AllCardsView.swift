import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

/// The daily all-cards market feed: your hot sells and buy signals, then risers, fallers and signals across every card.
@MainActor
struct AllCardsSection: View {
    @EnvironmentObject var store: ProfileStore
    @EnvironmentObject var refresher: PriceRefresher
    enum FeedList: String, CaseIterable {
        case sell = "Sell spikes", buy = "Buy dips", up1 = "Risers today", down1 = "Fallers today", up7 = "Risers this week", down7 = "Fallers this week"
        var key: String { String(describing: self) }
        var help: String {
            switch self {
            case .sell: return "Up 30%+ this week, at least $3, and well above the 30-day average. Prices often settle after a spike."
            case .buy: return "Popular Commander cards (EDHREC top 15,000) down 20%+ this week and below their 30-day average."
            case .up1, .down1: return "Biggest one-day moves (at least $1 and a $0.50 move)."
            case .up7, .down7: return "Biggest 7-day moves (at least $1 and a $1 move)."
            }
        }
    }
    @State private var list = FeedList.sell
    @State private var minPrice: Double = 0

    var body: some View {
        let p = store.profile
        if !p.settings.marketFeed {
            Text("The all-cards feed is off. Turn it on in Settings.").foregroundStyle(.secondary)
        } else if let a = p.allCards {
            signalSection("Hot sells: your cards", a.signals.filter { $0.kind == "sell" }, empty: "None of your cards are spiking in today's feed.")
            signalSection("Buy signals: cards you want", a.signals.filter { $0.kind == "buy" }, empty: "Nothing on your watchlist, wishlist or decks is dipping today.")
            Section {
                Picker("List", selection: $list) { ForEach(FeedList.allCases, id: \.self) { Text($0.rawValue) } }
                Stepper("Min price \(minPrice.usd)", value: $minPrice, in: 0...500, step: 1)
                Text(list.help).font(.caption).foregroundStyle(.secondary)
                let rows = sorted(a.feed.entries.filter { $0.lists.contains(list.key) && $0.price >= minPrice })
                if rows.isEmpty {
                    Text(a.feed.historyDays < 2 ? "The feed's history is just starting: moves appear after its second daily scan." : "Nothing in this list right now.")
                        .foregroundStyle(.secondary)
                }
                ForEach(rows.prefix(150)) { e in FeedRow(entry: e) }
            } header: {
                Text("All cards · \(a.feed.date)")
            } footer: {
                Text("TCGplayer market prices from Scryfall for \(a.feed.scanned) English paper printings, checked once a day (\(a.feed.historyDays) days of history). Signals are heads-ups, not financial advice.")
            }
        } else {
            Section {
                Text("No market feed yet. Tap Scan now to load it. It's published once a day by the daily market scan.").foregroundStyle(.secondary)
            }
        }
    }

    private func sorted(_ rows: [FeedEntry]) -> [FeedEntry] {
        switch list {
        case .up1: return rows.sorted { ($0.d1 ?? 0) > ($1.d1 ?? 0) }
        case .down1: return rows.sorted { ($0.d1 ?? 0) < ($1.d1 ?? 0) }
        case .down7, .buy: return rows.sorted { ($0.d7 ?? 0) < ($1.d7 ?? 0) }
        case .up7, .sell: return rows.sorted { ($0.d7 ?? 0) > ($1.d7 ?? 0) }
        }
    }

    @ViewBuilder private func signalSection(_ title: String, _ signals: [PriceSignal], empty: String) -> some View {
        Section(title) {
            if signals.isEmpty { Text(empty).font(.callout).foregroundStyle(.secondary) }
            ForEach(signals.prefix(20)) { s in
                VStack(alignment: .leading, spacing: 4) {
                    FeedRow(entry: s.entry)
                    Text(signalNote(s)).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func signalNote(_ s: PriceSignal) -> String {
        if s.kind == "sell" { return "You own \(s.owned)" + (s.samePrint ? "" : " (another printing)") }
        return "On your \(s.place ?? "list")" + (s.samePrint ? "" : " (another printing)")
    }
}

@MainActor
struct FeedRow: View {
    @EnvironmentObject var store: ProfileStore
    let entry: FeedEntry

    var body: some View {
        let e = entry
        let watched = store.profile.watchlist.contains { $0.cardId == e.id }
        HStack(alignment: .top) {
            CardImage(url: e.image, width: 36)
            VStack(alignment: .leading, spacing: 2) {
                NavigationLink { CardDetailView(cardId: e.id) } label: { Text(e.name).bold().lineLimit(1) }
                Text(e.set.uppercased() + (e.isFoil ? " · foil" : "") + (e.signal.map { $0 == "sell" ? " · sell spike" : " · buy dip" } ?? ""))
                    .font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Text(e.price.usd).font(.callout.bold())
                    Text(Feed.change(e)).font(.caption).foregroundStyle((e.d7 ?? e.d1 ?? 0) >= 0 ? Theme.up : Theme.down)
                    if let avg = e.avg30 { Text("avg \(avg.usd)").font(.caption).foregroundStyle(.secondary) }
                }
                HStack {
                    if let u = e.tcgplayer.flatMap({ URL(string: $0) }) { Link("TCGplayer", destination: u).font(.caption) }
                    if !watched {
                        Button("Watch") { watch(e) }.font(.caption).buttonStyle(.borderless)
                    }
                }
            }
        }
    }

    private func watch(_ e: FeedEntry) {
        let finish: Finish = e.isFoil ? .foil : .nonfoil
        store.mutate { p in
            guard !p.watchlist.contains(where: { $0.cardId == e.id }) else { return }
            p.watchlist.append(WatchItem(cardId: e.id, name: e.name, finish: finish, pctMove: p.settings.spikePct7d))
        }
    }
}
