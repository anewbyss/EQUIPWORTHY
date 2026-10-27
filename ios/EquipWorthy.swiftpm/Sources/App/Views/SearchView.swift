import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

@MainActor
struct SearchView: View {
    @EnvironmentObject var store: ProfileStore
    @State private var query = ""
    @State private var order = "edhrec"
    @State private var results: [CardSummary] = []
    @State private var total = 0
    @State private var page = 1
    @State private var hasMore = false
    @State private var busy = false
    @State private var error: String?

    let presets: [(String, String)] = [
        ("Priciest Commander cards", "f:commander usd>=20"),
        ("Reserved List", "is:reserved"),
        ("Newest set", "s:latest"),
        ("Cheap staples", "f:commander usd<=2"),
    ]

    var body: some View {
        List {
            Section {
                TextField("Scryfall search, e.g. t:dragon c:r usd<5", text: $query)
                    .autocorrectionDisabled().textInputAutocapitalization(.never)
                    .onSubmit { Task { await run(page: 1) } }
                Picker("Sort", selection: $order) {
                    Text("EDHREC popularity").tag("edhrec"); Text("Price").tag("usd"); Text("Name").tag("name"); Text("Release date").tag("released")
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(presets, id: \.0) { p in
                            Button(p.0) { query = p.1; if p.1.contains("usd") || p.1 == "is:reserved" { order = "usd" }; Task { await run(page: 1) } }
                                .buttonStyle(.bordered).font(.caption)
                        }
                    }
                }
            }
            if let error { Text(error).foregroundStyle(.red) }
            if busy { ProgressView() }
            if !results.isEmpty {
                Section("\(total.formatted()) cards") {
                    ForEach(results) { c in
                        NavigationLink { CardDetailView(cardId: c.id) } label: {
                            HStack {
                                CardImage(url: c.imageSmall, width: 40)
                                VStack(alignment: .leading) {
                                    Text(c.name)
                                    Text("\(c.set.uppercased()) · \(c.typeLine)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Spacer()
                                Text((c.prices.usd ?? c.prices.usdFoil).usd).monospacedDigit()
                            }
                        }
                    }
                    if hasMore { Button("Load more") { Task { await run(page: page + 1) } } }
                }
            }
        }
        .navigationTitle("Search")
        .saveToolbar()
    }

    private func run(page: Int) async {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let r = try await Scryfall.shared.search(query, order: order, page: page)
            results = page == 1 ? r.cards : results + r.cards
            total = r.total; hasMore = r.hasMore; self.page = page
            store.cache(r.cards)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
