import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

@MainActor
struct DashboardView: View {
    @EnvironmentObject var store: ProfileStore
    @State private var picked: CardSummary?

    struct Mover: Identifiable { let id: String; let cardId: String; let name: String; let price: Double; let d7: Double?; let d30: Double? }

    var movers: (gainers: [Mover], losers: [Mover]) {
        let p = store.profile
        var rows: [Mover] = []
        for id in Snapshot.trackedIds(p) {
            guard let card = p.card(id) else { continue }
            for f in Finish.allCases {
                let s = p.history(id, f)
                guard s.count >= 2, let last = s.last else { continue }
                rows.append(Mover(id: id + f.rawValue, cardId: id, name: card.name + (f == .nonfoil ? "" : " (\(f.rawValue))"),
                                  price: last.price, d7: Snapshot.change(s, days: 7), d30: Snapshot.change(s, days: 30)))
            }
        }
        let withMove = rows.filter { $0.d7 != nil }
        return (Array(withMove.filter { $0.d7! > 0 }.sorted { $0.d7! > $1.d7! }.prefix(6)),
                Array(withMove.filter { $0.d7! < 0 }.sorted { $0.d7! < $1.d7! }.prefix(6)))
    }

    var body: some View {
        let p = store.profile
        let value = Snapshot.collectionValue(p)
        let costed = p.collection.filter { $0.purchasePrice != nil }
        let cost = costed.reduce(0) { $0 + ($1.purchasePrice ?? 0) * Double($1.quantity) }
        let costedValue = costed.reduce(0) { $0 + (p.price($1.cardId, $1.finish) ?? 0) * Double($1.quantity) }
        let cash = cashValue(p)
        let acc = Forecaster.accuracy(p.forecastLog)
        let m = movers

        List {
            Section {
                CardSearchField(prompt: "Look up any card…") { picked = $0 }
            }
            Section {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    StatTile(label: "Collection value", value: value.usd, sub: "\(p.collection.reduce(0) { $0 + $1.quantity }) cards")
                    StatTile(label: "Gain / loss", value: costed.isEmpty ? "—" : (costedValue - cost).usd, sub: costed.isEmpty ? "Add purchase prices" : "\(costed.count) entries")
                    StatTile(label: "Store cash \(Int(p.settings.buylistCashPct))%", value: cash.usd, sub: "condition-adjusted")
                    StatTile(label: "Forecast accuracy", value: acc.map { "\(Int($0.directionHitRate * 100))%" } ?? "—", sub: acc.map { "\($0.count) calls" } ?? "after a week")
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
            Section("Portfolio value") {
                PriceChart(series: p.portfolioHistory, label: "Value")
            }
            Section("Top gainers (7 days)") { moverRows(m.gainers) }
            Section("Top losers (7 days)") { moverRows(m.losers) }
            Section("Recent alerts") {
                if p.alerts.isEmpty {
                    Text("No alerts. Add price targets on the Watchlist.").foregroundStyle(.secondary)
                }
                ForEach(p.alerts.prefix(6)) { a in
                    NavigationLink(value: a.cardId) {
                        Text(a.message).foregroundStyle(a.read ? .secondary : .primary)
                    }
                }
            }
        }
        .navigationTitle("EquipWorthy")
        .navigationDestination(for: String.self) { CardDetailView(cardId: $0) }
        .navigationDestination(item: $picked) { CardDetailView(cardId: $0.id) }
        .refreshable { await store.refreshPrices() }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { Task { await store.refreshPrices() } } label: {
                    if store.refreshing != nil { ProgressView() } else { Image(systemName: "arrow.clockwise") }
                }
                .accessibilityLabel("Refresh prices")
            }
        }
        .saveToolbar()
        .overlay(alignment: .bottom) {
            if let e = store.lastError {
                Text(e).font(.footnote).padding(8).background(.thinMaterial, in: Capsule()).padding()
                    .onTapGesture { store.lastError = nil }
            }
        }
    }

    private func cashValue(_ p: Profile) -> Double {
        var total = 0.0
        for c in p.collection {
            let market: Double = p.price(c.cardId, c.finish) ?? 0
            total += Buylist.value(market: market, pct: p.settings.buylistCashPct, condition: c.condition, settings: p.settings) * Double(c.quantity)
        }
        return total
    }

    @ViewBuilder func moverRows(_ rows: [Mover]) -> some View {
        if rows.isEmpty {
            Text("Movers appear after two days of price snapshots.").foregroundStyle(.secondary)
        }
        ForEach(rows) { r in
            NavigationLink(value: r.cardId) {
                HStack {
                    Text(r.name).lineLimit(1)
                    Spacer()
                    Text(r.price.usd).monospacedDigit()
                    ChangeText(value: r.d7).frame(width: 70, alignment: .trailing)
                }
            }
        }
    }
}
