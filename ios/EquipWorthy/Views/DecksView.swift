import SwiftUI
import Charts
import EquipWorthyKit

@MainActor
struct DecksView: View {
    @EnvironmentObject var store: ProfileStore
    @State private var showNew = false

    var body: some View {
        let p = store.profile
        List {
            if p.decks.isEmpty {
                ContentUnavailableView("No decks yet", systemImage: "rectangle.stack", description: Text("Create a deck or import one from Moxfield or a pasted list."))
            }
            ForEach(p.decks) { d in
                NavigationLink { DeckDetailView(deckId: d.id) } label: {
                    let miss = DeckStats.missing(d, profile: p)
                    let cost = miss.reduce(0) { $0 + (p.price($1.card.cardId, .nonfoil) ?? 0) * Double($1.missing) }
                    VStack(alignment: .leading) {
                        Text(d.name).bold()
                        HStack {
                            Text("\(d.format.rawValue) · \(d.cards.filter { $0.board != .maybe }.reduce(0) { $0 + $1.quantity }) cards")
                            Spacer()
                            Text(DeckStats.value(d, profile: p).usd)
                        }
                        .font(.caption).foregroundStyle(.secondary)
                        Text(miss.isEmpty ? "You own every card" : "To finish: \(cost.usd)").font(.caption).foregroundStyle(miss.isEmpty ? Theme.up : Color.secondary)
                    }
                }
            }
            .onDelete { idx in
                let ids = Set(idx.map { p.decks[$0].id })
                store.mutate { $0.decks.removeAll { ids.contains($0.id) } }
            }
        }
        .navigationTitle("Decks")
        .saveToolbar()
        .toolbar { ToolbarItem(placement: .topBarLeading) { Button { showNew = true } label: { Image(systemName: "plus") }.accessibilityLabel("New deck") } }
        .sheet(isPresented: $showNew) { NewDeckSheet() }
    }
}

