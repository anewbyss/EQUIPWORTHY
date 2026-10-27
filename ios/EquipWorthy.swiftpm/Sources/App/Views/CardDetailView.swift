import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

@MainActor
struct CardDetailView: View {
    let cardId: String
    @EnvironmentObject var store: ProfileStore
    @State private var card: CardSummary?
    @State private var finish: Finish = .nonfoil
    @State private var horizon = 30
    @State private var edhrec: EDHRECInfo?
    @State private var edhrecLoaded = false
    @State private var printings: [CardSummary]?
    @State private var condition: Condition = .NM
    @State private var qty = 1
    @State private var binder = "Main"
    @State private var paid = ""
    @State private var toast: String?
    @State private var error: String?

    var body: some View {
        Group {
            if let card { content(card) } else if let error { Text(error).foregroundStyle(.red) } else { ProgressView() }
        }
        .navigationTitle(card?.name ?? "Card")
        .navigationBarTitleDisplayMode(.inline)
        .saveToolbar()
        .task(id: cardId) { await load() }
        .overlay(alignment: .bottom) {
            if let toast { Text(toast).padding(10).background(.thinMaterial, in: Capsule()).padding().transition(.opacity) }
        }
    }

    private func load() async {
        card = store.profile.card(cardId)
        binder = store.profile.settings.defaultBinder
        condition = store.profile.settings.defaultCondition
        do {
            let c = try await Scryfall.shared.card(id: cardId)
            card = c
            if !c.finishes.contains(finish), let f = c.finishes.first { finish = f }
            if Snapshot.trackedIds(store.profile).contains(c.id) { store.mutate { $0 = Snapshot.apply($0, fresh: [c]) } } else { store.cache([c]) }
        } catch {
            if card == nil { self.error = error.localizedDescription }
        }
        if let c = card { edhrec = await EDHREC.cardInfo(c.name) }
        edhrecLoaded = true
    }

    /// This card (or another printing of it) on the Market Watch synergy list.
    private func synergyPick(for card: CardSummary) -> SynergyPick? {
        guard let market = store.profile.market else { return nil }
        for pick in market.synergy {
            if pick.cardId == card.id { return pick }
            if let o = card.oracleId, market.cards[pick.cardId]?.oracleId == o { return pick }
        }
        return nil
    }

    private func flash(_ s: String) {
        withAnimation { toast = s }
        Task { try? await Task.sleep(nanoseconds: 2_000_000_000); withAnimation { toast = nil } }
    }

