import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

@MainActor
struct SetsView: View {
    @State private var sets: [SetInfo] = []
    @State private var all = false
    @State private var error: String?
    static let mainTypes: Set<String> = ["expansion", "core", "masters", "draft_innovation", "commander", "funny", "starter"]

    var body: some View {
        let today = dayString()
        let list = sets.filter { all || Self.mainTypes.contains($0.set_type) }
        let upcoming = list.filter { ($0.released_at ?? "") > today }.reversed()
        let released = list.filter { ($0.released_at ?? "") <= today }.prefix(all ? 500 : 80)
        List {
            Toggle("Show all set types", isOn: $all)
            if let error { Text(error).foregroundStyle(.red) }
            if !upcoming.isEmpty {
                Section("Upcoming & spoilers") { ForEach(Array(upcoming)) { row($0) } }
            }
            Section("Released") { ForEach(Array(released)) { row($0) } }
        }
        .overlay { if sets.isEmpty && error == nil { ProgressView() } }
        .navigationTitle("Sets & Spoilers")
        .saveToolbar()
        .task {
            do { sets = try await Scryfall.shared.sets() } catch { self.error = error.localizedDescription }
        }
    }

    private func row(_ s: SetInfo) -> some View {
        NavigationLink { SetCardsView(set: s) } label: {
            VStack(alignment: .leading) {
                Text(s.name)
                Text("\(s.code.uppercased()) · \(s.released_at ?? "TBA") · \(s.card_count) cards").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

@MainActor
struct SetCardsView: View {
    let set: SetInfo
    @EnvironmentObject var store: ProfileStore
    @State private var cards: [CardSummary] = []
    @State private var byPrice = false
    @State private var loading = true

    var body: some View {
        let shown = byPrice ? cards.sorted { ($0.prices.usd ?? $0.prices.usdFoil ?? 0) > ($1.prices.usd ?? $1.prices.usdFoil ?? 0) } : cards
        ScrollView {
            Picker("Sort", selection: $byPrice) { Text("Set order").tag(false); Text("Price").tag(true) }.pickerStyle(.segmented).padding(.horizontal)
            if loading { ProgressView().padding() }
            if !loading && cards.isEmpty { Text("No cards previewed yet.").foregroundStyle(.secondary).padding() }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 105), spacing: 8)], spacing: 8) {
                ForEach(shown) { c in
                    NavigationLink { CardDetailView(cardId: c.id) } label: {
                        VStack(spacing: 2) {
                            CardImage(url: c.imageSmall ?? c.image, width: 105)
                            HStack { Text("#\(c.collectorNumber)"); Spacer(); Text((c.prices.usd ?? c.prices.usdFoil).usd) }.font(.caption2)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal)
        }
        .navigationTitle(set.name)
        .saveToolbar()
        .task {
            var page = 1
            while page <= 6, let r = try? await Scryfall.shared.setCards(set.code, page: page) {
                cards += r.cards
                if !r.hasMore { break }
                page += 1
            }
            loading = false
            store.cache(cards)
        }
    }
}
