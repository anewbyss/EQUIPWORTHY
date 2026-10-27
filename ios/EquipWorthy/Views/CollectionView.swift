import SwiftUI
import EquipWorthyKit

@MainActor
struct CollectionView: View {
    @EnvironmentObject var store: ProfileStore
    enum Tab: String, CaseIterable { case cards = "Cards", wishlist = "Wishlist", sets = "Sets" }
    @State private var tab = Tab.cards

    var body: some View {
        VStack(spacing: 0) {
            Picker("View", selection: $tab) { ForEach(Tab.allCases, id: \.self) { Text($0.rawValue) } }
                .pickerStyle(.segmented).padding(.horizontal).padding(.bottom, 6)
            switch tab {
            case .cards: CardsList()
            case .wishlist: WishlistList()
            case .sets: SetCompletionList()
            }
        }
        .navigationTitle("Collection")
        .saveToolbar()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                NavigationLink { BatchView() } label: { Image(systemName: "plus") }.accessibilityLabel("Add cards")
            }
        }
    }
}

@MainActor
private struct CardsList: View {
    @EnvironmentObject var store: ProfileStore
    @State private var search = ""
    @State private var binder = ""
    @State private var finish: Finish?
    @State private var sort = "total"
    @State private var selection = Set<String>()
    @State private var editMode = EditMode.inactive
    @State private var newBinder = ""
    @State private var export: ExportFile?

    private func price(_ c: CollectionItem) -> Double { store.profile.price(c.cardId, c.finish) ?? 0 }

    var rows: [CollectionItem] {
        let p = store.profile
        let q = search.lowercased()
        var r = p.collection.filter { c in
            (q.isEmpty || c.name.lowercased().contains(q) || c.set.contains(q) || (p.card(c.cardId)?.typeLine.lowercased().contains(q) ?? false))
                && (binder.isEmpty || c.binder == binder) && (finish == nil || c.finish == finish)
        }
        switch sort {
        case "name": r.sort { $0.name < $1.name }
        case "price": r.sort { price($0) > price($1) }
        case "added": r.sort { $0.addedAt > $1.addedAt }
        default: r.sort { price($0) * Double($0.quantity) > price($1) * Double($1.quantity) }
        }
        return r
    }