    @ViewBuilder private func content(_ card: CardSummary) -> some View {
        let p = store.profile
        let series = p.history(card.id, finish)
        let price = card.price(finish)
        List {
            Section {
                HStack(alignment: .top, spacing: 12) {
                    CardImage(url: card.image ?? card.imageSmall, width: 150)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(card.setName) (\(card.set.uppercased())) #\(card.collectorNumber)").font(.caption).foregroundStyle(.secondary)
                        Text(card.rarity.capitalized + (card.reserved ? " · Reserved List" : "")).font(.caption)
                        Text(price.usd).font(.largeTitle.bold()).monospacedDigit()
                        Picker("Finish", selection: $finish) {
                            ForEach(card.finishes) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        HStack { Text("7d"); ChangeText(value: Snapshot.change(series, days: 7)); Text("30d"); ChangeText(value: Snapshot.change(series, days: 30)) }
                            .font(.caption)
                    }
                }
                links(card)
            }

            Section("Price history (TCGplayer market)") {
                PriceChart(series: series, label: finish.label)
                if !Snapshot.trackedIds(p).contains(card.id) {
                    Text("Add this card to your collection, a deck or the watchlist and EquipWorthy will record its price every day.").font(.caption).foregroundStyle(.secondary)
                }
            }

            if let fc = Forecaster.forecast(card: card, series: series, currentPrice: price, horizonDays: horizon, synergy: synergyPick(for: card)) {
                Section("Forecast") { ForecastView(fc: fc, horizon: $horizon) }
            }

            Section("What would a store pay?") {
                PctSlider(label: "Cash", value: Binding(get: { store.profile.settings.buylistCashPct }, set: { v in store.mutate { $0.settings.buylistCashPct = v } }))
                PctSlider(label: "Credit", value: Binding(get: { store.profile.settings.buylistCreditPct }, set: { v in store.mutate { $0.settings.buylistCreditPct = v } }))
                Picker("Condition", selection: $condition) { ForEach(Condition.allCases) { Text($0.rawValue).tag($0) } }
                if let price {
                    LabeledContent("Cash", value: Buylist.value(market: price, pct: p.settings.buylistCashPct, condition: condition, settings: p.settings).usd)
                    LabeledContent("Store credit", value: Buylist.value(market: price, pct: p.settings.buylistCreditPct, condition: condition, settings: p.settings).usd)
                }
            }

            Section("Add to collection") {
                Stepper("Quantity: \(qty)", value: $qty, in: 1...999)
                Picker("Condition", selection: $condition) { ForEach(Condition.allCases) { Text($0.rawValue).tag($0) } }
                Picker("Binder", selection: $binder) { ForEach(p.binders, id: \.self) { Text($0).tag($0) } }
                TextField("Paid each $ (optional)", text: $paid).keyboardType(.decimalPad)
                Button("Add \(qty)× \(finish.label)") { addToCollection(card) }.bold()
                let owned = p.collection.filter { $0.cardId == card.id }.reduce(0) { $0 + $1.quantity }
                Text("You own \(owned) of this printing.").font(.caption).foregroundStyle(.secondary)
            }

            Section("Track") {
                let watched = p.watchlist.contains { $0.cardId == card.id && $0.finish == finish }
                Button(watched ? "★ Watching" : "☆ Add to watchlist") {
                    store.mutate { pr in
                        if watched { pr.watchlist.removeAll { $0.cardId == card.id && $0.finish == finish } }
                        else { pr.watchlist.append(WatchItem(cardId: card.id, name: card.name, finish: finish, below: price.map { ($0 * 0.85 * 100).rounded() / 100 })) }
                    }
                    flash(watched ? "Removed from watchlist" : "Watching. Set targets in Watchlist.")
                }
                Button("Add to wishlist") {
                    store.mutate { $0.wishlist.append(WishItem(cardId: card.id, name: card.name, finish: finish)) }
                    flash("Added to wishlist")
                }
                Menu("Add to deck") {
                    ForEach(p.decks) { d in
                        Button(d.name) {
                            store.mutate { pr in
                                guard let i = pr.decks.firstIndex(where: { $0.id == d.id }) else { return }
                                if let j = pr.decks[i].cards.firstIndex(where: { $0.cardId == card.id && $0.board == .main }) { pr.decks[i].cards[j].quantity += 1 }
                                else { pr.decks[i].cards.append(DeckCard(cardId: card.id, name: card.name, quantity: 1, board: .main)) }
                                pr.decks[i].updatedAt = isoNow()
                            }
                            flash("Added to \(d.name)")
                        }
                    }
                }
                .disabled(p.decks.isEmpty)
            }

            Section("EDHREC") {
                if let e = edhrec {
                    if let n = e.numDecks { Text(verbatim: "In \(n.formatted()) decks" + (e.inclusionPct.map { String(format: " (%.1f%%)", $0) } ?? "")) }
                    if let r = card.edhrecRank { Text("Rank #\(r)") }
                    if !e.topCommanders.isEmpty {
                        DisclosureGroup("Top commanders") { ForEach(e.topCommanders, id: \.self) { Link($0, destination: EDHREC.commanderURL($0)) } }
                    }
                    if !e.synergies.isEmpty {
                        DisclosureGroup("High-synergy cards") { ForEach(e.synergies, id: \.self) { Text($0) } }
                    }
                } else if edhrecLoaded {
                    if let r = card.edhrecRank { Text("EDHREC rank #\(r)") }
                    Link("Open on EDHREC", destination: EDHREC.cardURL(card.name))
                } else {
                    ProgressView()
                }
            }

            Section("Printings") {
                if let printings {
                    ForEach(printings) { pr in
                        NavigationLink { CardDetailView(cardId: pr.id) } label: {
                            HStack {
                                Text("\(pr.setName) #\(pr.collectorNumber)").lineLimit(1)
                                Spacer()
                                Text(pr.prices.usd.usd).monospacedDigit()
                            }
                        }
                    }
                } else {
                    Button("Load all printings") {
                        Task { if let ps = try? await Scryfall.shared.prints(card) { printings = ps; store.cache(ps) } }
                    }
                }
            }
        }
    }

