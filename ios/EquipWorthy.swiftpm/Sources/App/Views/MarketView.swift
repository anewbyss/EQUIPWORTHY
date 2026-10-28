import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

@MainActor
struct MarketView: View {
    @EnvironmentObject var store: ProfileStore
    @EnvironmentObject var refresher: PriceRefresher
    enum Tab: String, CaseIterable { case all = "All cards", movers = "Fast movers", synergy = "Synergy" }
    @State private var tab = Tab.all

    var body: some View {
        let p = store.profile
        let m = p.market
        let movers = m?.movers ?? []
        List {
            Section {
                Picker("View", selection: $tab) { ForEach(Tab.allCases, id: \.self) { Text($0.rawValue) } }.pickerStyle(.segmented)
                if let last = m?.lastScan.flatMap(parseISO) {
                    Text("Last scan \(last.formatted(.relative(presentation: .named))) · \(m?.history.count ?? 0) popular Commander cards tracked daily")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if !p.settings.marketScan { Text("Market scanning is off. Turn it on in Settings.").font(.caption) }
                if let e = refresher.error { Text(e).font(.caption).foregroundStyle(Theme.down) }
                Button(refresher.running ? (refresher.step ?? "Scanning…") : "Scan now") { Task { await refresher.refreshAll(force: true) } }
                    .disabled(refresher.running)
            }
            switch tab {
            case .all:
                AllCardsSection()
            case .movers:
                Section {
                    Text("Moving fast = \(Int(p.settings.spikePct1d))%+ in a day or \(Int(p.settings.spikePct7d))%+ in a week (cards under \(p.settings.moverMinPrice.usd) ignored).")
                        .font(.caption).foregroundStyle(.secondary)
                }
                moverSection("Your cards", movers.filter(\.tracked), empty: "None of your cards are moving fast right now.")
                moverSection("Market spikes ▲", movers.filter { !$0.tracked && $0.kind == .spike }, empty: m == nil ? "Run a scan to start building market history." : "No spikes past your threshold.")
                moverSection("Market drops ▼", movers.filter { !$0.tracked && $0.kind == .crash }, empty: m == nil ? "Market history builds up one day at a time." : "No sharp drops past your threshold.")
            case .synergy:
                Section {
                    Text("When new cards are revealed, older cards that play well with them (especially with a new commander) often jump in price. EquipWorthy reads every new card in recent and upcoming sets and ranks popular cards and your own by how well they fit. A heads-up list, not a guarantee.")
                        .font(.caption).foregroundStyle(.secondary)
                    if let sets = m?.newSets, !sets.isEmpty {
                        Text("Sets analyzed: " + sets.map { "\($0.name) (\($0.releasedAt ?? "TBA"))" }.joined(separator: ", ")).font(.caption)
                    }
                }
                Section("Synergy picks") {
                    if (m?.synergy ?? []).isEmpty {
                        Text(m == nil ? "Run a scan to analyze new and upcoming sets." : "No strong synergy picks from the current new sets.").foregroundStyle(.secondary)
                    }
                    ForEach(m?.synergy ?? []) { s in
                        NavigationLink { CardDetailView(cardId: s.cardId) } label: { SynergyRow(pick: s, card: m?.cards[s.cardId] ?? p.card(s.cardId), owned: p.collection.contains { $0.cardId == s.cardId }) }
                            .swipeActions { watchButton(s.cardId, s.name) }
                    }
                }
            }
        }
        .navigationTitle("Market Watch")
        .refreshable { await refresher.refreshAll(force: true) }
        .saveToolbar()
    }

    @ViewBuilder private func moverSection(_ title: String, _ rows: [Mover], empty: String) -> some View {
        Section(title) {
            if rows.isEmpty { Text(empty).foregroundStyle(.secondary) }
            ForEach(rows) { r in
                NavigationLink { CardDetailView(cardId: r.cardId) } label: {
                    HStack {
                        CardImage(url: (store.profile.card(r.cardId) ?? store.profile.market?.cards[r.cardId])?.imageSmall, width: 30)
                        VStack(alignment: .leading) {
                            Text(r.name).lineLimit(1)
                            Text(r.set.uppercased()).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing) {
                            Text(r.price.usd).monospacedDigit()
                            HStack(spacing: 6) { ChangeText(value: r.d1); ChangeText(value: r.d7) }.font(.caption)
                        }
                    }
                }
                .swipeActions { if !r.tracked { watchButton(r.cardId, r.name) } }
            }
        }
    }

    private func watchButton(_ cardId: String, _ name: String) -> some View {
        Button("Watch") {
            store.mutate { p in
                guard !p.watchlist.contains(where: { $0.cardId == cardId }) else { return }
                p.watchlist.append(WatchItem(cardId: cardId, name: name, finish: .nonfoil, pctMove: p.settings.spikePct7d))
            }
        }
        .tint(Theme.violet)
    }
}

@MainActor
struct SynergyRow: View {
    let pick: SynergyPick
    let card: CardSummary?
    let owned: Bool

    var body: some View {
        HStack(alignment: .top) {
            CardImage(url: card?.imageSmall, width: 36)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(pick.name).bold().lineLimit(1)
                    if owned { Text("owned").font(.caption2).foregroundStyle(Theme.up) }
                }
                ForEach(pick.reasons, id: \.self) { Text($0).font(.caption) }
                Text("New cards: " + pick.sources.prefix(3).joined(separator: ", ")).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing) {
                Text(String(format: "%.1f", pick.score)).font(.caption.bold()).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Theme.gold.opacity(0.25), in: Capsule())
                Text(pick.price.usd).font(.caption).monospacedDigit()
            }
        }
    }
}