    var body: some View {
        let p = store.profile
        let shown = rows
        let total = shown.reduce(0) { $0 + price($1) * Double($1.quantity) }
        let cash = storeValue(shown, pct: p.settings.buylistCashPct)
        let credit = storeValue(shown, pct: p.settings.buylistCreditPct)

        List(selection: $selection) {
            Section {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    StatTile(label: "Market", value: total.usd, sub: "\(shown.reduce(0) { $0 + $1.quantity }) cards")
                    StatTile(label: "Cash \(Int(p.settings.buylistCashPct))% / Credit \(Int(p.settings.buylistCreditPct))%", value: cash.usd, sub: "credit \(credit.usd)")
                }
                .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                PctSlider(label: "Store cash", value: Binding(get: { store.profile.settings.buylistCashPct }, set: { v in store.mutate { $0.settings.buylistCashPct = v } }))
                PctSlider(label: "Store credit", value: Binding(get: { store.profile.settings.buylistCreditPct }, set: { v in store.mutate { $0.settings.buylistCreditPct = v } }))
                Picker("Binder", selection: $binder) {
                    Text("All binders").tag("")
                    ForEach(p.binders, id: \.self) { Text($0).tag($0) }
                }
                Picker("Finish", selection: $finish) {
                    Text("All finishes").tag(Finish?.none)
                    ForEach(Finish.allCases) { Text($0.label).tag(Finish?.some($0)) }
                }
                Picker("Sort", selection: $sort) {
                    Text("Total value").tag("total"); Text("Price").tag("price"); Text("Name").tag("name"); Text("Recently added").tag("added")
                }
            }

            if editMode.isEditing && !selection.isEmpty {
                Section("\(selection.count) selected") {
                    Menu("Move to binder") { ForEach(p.binders, id: \.self) { b in Button(b) { bulk { $0.binder = b } } } }
                    Menu("Set condition") { ForEach(Condition.allCases) { c in Button(c.rawValue) { bulk { $0.condition = c } } } }
                    Button("Delete", role: .destructive) {
                        let sel = selection
                        store.mutate { $0.collection.removeAll { sel.contains($0.id) } }
                        selection = []
                    }
                }
            }

            Section {
                if shown.isEmpty { Text("No cards. Tap + to add cards in bulk, or use Scan.").foregroundStyle(.secondary) }
                ForEach(shown) { c in
                    NavigationLink { CollectionItemEditor(itemId: c.id) } label: { CollectionRow(item: c, card: p.card(c.cardId), price: price(c)) }
                        .tag(c.id)
                }
                .onDelete { idx in
                    let ids = Set(idx.map { shown[$0].id })
                    store.mutate { $0.collection.removeAll { ids.contains($0.id) } }
                }
            }

            Section("Binders") {
                ForEach(p.binders, id: \.self) { b in
                    LabeledContent(b, value: "\(p.collection.filter { $0.binder == b }.reduce(0) { $0 + $1.quantity })")
                }
                .onDelete { idx in
                    let names = idx.map { p.binders[$0] }.filter { $0 != "Main" }
                    store.mutate { pr in
                        pr.binders.removeAll { names.contains($0) }
                        for i in pr.collection.indices where names.contains(pr.collection[i].binder) { pr.collection[i].binder = "Main" }
                    }
                }
                HStack {
                    TextField("New binder", text: $newBinder)
                    Button("Add") {
                        let n = newBinder.trimmingCharacters(in: .whitespaces)
                        guard !n.isEmpty, !p.binders.contains(n) else { return }
                        store.mutate { $0.binders.append(n) }
                        newBinder = ""
                    }
                }
            }
        }
        .searchable(text: $search, prompt: "Filter name, set, type")
        .environment(\.editMode, $editMode)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { EditButton() }
            ToolbarItem(placement: .bottomBar) {
                Menu("Export") {
                    Button("EquipWorthy CSV") { export = ExportFile(share(CSVImport.equipWorthyCSV(shown, profile: p), filename: "equipworthy-collection.csv")) }
                    Button("Moxfield CSV") { export = ExportFile(share(CSVImport.moxfieldCSV(shown), filename: "equipworthy-moxfield.csv")) }
                    Button("TCGplayer mass entry") { export = ExportFile(share(shown.map { "\($0.quantity) \($0.name) [\($0.set.uppercased())]" }.joined(separator: "\n"), filename: "equipworthy-tcgplayer.txt")) }
                    Button("Text list") { export = ExportFile(share(shown.map { "\($0.quantity) \($0.name) (\($0.set.uppercased())) \($0.collectorNumber)\($0.finish == .foil ? " *F*" : $0.finish == .etched ? " *E*" : "")" }.joined(separator: "\n"), filename: "equipworthy-list.txt")) }
                }
            }
        }
        .sheet(item: $export) { f in ExportSheet(file: f) }
    }

    private func storeValue(_ items: [CollectionItem], pct: Double) -> Double {
        let settings = store.profile.settings
        var total = 0.0
        for c in items { total += Buylist.value(market: price(c), pct: pct, condition: c.condition, settings: settings) * Double(c.quantity) }
        return total
    }

    private func bulk(_ change: @escaping (inout CollectionItem) -> Void) {
        let sel = selection
        store.mutate { p in for i in p.collection.indices where sel.contains(p.collection[i].id) { change(&p.collection[i]) } }
    }
}

struct ExportFile: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
    init?(_ url: URL?) { guard let url else { return nil }; self.url = url }
}

@MainActor
struct ExportSheet: View {
    let file: ExportFile
    var body: some View {
        ShareLink(item: file.url) { Label("Share \(file.url.lastPathComponent)", systemImage: "square.and.arrow.up") }
            .presentationDetents([.height(140)])
    }
}

