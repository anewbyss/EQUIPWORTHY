import SwiftUI
import UIKit
import UniformTypeIdentifiers
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

@MainActor
struct BatchView: View {
    @EnvironmentObject var store: ProfileStore
    enum Mode: String, CaseIterable { case list = "Paste list", grid = "Set grid", csv = "CSV" }
    @State private var mode = Mode.list
    @State private var text = ""
    @State private var setCode = ""
    @State private var busy: String?
    @State private var error: String?
    @State private var importing = false

    static let example = "4 Lightning Bolt\n1 Sol Ring (CMM) 410 *F*\n2 Counterspell LP @ 1.50\nRhystic Study"

    var body: some View {
        List {
            Section {
                Picker("Mode", selection: $mode) { ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) } }.pickerStyle(.segmented)
                switch mode {
                case .list:
                    Text("One card per line. Works with Moxfield, Arena and MTGO exports: `4x Name`, `(SET) 123`, `*F*`, `*E*`, `LP`, `@ 2.50`, section headers. Typos are fine.")
                        .font(.caption).foregroundStyle(.secondary)
                    TextEditor(text: $text).frame(minHeight: 160).font(.system(.footnote, design: .monospaced))
                        .autocorrectionDisabled().textInputAutocapitalization(.never)
                    HStack {
                        Button(busy ?? "Match cards") { Task { await ingest(BatchParser.parseList(text), .list) } }.bold().disabled(busy != nil || text.isEmpty)
                        Spacer()
                        Button("Example") { text = Self.example }
                        Button("Paste") { text = UIPasteboard.general.string ?? text }
                    }.buttonStyle(.borderless)
                case .grid:
                    Text("Pick a set, then type collector numbers: `12, 45f, 3x88, 101e, 200-205` (f = foil, e = etched).")
                        .font(.caption).foregroundStyle(.secondary)
                    TextField("Set code, e.g. DSK", text: $setCode).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    TextField("Collector numbers", text: $text, axis: .vertical).keyboardType(.numbersAndPunctuation).lineLimit(3...8)
                    Button(busy ?? "Match cards") { Task { await ingest(BatchParser.parseSetGrid(set: setCode, text), .grid) } }
                        .bold().disabled(busy != nil || setCode.isEmpty || text.isEmpty)
                case .csv:
                    Text("Import a CSV from Moxfield, ManaBox, Deckbox, Dragon Shield, TCGplayer, Delver Lens or EquipWorthy. Columns are detected automatically.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button(busy ?? "Choose CSV file…") { importing = true }.disabled(busy != nil)
                }
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
            }
            ReviewQueue()
        }
        .navigationTitle("Batch Entry")
        .saveToolbar()
        .fileImporter(isPresented: $importing, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            guard case .success(let url) = result else { return }
            let ok = url.startAccessingSecurityScopedResource()
            defer { if ok { url.stopAccessingSecurityScopedResource() } }
            guard let s = try? String(contentsOf: url, encoding: .utf8) else { error = "Couldn't read that file."; return }
            let r = CSVImport.toBatch(s)
            if let e = r.error { error = e; return }
            Task { await ingest(r.lines, .csv) }
        }
    }

    private func ingest(_ lines: [BatchLine], _ source: PendingRow.Source) async {
        guard !lines.isEmpty else { error = "Nothing to add. Check the format."; return }
        error = nil
        busy = "Matching \(lines.count) lines…"
        defer { busy = nil }
        do {
            let resolved = try await Resolver.resolve(lines)
            let cond = store.profile.settings.defaultCondition
            store.mutate { p in
                for r in resolved { if let c = r.card { p.cardCache[c.id] = c } }
                p.pendingBatch = (p.pendingBatch ?? []) + resolved.map { PendingRow(raw: $0.line.raw, status: $0.status, card: $0.card, line: $0.line, condition: cond, source: source) }
            }
            text = ""
        } catch {
            self.error = "Lookup failed: \(error.localizedDescription)"
        }
    }
}

/// Persisted review queue shared by batch entry and the scanner.
@MainActor
struct ReviewQueue: View {
    @EnvironmentObject var store: ProfileStore
    enum Dest: String, CaseIterable { case collection = "Collection", deck = "Deck", wishlist = "Wishlist", watchlist = "Watchlist" }
    @State private var dest = Dest.collection
    @State private var binder = "Main"
    @State private var deckId = ""
    @State private var done: String?

    var body: some View {
        let p = store.profile
        let rows = p.pendingBatch ?? []
        let matched = rows.filter { $0.cardId != nil }
        let value = matched.reduce(0) { $0 + (p.price($1.cardId!, $1.finish) ?? 0) * Double($1.quantity) }

        if let done { Section { Text(done).foregroundStyle(Theme.up) } }
        if !rows.isEmpty {
            Section {
                ForEach(rows) { r in PendingRowView(row: r) }
                    .onDelete { idx in
                        let keys = Set(idx.map { rows[$0].key })
                        store.mutate { $0.pendingBatch?.removeAll { keys.contains($0.key) } }
                    }
            } header: {
                HStack { Text("Review · \(matched.count) matched"); Spacer(); Text(value.usd) }
            } footer: {
                if rows.count > matched.count { Text("\(rows.count - matched.count) not found. Tap one to fix the name.") }
            }
            Section("Apply to all") {
                Menu("Condition") { ForEach(Condition.allCases) { c in Button(c.rawValue) { applyAll { $0.condition = c } } } }
                Menu("Finish") { ForEach(Finish.allCases) { f in Button(f.label) { applyAll { $0.finish = f } } } }
                Button("Clear queue", role: .destructive) { store.mutate { $0.pendingBatch = [] } }
            }
            Section("Add \(matched.count) entries to") {
                Picker("Destination", selection: $dest) { ForEach(Dest.allCases, id: \.self) { Text($0.rawValue) } }
                if dest == .collection {
                    Picker("Binder", selection: $binder) { ForEach(p.binders, id: \.self) { Text($0).tag($0) } }
                }
                if dest == .deck {
                    Picker("Deck", selection: $deckId) {
                        Text("+ New deck").tag("")
                        ForEach(p.decks) { Text($0.name).tag($0.id) }
                    }
                }
                Button("Add to \(dest.rawValue)") { commit(Set(matched.map(\.key))) }.bold().disabled(matched.isEmpty)
            }
        }
    }

