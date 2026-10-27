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
            .fill(Theme.accent)
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

    @ViewBuilder private func content(_ t: Trade) -> some View {
        let p = store.profile
        let give = total(t.mine, t.mineCash)
        let giveValued = storeMode ? give * p.settings.buylistCreditPct / 100 : give
        let get = total(t.theirs, t.theirsCash)
        let diff = get - giveValued
        let fair = max(giveValued, get) == 0 || abs(diff) / max(giveValued, get) <= 0.05
        List {
            Section {
                TradeScale(left: giveValued, right: get).frame(height: 260)
                Text(fair ? "⚖ Balanced (within 5%)" : diff > 0 ? "You're getting \(abs(diff).usd) more. Add about that much to your side." : "You're giving \(abs(diff).usd) more. Ask for about that much more.")
                    .bold().frame(maxWidth: .infinity).multilineTextAlignment(.center)
                    .foregroundStyle(fair ? Theme.up : Color.primary)
                Toggle("Trading in to a store (value my side at store credit)", isOn: $storeMode)
                if storeMode {
                    PctSlider(label: "Store credit", value: Binding(get: { store.profile.settings.buylistCreditPct }, set: { v in store.mutate { $0.settings.buylistCreditPct = v } }))
                }
            }
            side("You give", t, \.mine, \.mineCash)
            side("You get", t, \.theirs, \.theirsCash)

            if diff > 0 && !fair {
                let picks = p.collection
                    .filter { $0.binder == "Trade Binder" && !t.mine.map(\.cardId).contains($0.cardId) }
                    .map { ($0, p.price($0.cardId, $0.finish) ?? 0) }
                    .filter { $0.1 > 0 && $0.1 <= diff * 1.1 }
                    .sorted { abs(diff - $0.1) < abs(diff - $1.1) }
                    .prefix(5)
                if !picks.isEmpty {
                    Section("Balance it from your Trade Binder") {
                        ForEach(Array(picks), id: \.0.id) { item, v in
                            Button {
                                setTrade(t.id) { $0.mine.append(TradeSideCard(cardId: item.cardId, name: item.name, finish: item.finish, price: v)) }
                            } label: {
                                HStack { Text(item.name); Spacer(); Text(v.usd) }
                            }
                        }
                    }
                }
            }

            Section {
                TextField("Trade name", text: Binding(get: { t.name }, set: { v in setTrade(t.id) { $0.name = v } }))
                Button("Refresh prices") {
                    Task {
                        let ids = (t.mine + t.theirs).map { ScryfallIdentifier.id($0.cardId) }
                        guard let fresh = try? await Scryfall.shared.collection(ids) else { return }
                        store.cache(fresh)
                        let fix: ([TradeSideCard]) -> [TradeSideCard] = { cs in cs.map { c in var c = c; c.price = fresh.first { $0.id == c.cardId }?.price(c.finish) ?? c.price; return c } }
                        setTrade(t.id) { $0.mine = fix($0.mine); $0.theirs = fix($0.theirs) }
                    }
                }
                Button("Delete trade", role: .destructive) { store.mutate { $0.trades.removeAll { $0.id == t.id } }; tradeId = nil }
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
                HStack {
                    Stepper("\(c.quantity)×", value: Binding(get: { c.quantity }, set: { v in setTrade(t.id) { $0[keyPath: cardsKP][i].quantity = max(1, v) } }), in: 1...99).fixedSize()
                    VStack(alignment: .leading) {
                        Text(c.name).lineLimit(1)
                        Menu(c.finish.label) {
                            ForEach(store.profile.card(c.cardId)?.finishes ?? [.nonfoil]) { f in
                                Button(f.label) { setTrade(t.id) { $0[keyPath: cardsKP][i].finish = f; $0[keyPath: cardsKP][i].price = store.profile.price(c.cardId, f) ?? c.price } }
                            }
                        }
                        .font(.caption)
                    }
                    Spacer()
                    TextField("$", value: Binding(get: { c.price }, set: { v in setTrade(t.id) { $0[keyPath: cardsKP][i].price = v } }), format: .number.precision(.fractionLength(2)))
                        .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 70)
                }
            }
            .onDelete { idx in setTrade(t.id) { $0[keyPath: cardsKP].remove(atOffsets: idx) } }
            HStack {
                Text("Cash $")
                TextField("0", value: Binding(get: { t[keyPath: cashKP] }, set: { v in setTrade(t.id) { $0[keyPath: cashKP] = v } }), format: .number)
                    .keyboardType(.decimalPad)
            }
        } header: {
            HStack { Text(title); Spacer(); Text(total(cards, t[keyPath: cashKP]).usd) }
        }
    }
}
