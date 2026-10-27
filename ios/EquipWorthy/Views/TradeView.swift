import SwiftUI
import EquipWorthyKit

/// Balance-beam illustration that tilts toward the heavier side.
@MainActor
struct TradeScale: View {
    let left: Double   // you give
    let right: Double  // you get

    var angle: Double {
        let total = left + right
        guard total > 0 else { return 0 }
        return max(-18, min(18, (right - left) / total * 40))
    }

    var body: some View {
        GeometryReader { g in
            let w = g.size.width, h = g.size.height
            let pivot = CGPoint(x: w / 2, y: h * 0.25)
            let half = w * 0.36
            let rad = angle * .pi / 180
            let lEnd = CGPoint(x: pivot.x - half * cos(rad), y: pivot.y - half * sin(rad))
            let rEnd = CGPoint(x: pivot.x + half * cos(rad), y: pivot.y + half * sin(rad))
            ZStack {
                Path { p in p.move(to: pivot); p.addLine(to: CGPoint(x: pivot.x, y: h * 0.9)) }.stroke(.primary, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                Capsule().fill(.primary).frame(width: w * 0.2, height: 12).position(x: w / 2, y: h * 0.9)
                Path { p in p.move(to: lEnd); p.addLine(to: rEnd) }.stroke(.primary, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                Circle().fill(Theme.accent).frame(width: 18).position(pivot)
                pan(at: lEnd, value: left, label: "You give", w: w)
                pan(at: rEnd, value: right, label: "You get", w: w)
            }
            .animation(.spring(response: 0.6, dampingFraction: 0.55), value: angle)
        }
        .accessibilityElement()
        .accessibilityLabel("Trade scale: you give \(left.usd), you get \(right.usd)")
    }

    private func pan(at p: CGPoint, value: Double, label: String, w: CGFloat) -> some View {
        let pw = w * 0.24
        return ZStack {
            Path { path in
                path.move(to: p); path.addLine(to: CGPoint(x: p.x - pw * 0.4, y: p.y + 60))
                path.move(to: p); path.addLine(to: CGPoint(x: p.x + pw * 0.4, y: p.y + 60))
            }
            .stroke(.secondary, lineWidth: 2)
            Path { path in
                path.move(to: CGPoint(x: p.x - pw / 2, y: p.y + 60))
                path.addQuadCurve(to: CGPoint(x: p.x + pw / 2, y: p.y + 60), control: CGPoint(x: p.x, y: p.y + 100))
                path.closeSubpath()
            }
            .fill(Theme.gold)
            VStack(spacing: 0) {
                Text(value.usd).font(.headline).monospacedDigit()
                Text(label).font(.caption2).foregroundStyle(.secondary)
            }
            .position(x: p.x, y: p.y + 108)
        }
    }
}

@MainActor
struct TradeView: View {
    @EnvironmentObject var store: ProfileStore
    @State private var tradeId: String?
    @State private var storeMode = false

    var body: some View {
        let p = store.profile
        Group {
            if let t = p.trades.first(where: { $0.id == (tradeId ?? p.trades.first?.id) }) {
                content(t)
            } else {
                ContentUnavailableView {
                    Label("No trades", systemImage: "scalemass")
                } description: {
                    Text("Put cards on each side and balance the trade.")
                } actions: {
                    Button("Start a trade") { newTrade() }.buttonStyle(.borderedProminent)
                }
            }
        }
        .navigationTitle("Trade Scale")
        .saveToolbar()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Button("New trade") { newTrade() }
                    ForEach(p.trades) { t in Button(t.name) { tradeId = t.id } }
                } label: { Image(systemName: "list.bullet") }
            }
        }
    }

    private func newTrade() {
        let t = Trade(name: "Trade \(dayString())")
        store.mutate { $0.trades.insert(t, at: 0) }
        tradeId = t.id
    }

    private func setTrade(_ id: String, _ change: (inout Trade) -> Void) {
        store.mutate { p in
            guard let i = p.trades.firstIndex(where: { $0.id == id }) else { return }
            change(&p.trades[i])
            p.trades[i].updatedAt = isoNow()
        }
    }

    private func total(_ cards: [TradeSideCard], _ cash: Double) -> Double { cards.reduce(cash) { $0 + $1.price * Double($1.quantity) } }

    struct Balance {
        let giveValued: Double
        let get: Double
        var diff: Double { get - giveValued }
        var fair: Bool {
            let m = max(giveValued, get)
            return m == 0 || abs(diff) / m <= 0.05
        }
        var message: String {
            if fair { return "⚖ Balanced (within 5%)" }
            let gap = abs(diff).usd
            return diff > 0 ? "You're getting \(gap) more. Add about that much to your side." : "You're giving \(gap) more. Ask for about that much more."
        }
    }

    struct Pick: Identifiable {
        let item: CollectionItem
        let price: Double
        var id: String { item.id }
    }

    private func balance(_ t: Trade) -> Balance {
        let give = total(t.mine, t.mineCash)
        let credit = store.profile.settings.buylistCreditPct
        let giveValued: Double = storeMode ? give * credit / 100 : give
        return Balance(giveValued: giveValued, get: total(t.theirs, t.theirsCash))
    }

    /// Trade Binder cards whose value comes closest to closing the gap.
    private func picks(_ t: Trade, gap: Double) -> [Pick] {
        let p = store.profile
        let used = Set(t.mine.map(\.cardId))
        var out: [Pick] = []
        for c in p.collection where c.binder == "Trade Binder" && !used.contains(c.cardId) {
            let v: Double = p.price(c.cardId, c.finish) ?? 0
            if v > 0 && v <= gap * 1.1 { out.append(Pick(item: c, price: v)) }
        }
        out.sort { abs(gap - $0.price) < abs(gap - $1.price) }
        return Array(out.prefix(5))
    }

    private func refreshPrices(_ t: Trade) {
        Task {
            let ids: [ScryfallIdentifier] = (t.mine + t.theirs).map { .id($0.cardId) }
            guard let fresh = try? await Scryfall.shared.collection(ids) else { return }
            store.cache(fresh)
            func fix(_ cs: [TradeSideCard]) -> [TradeSideCard] {
                cs.map { c in
                    var c = c
                    if let card = fresh.first(where: { $0.id == c.cardId }), let v = card.price(c.finish) { c.price = v }
                    return c
                }
            }
            setTrade(t.id) { $0.mine = fix($0.mine); $0.theirs = fix($0.theirs) }
        }
    }

    private var creditBinding: Binding<Double> {
        Binding(get: { store.profile.settings.buylistCreditPct }, set: { v in store.mutate { $0.settings.buylistCreditPct = v } })
    }

    private func content(_ t: Trade) -> some View {
        let b = balance(t)
        return List {
            scaleSection(b)
            side("You give", t, \.mine, \.mineCash)
            side("You get", t, \.theirs, \.theirsCash)
            suggestionSection(t, b)
            manageSection(t)
        }
    }

    @ViewBuilder private func scaleSection(_ b: Balance) -> some View {
        Section {
            TradeScale(left: b.giveValued, right: b.get).frame(height: 260)
            Text(b.message)
                .bold().frame(maxWidth: .infinity).multilineTextAlignment(.center)
                .foregroundStyle(b.fair ? Theme.up : Color.primary)
            Toggle("Trading in to a store (value my side at store credit)", isOn: $storeMode)
            if storeMode { PctSlider(label: "Store credit", value: creditBinding) }
        }
    }

    @ViewBuilder private func suggestionSection(_ t: Trade, _ b: Balance) -> some View {
        let list: [Pick] = (b.diff > 0 && !b.fair) ? picks(t, gap: b.diff) : []
        if !list.isEmpty {
            Section("Balance it from your Trade Binder") {
                ForEach(list) { pick in
                    Button {
                        let c = pick.item
                        setTrade(t.id) { $0.mine.append(TradeSideCard(cardId: c.cardId, name: c.name, finish: c.finish, price: pick.price)) }
                    } label: {
                        HStack { Text(pick.item.name); Spacer(); Text(pick.price.usd) }
                    }
                }
            }
        }
    }

    @ViewBuilder private func manageSection(_ t: Trade) -> some View {
        Section {
            TextField("Trade name", text: Binding(get: { t.name }, set: { v in setTrade(t.id) { $0.name = v } }))
            Button("Refresh prices") { refreshPrices(t) }
            Button("Delete trade", role: .destructive) {
                store.mutate { $0.trades.removeAll { $0.id == t.id } }
                tradeId = nil
            }
        }
    }

    @ViewBuilder private func side(_ title: String, _ t: Trade, _ cardsKP: WritableKeyPath<Trade, [TradeSideCard]>, _ cashKP: WritableKeyPath<Trade, Double>) -> some View {
        let cards = t[keyPath: cardsKP]
        Section {
            CardSearchField(prompt: "Add a card…") { c in
                let f: Finish = c.finishes.contains(.nonfoil) ? .nonfoil : (c.finishes.first ?? .nonfoil)
                setTrade(t.id) { $0[keyPath: cardsKP].append(TradeSideCard(cardId: c.id, name: c.name, finish: f, price: c.price(f) ?? 0)) }
            }
            ForEach(Array(cards.enumerated()), id: \.offset) { i, c in
                tradeRow(t, cardsKP, i, c)
            }
            .onDelete { idx in setTrade(t.id) { $0[keyPath: cardsKP].remove(atOffsets: idx) } }
            HStack {
                Text("Cash $")
                TextField("0", value: cashBinding(t, cashKP), format: .number).keyboardType(.decimalPad)
            }
        } header: {
            HStack { Text(title); Spacer(); Text(total(cards, t[keyPath: cashKP]).usd) }
        }
    }

    private func cashBinding(_ t: Trade, _ kp: WritableKeyPath<Trade, Double>) -> Binding<Double> {
        let id = t.id
        return Binding(get: { t[keyPath: kp] }, set: { v in setTrade(id) { $0[keyPath: kp] = v } })
    }

    private func edit(_ t: Trade, _ kp: WritableKeyPath<Trade, [TradeSideCard]>, _ i: Int, _ change: (inout TradeSideCard) -> Void) {
        setTrade(t.id) { tr in
            guard i < tr[keyPath: kp].count else { return }
            change(&tr[keyPath: kp][i])
        }
    }

    private func tradeRow(_ t: Trade, _ kp: WritableKeyPath<Trade, [TradeSideCard]>, _ i: Int, _ c: TradeSideCard) -> some View {
        let qty = Binding<Int>(get: { c.quantity }, set: { v in edit(t, kp, i) { $0.quantity = max(1, v) } })
        let price = Binding<Double>(get: { c.price }, set: { v in edit(t, kp, i) { $0.price = v } })
        let finishes: [Finish] = store.profile.card(c.cardId)?.finishes ?? [.nonfoil]
        return HStack {
            Stepper("\(c.quantity)×", value: qty, in: 1...99).fixedSize()
            VStack(alignment: .leading) {
                Text(c.name).lineLimit(1)
                Menu(c.finish.label) {
                    ForEach(finishes) { f in
                        Button(f.label) { setFinish(t, kp, i, c, f) }
                    }
                }
                .font(.caption)
            }
            Spacer()
            TextField("$", value: price, format: .number.precision(.fractionLength(2)))
                .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 70)
        }
    }

    private func setFinish(_ t: Trade, _ kp: WritableKeyPath<Trade, [TradeSideCard]>, _ i: Int, _ c: TradeSideCard, _ f: Finish) {
        let newPrice: Double = store.profile.price(c.cardId, f) ?? c.price
        edit(t, kp, i) { $0.finish = f; $0.price = newPrice }
    }
}
