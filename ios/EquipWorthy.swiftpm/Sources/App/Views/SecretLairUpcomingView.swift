import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

/// Loading the Secret Lair catalog and reprint prices into the profile.
@MainActor
enum SecretLairData {
    static func loadCatalog(_ store: ProfileStore) async throws {
        var cards: [CardSummary] = []
        for page in 1...4 {
            let r = try await Scryfall.shared.search("e:sld", unique: "prints", order: "released", dir: "desc", page: page)
            cards += r.cards
            if !r.hasMore { break }
        }
        var slim: [String: CardSummary] = [:]
        for c in cards { var x = c; x.oracleText = nil; slim[c.id] = x }
        let groups = SecretLair.groupDrops(cards)
        store.mutate { p in
            p.secretLairCatalog = SecretLairCatalog(cards: slim, groups: groups, fetchedAt: isoNow(), reprints: p.secretLairCatalog?.reprints)
        }
    }

    static func catalogStale(_ store: ProfileStore) -> Bool {
        guard let t = store.profile.secretLairCatalog.flatMap({ parseISO($0.fetchedAt) }) else { return true }
        return Date().timeIntervalSince(t) > 3 * 86400
    }

    /// Fetch cheapest-elsewhere prices for cards not checked in the last two days.
    static func loadReprints(_ store: ProfileStore, cards: [CardSummary?], force: Bool = false) async throws {
        let known = store.profile.secretLairCatalog?.reprints ?? [:]
        let ids = force ? Array(Set(cards.compactMap { $0?.oracleId })) : SecretLair.staleReprintIds(cards, known: known)
        guard !ids.isEmpty else { return }
        let found = try await SecretLair.fetchReprints(ids)
        store.mutate { p in
            var cat = p.secretLairCatalog ?? SecretLairCatalog(cards: [:], groups: [], fetchedAt: isoNow(Date(timeIntervalSince1970: 0)))
            var all = cat.reprints ?? [:]
            for (k, v) in found { all[k] = v }
            cat.reprints = all
            p.secretLairCatalog = cat
        }
    }

    static func follow(_ store: ProfileStore, _ g: SecretLairGroup) {
        let cat = store.profile.secretLairCatalog
        store.cache(g.cardIds.compactMap { cat?.cards[$0] })
        guard !(store.profile.secretLair ?? []).contains(where: { $0.cardIds == g.cardIds }) else { return }
        var d = SecretLairDrop(name: g.name, cardIds: g.cardIds, marked: false)
        d.announcementUrl = g.announcementUrl
        store.mutate { $0.secretLair = [d] + ($0.secretLair ?? []) }
    }
}

/// Pre-drop price check: drop price vs Secret Lair market vs the cheapest copies in other sets.
@MainActor
struct PriceCompareView: View {
    @EnvironmentObject var store: ProfileStore
    let cardIds: [String]
    let cards: [String: CardSummary]
    var price: Double? = nil
    var foilPrice: Double? = nil
    var showTable = true
    @State private var foil = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        let reprints = store.profile.secretLairCatalog?.reprints ?? [:]
        let c = SecretLair.compare(cardIds, cards: cards, reprints: reprints, foil: foil, price: foil ? foilPrice : price)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Picker("Version", selection: $foil) {
                    Text("Non-foil").tag(false)
                    Text("Foil").tag(true)
                }
                .pickerStyle(.segmented).frame(maxWidth: 180)
                Spacer()
                Text(c.price.usd + (c.priceIsTypical ? " typical" : "")).font(.callout.bold())
            }
            Text(SecretLair.summary(c)).font(.callout)
            if showTable { table(c) }
            if busy { Text("Checking other printings…").font(.caption).foregroundStyle(.secondary) }
            if let error { Text(error).font(.caption).foregroundStyle(Theme.down) }
        }
        .task(id: cardIds) { if showTable { await fetch(force: false) } }
    }

    @ViewBuilder private func table(_ c: SecretLair.Comparison) -> some View {
        ForEach(c.rows) { r in
            HStack(alignment: .firstTextBaseline) {
                Text(r.name).font(.caption).lineLimit(1)
                Spacer()
                Text(r.sld.map { $0.usd } ?? "no price").font(.caption).foregroundStyle(r.sld == nil ? .secondary : .primary)
                Text(reprintText(r)).font(.caption).foregroundStyle(.secondary).frame(width: 110, alignment: .trailing)
            }
        }
        HStack {
            Text("Total").font(.caption.bold())
            Spacer()
            Text(c.sldPriced > 0 ? c.sldTotal.usd : "–").font(.caption.bold())
            Text(c.reprintPriced > 0 ? c.reprintTotal.usd + " elsewhere" : "–").font(.caption.bold()).frame(width: 110, alignment: .trailing)
        }
        Button("Re-check prices") { Task { await fetch(force: true) } }.font(.caption).disabled(busy)
    }

    private func reprintText(_ r: SecretLair.CompareRow) -> String {
        if r.isNew { return "new card" }
        guard let v = r.reprint else { return "–" }
        return v.usd + (r.reprintSet.map { " \($0.prefix(10))" } ?? "")
    }

    private func fetch(force: Bool) async {
        busy = true
        error = nil
        defer { busy = false }
        do { try await SecretLairData.loadReprints(store, cards: cardIds.map { cards[$0] }, force: force) }
        catch { self.error = error.localizedDescription }
    }
}

