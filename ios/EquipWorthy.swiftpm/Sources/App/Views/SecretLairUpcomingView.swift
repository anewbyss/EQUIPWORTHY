import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

/// Loading the Secret Lair catalog and reprint prices into the profile.
@MainActor
enum SecretLairData {
    /// Load drops from every source: Scryfall's Secret Lair sets and the EquipWorthy drop calendar.
    static func loadCatalog(_ store: ProfileStore) async throws {
        let prev = store.profile.secretLairCatalog
        let all = try await Scryfall.shared.sets()
        let sets = all.filter { SecretLair.isSecretLairSet(code: $0.code, name: $0.name, digital: $0.digital ?? false) }
            .map { SecretLairSet(code: $0.code, name: $0.name, releasedAt: $0.released_at) }
            .sorted { ($0.releasedAt ?? "") > ($1.releasedAt ?? "") }
            .prefix(25)
        let calendar = (try? await loadCalendar()) ?? prev?.calendar ?? []
        let query = "(" + (["sld"] + sets.map(\.code)).map { "e:\($0)" }.joined(separator: " or ") + ")"
        var cards: [CardSummary] = []
        for page in 1...5 {
            let r = try await Scryfall.shared.search(query, unique: "prints", order: "released", dir: "desc", page: page)
            cards += r.cards
            if !r.hasMore { break }
        }
        var slim: [String: CardSummary] = [:]
        for c in cards { var x = c; x.oracleText = nil; slim[c.id] = x }
        let groups = SecretLair.buildCatalogGroups(cards, sets: Array(sets), calendar: calendar)
        store.mutate { p in
            if let drops = p.secretLair, let attached = SecretLair.attachCards(drops, groups: groups) { p.secretLair = attached }
            p.secretLairCatalog = SecretLairCatalog(cards: slim, groups: groups, fetchedAt: isoNow(), reprints: p.secretLairCatalog?.reprints,
                                                    sets: Array(sets), calendar: calendar)
        }
    }

    static func loadCalendar() async throws -> [CalendarDrop] {
        var req = URLRequest(url: SecretLair.calendarURL)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, res) = try await URLSession.shared.data(for: req)
        guard (res as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return SecretLair.parseCalendar(data)
    }

    static func catalogStale(_ store: ProfileStore) -> Bool {
        guard let cat = store.profile.secretLairCatalog, cat.sets != nil, let t = parseISO(cat.fetchedAt) else { return true }
        return Date().timeIntervalSince(t) > 86400
    }