@MainActor
struct CollectionRow: View {
    let item: CollectionItem
    let card: CardSummary?
    let price: Double
    var body: some View {
        HStack {
            CardImage(url: card?.imageSmall, width: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).lineLimit(1)
                Text("\(item.set.uppercased()) #\(item.collectorNumber) · \(item.finish.label) · \(item.condition.rawValue) · \(item.binder)")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text((price * Double(item.quantity)).usd).monospacedDigit()
                Text("×\(item.quantity) @ \(price.usd)").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

@MainActor
struct CollectionItemEditor: View {
    let itemId: String
    @EnvironmentObject var store: ProfileStore

    var body: some View {
        if let item = store.profile.collection.first(where: { $0.id == itemId }) {
            let card = store.profile.card(item.cardId)
            Form {
                Section {
                    HStack { CardImage(url: card?.image, width: 120); VStack(alignment: .leading) { Text(item.name).font(.headline); Text(store.profile.price(item.cardId, item.finish).usd).font(.title.bold()) } }
                    NavigationLink("Card details & forecast") { CardDetailView(cardId: item.cardId) }
                }
                Section {
                    Stepper("Quantity: \(item.quantity)", value: bind(\.quantity), in: 0...9999)
                    Picker("Finish", selection: bind(\.finish)) { ForEach(card?.finishes ?? Finish.allCases) { Text($0.label).tag($0) } }
                    Picker("Condition", selection: bind(\.condition)) { ForEach(Condition.allCases) { Text($0.rawValue).tag($0) } }
                    Picker("Binder", selection: bind(\.binder)) { ForEach(store.profile.binders, id: \.self) { Text($0).tag($0) } }
                    TextField("Language", text: bind(\.language))
                    TextField("Location (box, shelf…)", text: Binding(get: { item.location ?? "" }, set: { v in edit { $0.location = v.isEmpty ? nil : v } }))
                    TextField("Paid each $", text: Binding(get: { item.purchasePrice.map { String($0) } ?? "" }, set: { v in edit { $0.purchasePrice = Double(v) } }))
                        .keyboardType(.decimalPad)
                }
            }
            .navigationTitle(item.name)
            .saveToolbar()
        } else {
            Text("Removed").foregroundStyle(.secondary)
        }
    }

    private func edit(_ change: (inout CollectionItem) -> Void) {
        store.mutate { p in if let i = p.collection.firstIndex(where: { $0.id == itemId }) { change(&p.collection[i]) } }
    }

    private func bind<T>(_ kp: WritableKeyPath<CollectionItem, T>) -> Binding<T> {
        Binding(
            get: { store.profile.collection.first { $0.id == itemId }![keyPath: kp] },
            set: { v in edit { $0[keyPath: kp] = v } })
    }
}

@MainActor
private struct WishlistList: View {
    @EnvironmentObject var store: ProfileStore
    var body: some View {
        let p = store.profile
        List {
            Section {
                LabeledContent("Cost to buy everything", value: p.wishlist.reduce(0) { $0 + (p.price($1.cardId, $1.finish) ?? 0) * Double($1.quantity) }.usd)
            }
            ForEach(p.wishlist) { w in
                NavigationLink { CardDetailView(cardId: w.cardId) } label: {
                    HStack {
                        Text("\(w.quantity)× \(w.name)")
                        Spacer()
                        Text(p.price(w.cardId, w.finish).usd).monospacedDigit()
                    }
                }
            }
            .onDelete { idx in
                let ids = Set(idx.map { p.wishlist[$0].id })
                store.mutate { $0.wishlist.removeAll { ids.contains($0.id) } }
            }
        }
    }
}

@MainActor
private struct SetCompletionList: View {
    @EnvironmentObject var store: ProfileStore
    @State private var sets: [SetInfo] = []

    struct Row { let code: String; let have: Int; let info: SetInfo? }

    var rows: [Row] {
        var owned: [String: Set<String>] = [:]
        for c in store.profile.collection where c.quantity > 0 { owned[c.set, default: []].insert(c.collectorNumber) }
        return owned.map { kv in Row(code: kv.key, have: kv.value.count, info: sets.first { $0.code == kv.key }) }
            .sorted { Double($0.have) / Double($0.info?.card_count ?? 1) > Double($1.have) / Double($1.info?.card_count ?? 1) }
    }

    var body: some View {
        let rows = self.rows
        List(rows, id: \.code) { r in
            VStack(alignment: .leading) {
                HStack { Text(r.info?.name ?? r.code.uppercased()); Spacer(); Text("\(r.have)/\(r.info?.card_count ?? 0)").monospacedDigit() }
                ProgressView(value: Double(r.have), total: Double(max(r.have, r.info?.card_count ?? r.have)))
            }
        }
        .overlay { if rows.isEmpty { ContentUnavailableView("No cards yet", systemImage: "square.stack.3d.up", description: Text("Add cards to track set completion.")) } }
        .task { if sets.isEmpty { sets = (try? await Scryfall.shared.sets()) ?? [] } }
    }
}
