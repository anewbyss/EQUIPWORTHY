import SwiftUI
import EquipWorthyKit

@MainActor
struct WatchlistView: View {
    @EnvironmentObject var store: ProfileStore

    var body: some View {
        let p = store.profile
        List {
            Section {
                CardSearchField(prompt: "Watch a card…") { c in
                    store.mutate { $0.watchlist.append(WatchItem(cardId: c.id, name: c.name, finish: c.finishes.contains(.nonfoil) ? .nonfoil : (c.finishes.first ?? .nonfoil))) }
                }
            }
            Section("Watching") {
                if p.watchlist.isEmpty { Text("Nothing yet.").foregroundStyle(.secondary) }
                ForEach(p.watchlist) { w in
                    NavigationLink { WatchEditor(watchId: w.id) } label: {
                        let s = p.history(w.cardId, w.finish)
                        let price = p.price(w.cardId, w.finish)
                        let fc = p.card(w.cardId).flatMap { Forecaster.forecast(card: $0, series: s, currentPrice: price, horizonDays: 30) }
                        HStack {
                            VStack(alignment: .leading) {
                                Text(w.name).lineLimit(1)
                                Text(targets(w)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing) {
                                Text(price.usd).monospacedDigit()
                                HStack(spacing: 6) {
                                    ChangeText(value: Snapshot.change(s, days: 7)).font(.caption)
                                    if let fc { Text("30d \(fc.expectedPct.signedPct)").font(.caption).foregroundStyle(fc.direction == .up ? Theme.up : fc.direction == .down ? Theme.down : Color.secondary) }
                                }
                            }
                        }
                    }
                }
                .onDelete { idx in
                    let ids = Set(idx.map { p.watchlist[$0].id })
                    store.mutate { $0.watchlist.removeAll { ids.contains($0.id) } }
                }
            }
            Section {
                ForEach(p.alerts) { a in
                    NavigationLink { CardDetailView(cardId: a.cardId) } label: {
                        VStack(alignment: .leading) {
                            Text(a.message).fontWeight(a.read ? .regular : .semibold)
                            Text(parseISO(a.createdAt)?.formatted() ?? "").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if p.alerts.isEmpty { Text("Alerts are checked whenever prices refresh, including in the background about every \(Int(p.settings.autoRefreshHours)) hours.").font(.footnote).foregroundStyle(.secondary) }
            } header: {
                HStack {
                    Text("Alerts")
                    Spacer()
                    Button("Mark read") { store.mutate { p in for i in p.alerts.indices { p.alerts[i].read = true } } }.font(.caption)
                    Button("Clear") { store.mutate { $0.alerts = [] } }.font(.caption)
                }
            }
        }
        .navigationTitle("Watchlist")
        .saveToolbar()
        .onAppear { Notifier.requestPermission() }
    }

    private func targets(_ w: WatchItem) -> String {
        var t: [String] = []
        if let b = w.below { t.append("≤ \(b.usd)") }
        if let a = w.above { t.append("≥ \(a.usd)") }
        if let m = w.pctMove { t.append("±\(Int(m))%/wk") }
        return t.isEmpty ? "No alert targets" : t.joined(separator: " · ")
    }
}

@MainActor
struct WatchEditor: View {
    let watchId: String
    @EnvironmentObject var store: ProfileStore

    var body: some View {
        if let w = store.profile.watchlist.first(where: { $0.id == watchId }) {
            Form {
                Section(w.name) {
                    LabeledContent("Current price", value: store.profile.price(w.cardId, w.finish).usd)
                    NavigationLink("Card details & forecast") { CardDetailView(cardId: w.cardId) }
                }
                Section("Alert me when") {
                    field("Price drops to $", \.below)
                    field("Price rises to $", \.above)
                    field("Moves ±% in a week", \.pctMove)
                }
            }
            .navigationTitle("Alert targets")
            .saveToolbar()
        }
    }

    private func field(_ label: String, _ kp: WritableKeyPath<WatchItem, Double?>) -> some View {
        HStack {
            Text(label)
            TextField("off", value: Binding(
                get: { store.profile.watchlist.first { $0.id == watchId }?[keyPath: kp] },
                set: { v in store.mutate { p in if let i = p.watchlist.firstIndex(where: { $0.id == watchId }) { p.watchlist[i][keyPath: kp] = v } } }),
                format: .number)
                .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
        }
    }
}