@MainActor
struct NewDeckSheet: View {
    @EnvironmentObject var store: ProfileStore
    @Environment(\.dismiss) var dismiss
    @State private var name = ""
    @State private var format = Format.commander
    @State private var importText = ""
    @State private var busy: String?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("New deck") {
                    TextField("Name", text: $name)
                    Picker("Format", selection: $format) { ForEach(Format.allCases) { Text($0.rawValue.capitalized).tag($0) } }
                    Button("Create empty deck") {
                        store.mutate { $0.decks.append(Deck(name: name.isEmpty ? "Untitled deck" : name, format: format)) }
                        dismiss()
                    }
                }
                Section {
                    TextEditor(text: $importText).frame(minHeight: 140).font(.system(.footnote, design: .monospaced))
                        .autocorrectionDisabled().textInputAutocapitalization(.never)
                    Button(busy ?? "Import") { Task { await importDeck() } }.disabled(busy != nil || importText.isEmpty)
                    if let error { Text(error).font(.footnote).foregroundStyle(.red) }
                } header: {
                    Text("Or import")
                } footer: {
                    Text("Paste a Moxfield deck URL or a decklist (Moxfield/Arena/MTGO export).")
                }
            }
            .navigationTitle("Add deck")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }

    private func importDeck() async {
        error = nil
        var lines: [BatchLine]
        var deckName = name.isEmpty ? "Imported deck" : name
        var fmt = format
        var source: String?
        let txt = importText.trimmingCharacters(in: .whitespacesAndNewlines)
        if Moxfield.deckId(from: txt) != nil {
            busy = "Fetching from Moxfield…"
            do {
                let d = try await Moxfield.fetchDeck(txt)
                lines = d.lines
                if name.isEmpty { deckName = d.name }
                fmt = Format(rawValue: d.format) ?? format
                source = txt
            } catch {
                busy = nil
                self.error = "Couldn't load from Moxfield (\(error.localizedDescription)). On Moxfield use Export → Copy plain text and paste it here."
                return
            }
        } else {
            lines = BatchParser.parseList(txt)
        }
        busy = "Matching \(lines.count) cards…"
        defer { busy = nil }
        do {
            let resolved = try await Resolver.resolve(lines)
            var deck = Deck(name: deckName, format: fmt, source: source)
            for r in resolved {
                guard let c = r.card else { continue }
                let board = r.line.board ?? .main
                if let i = deck.cards.firstIndex(where: { $0.cardId == c.id && $0.board == board }) { deck.cards[i].quantity += r.line.quantity }
                else { deck.cards.append(DeckCard(cardId: c.id, name: c.name, quantity: r.line.quantity, board: board)) }
            }
            let fresh = resolved.compactMap(\.card)
            store.mutate { p in
                p.decks.append(deck)
                p = Snapshot.apply(p, fresh: fresh)
            }
            let missing = resolved.filter { $0.card == nil }.map(\.line.name)
            if missing.isEmpty { dismiss() } else { error = "Imported. Couldn't find: \(missing.joined(separator: ", "))" }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

@MainActor
struct DeckDetailView: View {
    let deckId: String
    @EnvironmentObject var store: ProfileStore
    @State private var board = Board.main
    @State private var hand: [String] = []
    @State private var library: [String] = []
    @State private var copies = 4
    @State private var turn = 3
    @State private var atLeast = 1
    @State private var onPlay = true

    var body: some View {
        if let deck = store.profile.decks.first(where: { $0.id == deckId }) { content(deck) } else { Text("Deck deleted").foregroundStyle(.secondary) }
    }

    private func setDeck(_ change: (inout Deck) -> Void) {
        store.mutate { p in
            guard let i = p.decks.firstIndex(where: { $0.id == deckId }) else { return }
            change(&p.decks[i])
            p.decks[i].updatedAt = isoNow()
        }
    }

    @ViewBuilder private func content(_ deck: Deck) -> some View {
        let p = store.profile
        let issues = DeckStats.legality(deck, cards: p.cardCache)
        let missing = DeckStats.missing(deck, profile: p)
        let missingCost = missing.reduce(0) { $0 + (p.price($1.card.cardId, .nonfoil) ?? 0) * Double($1.missing) }
        let mainCount = deck.cards.filter { $0.board == .main || $0.board == .commander }.reduce(0) { $0 + $1.quantity }
        List {
            Section {
                TextField("Name", text: Binding(get: { deck.name }, set: { v in setDeck { $0.name = v } }))
                Picker("Format", selection: Binding(get: { deck.format }, set: { v in setDeck { $0.format = v } })) { ForEach(Format.allCases) { Text($0.rawValue.capitalized).tag($0) } }
                LabeledContent("Value", value: DeckStats.value(deck, profile: p).usd)
                LabeledContent("Cost to finish", value: missing.isEmpty ? "Owned" : missingCost.usd)
                LabeledContent("Legality", value: issues.isEmpty ? "Legal" : "\(issues.count) issue\(issues.count == 1 ? "" : "s")")
                if let cmd = deck.cards.first(where: { $0.board == .commander }) { Link("EDHREC: \(cmd.name)", destination: EDHREC.commanderURL(cmd.name)) }
                if let s = deck.source, let u = URL(string: s) { Link("Moxfield source", destination: u) }
                ShareLink(item: DeckStats.text(deck)) { Label("Share decklist", systemImage: "square.and.arrow.up") }
            }

            Section("Add cards") {
                Picker("Board", selection: $board) { ForEach(Board.allCases) { Text($0.label).tag($0) } }
                CardSearchField(prompt: "Add a card…") { c in
                    setDeck { d in
                        if let i = d.cards.firstIndex(where: { $0.cardId == c.id && $0.board == board }) { d.cards[i].quantity += 1 }
                        else { d.cards.append(DeckCard(cardId: c.id, name: c.name, quantity: 1, board: board)) }
                    }
                    store.mutate { $0 = Snapshot.apply($0, fresh: [c]) }
                }
            }

            ForEach(Board.allCases) { b in
                let cards = deck.cards.filter { $0.board == b }
                if !cards.isEmpty {
                    Section("\(b.label) (\(cards.reduce(0) { $0 + $1.quantity }))") {
                        ForEach(cards.sorted { (p.card($0.cardId)?.cmc ?? 0, $0.name) < (p.card($1.cardId)?.cmc ?? 0, $1.name) }, id: \.cardId) { c in
                            HStack {
                                Stepper("\(c.quantity)", value: Binding(get: { c.quantity }, set: { v in setDeck { d in
                                    if let i = d.cards.firstIndex(where: { $0.cardId == c.cardId && $0.board == c.board }) {
                                        if v <= 0 { d.cards.remove(at: i) } else { d.cards[i].quantity = v }
                                    }
                                } }), in: 0...99).fixedSize().labelsHidden()
                                Text("\(c.quantity)").monospacedDigit()
                                NavigationLink { CardDetailView(cardId: c.cardId) } label: {
                                    VStack(alignment: .leading) {
                                        Text(c.name).lineLimit(1)
                                        HStack(spacing: 4) {
                                            if missing.contains(where: { $0.card.name == c.name }) { Text("need").font(.caption2).foregroundStyle(Theme.down) }
                                            Text(p.price(c.cardId, .nonfoil).usd).font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if !issues.isEmpty {
                Section("Legality issues") { ForEach(issues.prefix(30), id: \.self) { Text($0).font(.footnote) } }
            }

            Section("Mana curve") {
                let curve = DeckStats.manaCurve(deck, cards: p.cardCache)
                Chart(Array(curve.enumerated()), id: \.offset) { i, v in
                    BarMark(x: .value("CMC", i == 7 ? "7+" : "\(i)"), y: .value("Cards", v))
                        .foregroundStyle(Theme.accent)
                        .cornerRadius(4)
                        .annotation(position: .top) { if v > 0 { Text("\(v)").font(.caption2) } }
                }
                .frame(height: 150)
                ForEach(DeckStats.colorCounts(deck, cards: p.cardCache), id: \.0) { LabeledContent(colorName($0.0), value: "\($0.1)") }
                ForEach(DeckStats.typeCounts(deck, cards: p.cardCache), id: \.0) { LabeledContent($0.0, value: "\($0.1)") }
            }

            Section("Sample hand") {
                HStack {
                    Button("New 7") { draw(deck, 7) }
                    Button("Mulligan") { draw(deck, max(1, hand.count - 1)) }.disabled(hand.isEmpty)
                    Button("Draw") { if library.count > hand.count { hand = Array(library.prefix(hand.count + 1)) } }.disabled(hand.isEmpty)
                }
                .buttonStyle(.bordered)
                ScrollView(.horizontal) {
                    HStack { ForEach(Array(hand.enumerated()), id: \.offset) { CardImage(url: p.card($0.element)?.imageSmall, width: 90) } }
                }
            }

            Section("Draw odds") {
                Stepper("Copies in deck: \(copies)", value: $copies, in: 0...99)
                Stepper("By turn: \(turn)", value: $turn, in: 1...20)
                Stepper("At least: \(atLeast)", value: $atLeast, in: 1...10)
                Toggle("On the play", isOn: $onPlay)
                let n = max(1, mainCount - deck.cards.filter { $0.board == .commander }.reduce(0) { $0 + $1.quantity })
                let draws = min(n, 7 + turn - (onPlay ? 1 : 0))
                let prob = DeckStats.atLeast(N: n, K: min(copies, n), n: draws, k: atLeast)
                LabeledContent("Chance", value: String(format: "%.1f%%", prob * 100)).bold()
            }

            if !missing.isEmpty {
                Section("Shopping list · \(missingCost.usd)") {
                    ForEach(missing, id: \.card.name) { m in
                        HStack { Text("\(m.missing)× \(m.card.name)"); Spacer(); Text(((p.price(m.card.cardId, .nonfoil) ?? 0) * Double(m.missing)).usd) }
                    }
                    Button("Add all to wishlist") {
                        store.mutate { pr in
                            for m in missing where !pr.wishlist.contains(where: { $0.cardId == m.card.cardId }) {
                                pr.wishlist.append(WishItem(cardId: m.card.cardId, name: m.card.name, finish: .nonfoil, quantity: m.missing))
                            }
                        }
                    }
                    if let u = URL(string: "https://www.tcgplayer.com/massentry?productline=Magic&c=" + (missing.map { "\($0.missing) \($0.card.name)" }.joined(separator: "||").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")) {
                        Link("Buy on TCGplayer", destination: u)
                    }
                }
            }

            Section("Notes") {
                TextEditor(text: Binding(get: { deck.notes ?? "" }, set: { v in setDeck { $0.notes = v } })).frame(minHeight: 80)
            }
        }
        .navigationTitle(deck.name)
        .saveToolbar()
    }

    private func draw(_ deck: Deck, _ n: Int) {
        library = deck.cards.filter { $0.board == .main }.flatMap { Array(repeating: $0.cardId, count: $0.quantity) }.shuffled()
        hand = Array(library.prefix(n))
    }

    private func colorName(_ c: String) -> String {
        ["W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green", "C": "Colorless"][c] ?? c
    }
}