    /// Fetch cheapest-elsewhere prices for cards not checked in the last two days.
    static func loadReprints(_ store: ProfileStore, cards: [CardSummary?], force: Bool = false) async throws {
        let known = store.profile.secretLairCatalog?.reprints ?? [:]
        let ids = force ? Array(Set(cards.compactMap { $0?.oracleId })) : SecretLair.staleReprintIds(cards, known: known)
        guard !ids.isEmpty else { return }
        let slSets = ["sld"] + (store.profile.secretLairCatalog?.sets ?? []).map(\.code)
        let found = try await SecretLair.fetchReprints(ids, secretLairSets: slSets)
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
        guard !SecretLair.isFollowed(store.profile.secretLair ?? [], g) else { return }
        var d = SecretLairDrop(name: g.name, cardIds: g.cardIds, marked: g.saleStart != nil)
        d.announcementUrl = g.announcementUrl
        d.saleStart = g.saleStart
        d.price = g.price
        d.foilPrice = g.foilPrice
        d.url = g.url
        d.notes = g.notes
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
    @AppStorage("ew.sl-sort.upcoming") private var sort = SecretLair.GroupSort.soonest.rawValue

    private var sortBy: SecretLair.GroupSort { SecretLair.GroupSort(rawValue: sort) ?? .soonest }

    var body: some View {
        let cat = store.profile.secretLairCatalog
        let groups = cat.map { c in
            SecretLair.sortGroups(SecretLair.upcomingGroups(c.groups), by: sortBy, cards: c.cards, reprints: c.reprints ?? [:])
        } ?? []
        Section {
            Picker("Sort", selection: $sort) {
                ForEach(SecretLair.GroupSort.allCases, id: \.rawValue) { Text($0.rawValue).tag($0.rawValue) }
            }
            Button(loading ? "Loading Secret Lair cards…" : "Reload") { Task { await load(force: true) } }.disabled(loading)
            if let error { Text(error).foregroundStyle(Theme.down).font(.caption) }
            if let cat, let t = SecretLair.pastDropTrend(cat) {
                Text("Past drops (2 months to 2 years old) are now worth a median \(Int((t.median * 100).rounded()))% of the usual \(SecretLair.typicalPrice.usd) price, across \(t.drops) drops.")
                    .font(.caption).foregroundStyle(t.median >= 1 ? Theme.up : Theme.down)
            }
        } footer: {
            Text("Drops from Scryfall (every Secret Lair set, once cards are previewed) and the EquipWorthy drop calendar, which has sale times and prices for announced drops. Prices use the usual \(SecretLair.typicalPrice.usd) (foil \(SecretLair.typicalFoilPrice.usd)) until you follow a drop and enter its real price.")
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
        let followed = SecretLair.isFollowed(store.profile.secretLair ?? [], g)
        VStack(alignment: .leading, spacing: 4) {
            Text(g.name).bold()
            Text(detailLine(g, upcoming: upcoming)).font(.caption).foregroundStyle(.secondary)
            if let n = g.notes { Text(n).font(.caption) }
            Text("From " + (g.sources ?? ["scryfall"]).map { $0 == "calendar" ? "EquipWorthy calendar" : "Scryfall" }.joined(separator: " + "))
                .font(.caption2).foregroundStyle(.secondary)
            if !g.cardIds.isEmpty {
                ScrollView(.horizontal) {
                    HStack { ForEach(g.cardIds, id: \.self) { id in CardImage(url: cat.cards[id]?.imageSmall, width: 50) } }
                }
            }
        }
        if let u = SecretLair.announcementURL(g.announcementUrl) {
            Link(destination: u) { Label("Announcement", systemImage: "megaphone") }
        }
        if let u = SecretLair.announcementURL(g.url) {
            Link(destination: u) { Label("Product page", systemImage: "cart") }
        }
        if !g.cardIds.isEmpty {
            Link(destination: SecretLair.scryfallURL(g, cards: cat.cards)) { Label("Cards on Scryfall", systemImage: "rectangle.stack") }
        }
        if followed {
            Label("Following", systemImage: "checkmark.circle").foregroundStyle(Theme.up)
        } else {
            Button { SecretLairData.follow(store, g) } label: { Label(g.saleStart != nil ? "Follow & remind me" : "Follow", systemImage: "bell") }
        }
        if g.cardIds.isEmpty {
            Text("Cards aren't on Scryfall yet, so there's no price check. It appears here once they're listed.").font(.caption).foregroundStyle(.secondary)
        } else {
            PriceCompareView(cardIds: g.cardIds, cards: cat.cards, price: g.price, foilPrice: g.foilPrice, showTable: expanded)
            Button(expanded ? "Hide card prices" : "Compare card prices") { expanded.toggle() }.font(.callout)
        }
    }

    private func detailLine(_ g: SecretLairGroup, upcoming: Bool) -> String {
        var parts: [String] = []
        if upcoming { parts.append("Upcoming") }
        if g.tentative == true { parts.append("date not confirmed") }
        if let s = g.saleStart.flatMap(parseISO) {
            parts.append("On sale " + s.formatted(date: .abbreviated, time: .shortened))
        } else {
            parts.append((upcoming ? "Release " : "Released ") + g.releasedAt)
        }
        if let p = g.price { parts.append(p.usd) }
        let count = g.cardIds.isEmpty ? (g.cardCount ?? 0) : g.cardIds.count
        if count > 0 { parts.append("\(count) card\(count == 1 ? "" : "s")") }
        if let a = g.announcedAt { parts.append("Announced \(a)" + (g.announcementSource.map { " by \($0)" } ?? "")) }
        return parts.joined(separator: " · ")
    }
}