/// Announced drops that haven't been released yet, plus the last month's releases.
@MainActor
struct SecretLairUpcomingSection: View {
    @EnvironmentObject var store: ProfileStore
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        let cat = store.profile.secretLairCatalog
        let groups = cat.map { SecretLair.upcomingGroups($0.groups) } ?? []
        Section {
            Button(loading ? "Loading Secret Lair cards…" : "Reload") { Task { await load(force: true) } }.disabled(loading)
            if let error { Text(error).foregroundStyle(Theme.down).font(.caption) }
            if let cat, let t = SecretLair.pastDropTrend(cat) {
                Text("Past drops (2 months to 2 years old) are now worth a median \(Int((t.median * 100).rounded()))% of the usual \(SecretLair.typicalPrice.usd) price, across \(t.drops) drops.")
                    .font(.caption).foregroundStyle(t.median >= 1 ? Theme.up : Theme.down)
            }
        } footer: {
            Text("Drops show up here once their cards are previewed, with a link to the announcement. Prices use the usual \(SecretLair.typicalPrice.usd) (foil \(SecretLair.typicalFoilPrice.usd)) until you follow a drop and enter its real price.")
        }
        if let cat {
            if groups.isEmpty { Text("No announced or recent drops found.").foregroundStyle(.secondary) }
            ForEach(groups) { g in
                Section { UpcomingGroupRow(group: g, cat: cat) }
            }
        }
        Color.clear.frame(height: 0).listRowBackground(Color.clear)
            .task { await load(force: false) }
    }

    private func load(force: Bool) async {
        loading = true
        error = nil
        defer { loading = false }
        do {
            if force || SecretLairData.catalogStale(store) { try await SecretLairData.loadCatalog(store) }
            guard let cat = store.profile.secretLairCatalog else { return }
            let ids = SecretLair.upcomingGroups(cat.groups).flatMap(\.cardIds)
            try await SecretLairData.loadReprints(store, cards: ids.map { cat.cards[$0] })
        } catch {
            self.error = error.localizedDescription
        }
    }
}

@MainActor
struct UpcomingGroupRow: View {
    @EnvironmentObject var store: ProfileStore
    let group: SecretLairGroup
    let cat: SecretLairCatalog
    @State private var expanded = false

    var body: some View {
        let g = group
        let upcoming = SecretLair.isUpcoming(g)
        let followed = (store.profile.secretLair ?? []).contains { $0.cardIds == g.cardIds }
        VStack(alignment: .leading, spacing: 4) {
            Text(g.name).bold()
            Text(detailLine(g, upcoming: upcoming)).font(.caption).foregroundStyle(.secondary)
            ScrollView(.horizontal) {
                HStack { ForEach(g.cardIds, id: \.self) { id in CardImage(url: cat.cards[id]?.imageSmall, width: 50) } }
            }
        }
        if let u = SecretLair.announcementURL(g.announcementUrl) {
            Link(destination: u) { Label("Announcement", systemImage: "megaphone") }
        }
        Link(destination: SecretLair.scryfallURL(g, cards: cat.cards)) { Label("Cards on Scryfall", systemImage: "rectangle.stack") }
        if followed {
            Label("Following", systemImage: "checkmark.circle").foregroundStyle(Theme.up)
        } else {
            Button { SecretLairData.follow(store, g) } label: { Label("Follow", systemImage: "bell") }
        }
        PriceCompareView(cardIds: g.cardIds, cards: cat.cards, showTable: expanded)
        Button(expanded ? "Hide card prices" : "Compare card prices") { expanded.toggle() }.font(.callout)
    }

    private func detailLine(_ g: SecretLairGroup, upcoming: Bool) -> String {
        var parts: [String] = []
        if upcoming { parts.append("Upcoming") }
        if let a = g.announcedAt { parts.append("Announced \(a)" + (g.announcementSource.map { " by \($0)" } ?? "")) }
        parts.append((upcoming ? "Release " : "Released ") + g.releasedAt)
        parts.append("\(g.cardIds.count) card\(g.cardIds.count == 1 ? "" : "s")")
        return parts.joined(separator: " · ")
    }
}
