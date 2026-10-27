import Foundation
import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

/// Price refresh tool: one automatic update per day plus refresh on command.
/// A refresh updates your tracked cards, then (when due or forced) scans popular
/// Commander cards for market-wide fast movers and new-set synergy picks.
@MainActor
final class PriceRefresher: ObservableObject {
    @Published private(set) var running = false
    @Published private(set) var step: String?
    @Published var error: String?

    private weak var store: ProfileStore?
    private var timer: Timer?

    func attach(_ store: ProfileStore) {
        guard self.store == nil else { return }
        self.store = store
        timer = Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.checkDue() }
        }
        checkDue()
    }

    /// Run if prices or the market scan are due today.
    func checkDue() {
        guard let p = store?.profile, !running else { return }
        if Market.pricesDue(p) || Market.marketDue(p) { Task { await refreshAll() } }
    }

    func refreshAll(force: Bool = false) async {
        guard let store, !running else { return }
        running = true
        error = nil
        defer { running = false; step = nil }
        step = "Updating your cards…"
        if Snapshot.trackedIds(store.profile).isEmpty {
            store.mutate { $0.lastPriceRefresh = isoNow() }
        } else {
            await store.refreshPrices()
            if let e = store.lastError, e.hasPrefix("Price refresh failed") { error = e; return }
        }
        let p = store.profile
        guard p.settings.marketScan, force || Market.marketDue(p) else { return }
        do {
            let pages = max(1, Int((Double(p.settings.marketUniverse) / 175).rounded(.up)))
            var universe: [CardSummary] = []
            for page in 1...pages {
                step = "Scanning market (\(page)/\(pages))…"
                let r = try await Scryfall.shared.search("f:commander usd>=0.25 -is:digital", order: "edhrec", page: page)
                universe += r.cards
                if !r.hasMore { break }
            }
            step = "Checking new and upcoming sets…"
            let sets = Market.recentSets(try await Scryfall.shared.sets())
            var newCards: [CardSummary] = []
            if !sets.isEmpty {
                let q = "(" + sets.map { "e:\($0.code)" }.joined(separator: " or ") + ") not:reprint -t:basic"
                for page in 1...4 {
                    let r = try await Scryfall.shared.search(q, order: "set", page: page)
                    newCards += r.cards
                    if !r.hasMore { break }
                }
            }
            step = "Scoring synergies…"
            store.mutate { $0 = Market.applyScan($0, universe: universe, newCards: newCards, newSets: sets) }
            notifyMarket(store.profile)
        } catch {
            self.error = "Market scan failed: \(error.localizedDescription)"
        }
    }

    private func notifyMarket(_ p: Profile) {
        guard p.settings.notifications else { return }
        let market = (p.market?.movers ?? []).filter { !$0.tracked }
        guard !market.isEmpty else { return }
        let body = market.prefix(3).map(Market.moverText).joined(separator: "\n") + (market.count > 3 ? "\n+\(market.count - 3) more" : "")
        Notifier.post([PriceAlert(id: "market-\(dayString())", cardId: "", name: "Market", kind: .move, message: body, createdAt: isoNow(), read: true)],
                      title: "EquipWorthy market movers")
    }
}

/// Refresh control for every screen's toolbar.
@MainActor
struct RefreshButton: View {
    @EnvironmentObject var refresher: PriceRefresher
    @EnvironmentObject var store: ProfileStore

    var body: some View {
        Button {
            Task { await refresher.refreshAll(force: true) }
        } label: {
            if refresher.running { ProgressView() } else {
                Image(systemName: refresher.error != nil ? "exclamationmark.arrow.circlepath" : "arrow.clockwise")
                    .foregroundStyle(refresher.error != nil ? Theme.down : Theme.gold)
            }
        }
        .disabled(refresher.running)
        .accessibilityLabel(label)
    }

    private var label: String {
        if let e = refresher.error { return e }
        if let s = refresher.step { return s }
        guard let d = store.profile.lastPriceRefresh.flatMap(parseISO) else { return "Refresh prices" }
        return "Refresh prices. Last updated \(d.formatted(.relative(presentation: .named)))"
    }
}
