import Foundation
import SwiftUI
import UserNotifications
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
        if Market.pricesDue(p) || Market.marketDue(p) || Feed.due(p) { Task { await refreshAll() } }
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
        if p.settings.marketScan, force || Market.marketDue(p) { await scanMarket(p) }
        if force || Feed.due(store.profile) {
            step = "Checking all-cards market feed…"
            do { try await refreshFeed() } catch { if force { self.error = "Market feed: \(error.localizedDescription)" } }
        }
    }

    private func scanMarket(_ p: Profile) async {
        guard let store else { return }
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

    /// Download the daily all-cards feed and raise buy/sell signals for your cards.
    func refreshFeed() async throws {
        guard let store, store.profile.settings.marketFeed else { return }
        var req = URLRequest(url: Feed.url)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, res) = try await URLSession.shared.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        if code == 404 { throw Channels.ChannelError("The market feed hasn't been published yet") }
        guard code == 200, let feed = Feed.parse(data) else { throw Channels.ChannelError("The market feed couldn't be read") }
        var fresh: [PriceSignal] = []
        var digest: [FeedEntry] = []
        store.mutate { p in
            let r = Feed.apply(p, feed: feed)
            p = r.profile
            fresh = r.fresh
            digest = r.digest
        }
        await notifySignals(store.profile, fresh: fresh, digest: digest)
    }

    private func notifySignals(_ p: Profile, fresh: [PriceSignal], digest: [FeedEntry]) async {
        struct Item { let title: String; let body: String; let url: URL }
        var items: [Item] = []
        for s in fresh.prefix(5) {
            let link: URL = s.entry.tcgplayer.flatMap { URL(string: $0) } ?? Feed.appMarketURL
            items.append(Item(title: s.kind == "sell" ? "Hot sell" : "Buy signal", body: s.message, url: link))
        }
        if fresh.count > 5 { items.append(Item(title: "More signals", body: "\(fresh.count - 5) more buy/sell signals in Market Watch.", url: Feed.appMarketURL)) }
        if !digest.isEmpty { items.append(Item(title: "Market signals today", body: digest.map(Feed.entryText).joined(separator: "\n"), url: Feed.appMarketURL)) }
        guard !items.isEmpty else { return }
        if p.settings.notifications {
            for it in items {
                let content = UNMutableNotificationContent()
                content.title = it.title
                content.body = it.body
                content.sound = .default
                content.userInfo = ["url": it.url.absoluteString]
                try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "signal-\(UUID().uuidString)", content: content, trigger: nil))
            }
        }
        if p.settings.signalPush, p.settings.ntfyEnabled, p.settings.ntfyTopic != nil {
            for it in items { try? await Channels.ntfySend(p.settings, title: it.title, body: it.body, url: it.url) }
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