    private func applyAll(_ change: @escaping (inout PendingRow) -> Void) {
        store.mutate { p in
            guard var rows = p.pendingBatch else { return }
            for i in rows.indices { change(&rows[i]) }
            p.pendingBatch = rows
        }
    }

    private func commit(_ keys: Set<String>) {
        let n = (store.profile.pendingBatch ?? []).filter { keys.contains($0.key) }.reduce(0) { $0 + $1.quantity }
        let dest = self.dest, binder = self.binder
        var deckId = self.deckId
        store.mutate { p in
            let rows = (p.pendingBatch ?? []).filter { keys.contains($0.key) && $0.cardId != nil }
            switch dest {
            case .collection:
                p = Snapshot.commitToCollection(p, keys: keys, binder: binder)
                return
            case .wishlist:
                p.wishlist += rows.map { WishItem(cardId: $0.cardId!, name: $0.name, finish: $0.finish, quantity: $0.quantity) }
            case .watchlist:
                for r in rows where !p.watchlist.contains(where: { $0.cardId == r.cardId && $0.finish == r.finish }) {
                    p.watchlist.append(WatchItem(cardId: r.cardId!, name: r.name, finish: r.finish))
                }
            case .deck:
                if deckId.isEmpty {
                    let d = Deck(name: "Batch import \(dayString())", format: .commander)
                    p.decks.append(d)
                    deckId = d.id
                }
                if let i = p.decks.firstIndex(where: { $0.id == deckId }) {
                    for r in rows {
                        let board = r.board ?? .main
                        if let j = p.decks[i].cards.firstIndex(where: { $0.cardId == r.cardId && $0.board == board }) { p.decks[i].cards[j].quantity += r.quantity }
                        else { p.decks[i].cards.append(DeckCard(cardId: r.cardId!, name: r.name, quantity: r.quantity, board: board)) }
                    }
                    p.decks[i].updatedAt = isoNow()
                }
            }
            p.pendingBatch = (p.pendingBatch ?? []).filter { !keys.contains($0.key) || $0.cardId == nil }
            p = Snapshot.apply(p, fresh: rows.compactMap { p.cardCache[$0.cardId!] })
        }
        done = "Added \(n) cards to \(dest == .collection ? binder : dest.rawValue)."
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}

@MainActor
struct PendingRowView: View {
    let row: PendingRow
    @EnvironmentObject var store: ProfileStore
    @State private var fixing = false
    @State private var fixName = ""
    @State private var printings: [CardSummary] = []

    var body: some View {
        let card = row.cardId.flatMap { store.profile.card($0) }
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                CardImage(url: card?.imageSmall, width: 34)
                VStack(alignment: .leading) {
                    HStack(spacing: 4) {
                        Text(row.cardId == nil ? (row.name.isEmpty ? row.raw : row.name) : row.name).lineLimit(1)
                        if row.status == .fuzzy { Text("check").font(.caption2).padding(.horizontal, 4).background(.yellow.opacity(0.3), in: Capsule()) }
                        if row.status == .notfound && row.cardId == nil { Text("not found").font(.caption2).padding(.horizontal, 4).background(.red.opacity(0.3), in: Capsule()) }
                    }
                    if let card {
                        Menu("\(card.set.uppercased()) #\(card.collectorNumber) · \(row.finish.label) · \(row.condition.rawValue)") {
                            if printings.isEmpty { Button("Load printings…") { Task { printings = (try? await Scryfall.shared.prints(card)) ?? []; store.cache(printings) } } }
                            ForEach(printings) { pr in Button("\(pr.setName) #\(pr.collectorNumber) · \(pr.prices.usd.usd)") { edit { $0.cardId = pr.id; $0.set = pr.set; $0.collectorNumber = pr.collectorNumber } } }
                            Divider()
                            ForEach(card.finishes) { f in Button(f.label) { edit { $0.finish = f } } }
                            Divider()
                            ForEach(Condition.allCases) { c in Button(c.rawValue) { edit { $0.condition = c } } }
                        }
                        .font(.caption)
                    }
                }
                Spacer()
                Stepper("\(row.quantity)", value: Binding(get: { row.quantity }, set: { v in edit { $0.quantity = max(1, v) } }), in: 1...999).fixedSize()
            }
            if row.cardId == nil {
                HStack {
                    TextField("Fix name", text: $fixName).textFieldStyle(.roundedBorder).onAppear { fixName = row.name.isEmpty ? row.raw : row.name }
                    Button("Find") {
                        Task {
                            if let c = try? await Scryfall.shared.named(fixName) {
                                store.cache([c])
                                edit { $0.cardId = c.id; $0.name = c.name; $0.set = c.set; $0.collectorNumber = c.collectorNumber; $0.status = .fuzzy }
                            }
                        }
                    }
                }
            }
        }
    }

    private func edit(_ change: @escaping (inout PendingRow) -> Void) {
        let key = row.key
        store.mutate { p in
            guard var rows = p.pendingBatch, let i = rows.firstIndex(where: { $0.key == key }) else { return }
            change(&rows[i])
            p.pendingBatch = rows
        }
    }
}