    @ViewBuilder private func links(_ card: CardSummary) -> some View {
        HStack {
            if let u = card.tcgplayerUrl.flatMap(URL.init(string:)) { Link("TCGplayer", destination: u) }
            Spacer()
            Link("EDHREC", destination: card.edhrecUrl.flatMap(URL.init(string:)) ?? EDHREC.cardURL(card.name))
            Spacer()
            if let u = card.scryfallUrl.flatMap(URL.init(string:)) { Link("Scryfall", destination: u) }
            Spacer()
            if let u = URL(string: "https://moxfield.com/search?q=" + (("!\"\(card.name)\"").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")) {
                Link("Moxfield", destination: u)
            }
        }
        .font(.footnote)
        .buttonStyle(.borderless)
    }

    private func addToCollection(_ card: CardSummary) {
        let paidVal = Double(paid)
        store.mutate { p in
            if let i = p.collection.firstIndex(where: { $0.cardId == card.id && $0.finish == finish && $0.condition == condition && $0.binder == binder && $0.language == "en" && $0.purchasePrice == paidVal }) {
                p.collection[i].quantity += qty
            } else {
                p.collection.append(CollectionItem(cardId: card.id, name: card.name, set: card.set, collectorNumber: card.collectorNumber, finish: finish,
                                                   condition: condition, quantity: qty, purchasePrice: paidVal, purchaseDate: paidVal != nil ? dayString() : nil, binder: binder))
            }
            p = Snapshot.apply(p, fresh: [card])
        }
        flash("Added \(qty)× \(card.name)")
        paid = ""
    }
}

@MainActor
struct ForecastView: View {
    let fc: Forecast
    @Binding var horizon: Int

    var body: some View {
        Picker("Horizon", selection: $horizon) { Text("7 days").tag(7); Text("30 days").tag(30) }.pickerStyle(.segmented)
        HStack(alignment: .firstTextBaseline) {
            Text(fc.direction == .up ? "▲ Likely up" : fc.direction == .down ? "▼ Likely down" : "◆ Likely flat")
                .font(.title2.bold())
                .foregroundStyle(fc.direction == .up ? Theme.up : fc.direction == .down ? Theme.down : Color.primary)
            Spacer()
            Text("\(fc.confidenceLabel) confidence").font(.caption).padding(4).background(.quaternary, in: Capsule())
        }
        Text("\(fc.expectedPct.signedPct) → about **\((fc.price * (1 + fc.expectedPct / 100)).usd)**")
        RangeBar(low: fc.lowPct, mid: fc.expectedPct, high: fc.highPct).frame(height: 14)
        Text("80% range \(fc.lowPct.signedPct) to \(fc.highPct.signedPct). Reprint risk \(Int(fc.reprintRisk * 100))%. \(fc.historyPoints) day\(fc.historyPoints == 1 ? "" : "s") of local history.")
            .font(.caption).foregroundStyle(.secondary)
        ForEach(fc.factors) { f in
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(f.label).bold()
                    Spacer()
                    Text("\(f.impactPct.signedPct)/30d").monospacedDigit()
                        .foregroundStyle(f.impactPct > 0 ? Theme.up : f.impactPct < 0 ? Theme.down : Color.secondary)
                }
                Text(f.detail).font(.caption).foregroundStyle(.secondary)
            }
        }
        Text("Statistical estimate, not financial advice.").font(.caption2).foregroundStyle(.secondary)
    }
}

@MainActor
struct RangeBar: View {
    let low: Double, mid: Double, high: Double
    var body: some View {
        GeometryReader { g in
            let span = max(abs(min(low, -1)), abs(max(high, 1)))
            let x: (Double) -> CGFloat = { g.size.width * CGFloat(0.5 + $0 / span * 0.5) }
            ZStack(alignment: .leading) {
                Capsule().fill(.quaternary)
                Capsule().fill(Theme.accent.opacity(0.4)).frame(width: max(2, x(high) - x(low))).offset(x: x(low))
                Rectangle().fill(.secondary).frame(width: 1).offset(x: x(0))
                Capsule().fill(Theme.accent).frame(width: 3).offset(x: x(mid) - 1.5)
            }
        }
    }
}
