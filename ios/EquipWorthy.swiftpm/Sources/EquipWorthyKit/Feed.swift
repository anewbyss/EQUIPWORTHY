import Foundation

/// One card in the daily market feed (scripts/market/build_feed.py → movers.json).
public struct FeedEntry: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var finish: String // "nonfoil" or "foil"
    public var name: String
    public var oracleId: String?
    public var set: String
    public var setName: String?
    public var number: String?
    public var rarity: String?
    public var image: String?
    public var tcgplayer: String?
    public var edhrecRank: Int?
    public var price: Double
    public var d1: Double?
    public var d7: Double?
    public var d30: Double?
    public var move1: Double?
    public var move7: Double?
    public var avg30: Double?
    public var lists: [String]
    public var signal: String? // "buy" or "sell"

    public var key: String { "\(id):\(finish)" }
    public var isFoil: Bool { finish == "foil" }
}

public struct MarketFeed: Codable, Hashable, Sendable {
    public var generatedAt: String
    public var date: String
    public var scanned: Int
    public var historyDays: Int
    public var entries: [FeedEntry]
}

/// A buy or sell signal for a card you own or want.
public struct PriceSignal: Codable, Hashable, Identifiable, Sendable {
    public var key: String // kind:cardId:finish:feedDate
    public var kind: String // "sell" or "buy"
    public var entry: FeedEntry
    public var samePrint: Bool
    public var owned: Int
    public var place: String?
    public var message: String
    public var id: String { key }
}

public struct AllCardsMarket: Codable, Hashable, Sendable {
    public var feed: MarketFeed
    public var fetchedAt: String
    public var signals: [PriceSignal]
    public var sent: [String]
}

/// The all-cards market feed: parsing, your buy/sell signals and notifications (same rules as the web app).
public enum Feed {
    public static let url = URL(string: "https://raw.githubusercontent.com/anewbyss/EQUIPWORTHY/market-data/movers.json")!
    public static let appMarketURL = URL(string: "https://anewbyss.github.io/EQUIPWORTHY/#/market")!
    static let listNames: Set<String> = ["up1", "down1", "up7", "down7", "buy", "sell"]

    /// Validate the downloaded feed; nil if it isn't one.
    public static func parse(_ data: Data) -> MarketFeed? {
        struct Raw: Decodable {
            var generatedAt: String?; var date: String?; var scanned: Int?; var historyDays: Int?; var entries: [RawEntry]?
        }
        struct RawEntry: Decodable {
            var id: String?; var finish: String?; var name: String?; var oracleId: String?; var set: String?; var setName: String?
            var number: String?; var rarity: String?; var image: String?; var tcgplayer: String?; var edhrecRank: Int?
            var price: Double?; var d1: Double?; var d7: Double?; var d30: Double?; var move1: Double?; var move7: Double?; var avg30: Double?
            var lists: [String]?; var signal: String?
        }
        guard let raw = try? JSONDecoder().decode(Raw.self, from: data), let date = raw.date, let list = raw.entries else { return nil }
        let https: (String?) -> String? = { s in s.flatMap { $0.lowercased().hasPrefix("https://") ? $0 : nil } }
        var entries: [FeedEntry] = []
        for r in list.prefix(2000) {
            guard let id = r.id, id.count == 36, let name = r.name, let price = r.price else { continue }
            entries.append(FeedEntry(
                id: id, finish: r.finish == "foil" ? "foil" : "nonfoil", name: String(name.prefix(200)), oracleId: r.oracleId,
                set: String((r.set ?? "").prefix(10)), setName: r.setName, number: r.number, rarity: r.rarity,
                image: https(r.image), tcgplayer: https(r.tcgplayer), edhrecRank: r.edhrecRank,
                price: price, d1: r.d1, d7: r.d7, d30: r.d30, move1: r.move1, move7: r.move7, avg30: r.avg30,
                lists: (r.lists ?? []).filter { listNames.contains($0) },
                signal: r.signal == "buy" || r.signal == "sell" ? r.signal : nil))
        }
        return MarketFeed(generatedAt: raw.generatedAt ?? date, date: date, scanned: raw.scanned ?? 0, historyDays: raw.historyDays ?? 0, entries: entries)
    }

    private static func pct(_ v: Double) -> String { String(format: "%@%.0f%%", v > 0 ? "+" : "", v) }

    /// "+100% today, +120% this week".
    public static func change(_ e: FeedEntry) -> String {
        var parts: [String] = []
        if let d = e.d1, abs(d) >= 1 { parts.append("\(pct(d)) today") }
        if let d = e.d7, abs(d) >= 1 { parts.append("\(pct(d)) this week") }
        return parts.isEmpty ? "flat" : parts.joined(separator: ", ")
    }

    static func label(_ e: FeedEntry) -> String { "\(e.name) (\(e.set.uppercased())\(e.isFoil ? " foil" : ""))" }
    static func money(_ v: Double) -> String { String(format: "$%.2f", v) }

    /// Sell signals for your cards that are spiking; buy signals for watchlist, wishlist and deck cards (not owned) that are dropping.
    public static func personalSignals(_ p: Profile, feed: MarketFeed) -> [PriceSignal] {
        let oracleOf: (String) -> String? = { p.cardCache[$0]?.oracleId }
        var owned: [String: Int] = [:]
        var ownedOracle: [String: Int] = [:]
        for c in p.collection {
            let k = "\(c.cardId):\(c.finish == .foil ? "foil" : "nonfoil")"
            owned[k, default: 0] += c.quantity
            if let o = oracleOf(c.cardId) { ownedOracle[o, default: 0] += c.quantity }
        }
        let ownedIds = Set(p.collection.map(\.cardId))
        var wanted: [String: String] = [:]
        func want(_ id: String, _ place: String) {
            guard !ownedIds.contains(id) else { return }
            if wanted[id] == nil { wanted[id] = place }
            if let o = oracleOf(id), wanted["o:" + o] == nil { wanted["o:" + o] = place }
        }
        for w in p.watchlist { want(w.cardId, "watchlist") }
        for w in p.wishlist { want(w.cardId, "wishlist") }
        for d in p.decks { for c in d.cards where c.board != .maybe { want(c.cardId, "deck \"\(d.name)\"") } }

        var out: [PriceSignal] = []
        for e in feed.entries {
            let up = e.lists.contains { $0 == "up1" || $0 == "up7" || $0 == "sell" }
            let down = e.lists.contains { $0 == "down1" || $0 == "down7" || $0 == "buy" }
            if up {
                let same = owned[e.key] ?? 0
                let other = same == 0 ? (e.oracleId.flatMap { ownedOracle[$0] } ?? 0) : 0
                if same + other > 0 {
                    let msg = same > 0
                        ? "Hot sell: \(label(e)) is \(change(e)), now \(money(e.price)). You own \(same) (about \(money(Double(same) * e.price)))."
                        : "\(label(e)) is \(change(e)) to \(money(e.price)). You own another printing of \(e.name): check its price, it may be rising too."
                    out.append(PriceSignal(key: "sell:\(e.id):\(e.finish):\(feed.date)", kind: "sell", entry: e, samePrint: same > 0,
                                           owned: same > 0 ? same : other, place: nil, message: msg))
                }
            }
            if down {
                let place = wanted[e.id] ?? e.oracleId.flatMap { wanted["o:" + $0] }
                if let place {
                    let same = wanted[e.id] != nil
                    let avg = e.avg30.map { " (30-day average \(money($0)))" } ?? ""
                    let msg = "Buy signal: \(label(e)) is \(change(e)), now \(money(e.price))\(avg). It's on your \(place)\(same ? "" : " (another printing)")."
                    out.append(PriceSignal(key: "buy:\(e.id):\(e.finish):\(feed.date)", kind: "buy", entry: e, samePrint: same, owned: 0, place: place, message: msg))
                }
            }
        }
        let size: (PriceSignal) -> Double = { max(abs($0.entry.d1 ?? 0), abs($0.entry.d7 ?? 0)) }
        return out.enumerated().sorted { a, b in
            if a.element.samePrint != b.element.samePrint { return a.element.samePrint }
            let x = size(a.element), y = size(b.element)
            return x != y ? x > y : a.offset < b.offset
        }.map(\.element)
    }

    public static func topSignals(_ feed: MarketFeed, n: Int = 3) -> [FeedEntry] {
        Array(feed.entries.filter { $0.signal == "sell" }.prefix(n)) + Array(feed.entries.filter { $0.signal == "buy" }.prefix(n))
    }

    public static func entryText(_ e: FeedEntry) -> String {
        let kind = e.signal == "sell" ? "Sell spike" : e.signal == "buy" ? "Buy dip" : "Mover"
        return "\(kind): \(label(e)) \(change(e)), now \(money(e.price))"
    }

    /// Fold a downloaded feed into the profile: recompute your signals, add an alert per new one,
    /// and report what to notify (each signal once per feed day).
    public static func apply(_ p: Profile, feed: MarketFeed, now: Date = Date()) -> (profile: Profile, fresh: [PriceSignal], digest: [FeedEntry]) {
        let signals = personalSignals(p, feed: feed)
        let sent = Set(p.allCards?.sent ?? [])
        let scope = p.settings.signalScope
        let fresh = scope == "off" ? [] : signals.filter { !sent.contains($0.key) }
        let digestKey = "digest:\(feed.date)"
        let digest = scope == "all" && !sent.contains(digestKey) ? topSignals(feed).filter { e in !signals.contains { $0.entry.id == e.id } } : []
        let alerts = fresh.map { s in
            PriceAlert(id: UUID().uuidString, cardId: s.entry.id, name: s.entry.name, kind: s.kind == "sell" ? .sell : .buy,
                       message: s.message, createdAt: isoNow(now), read: false)
        }
        var newSent = (p.allCards?.sent ?? []) + fresh.map(\.key)
        if !digest.isEmpty { newSent.append(digestKey) }
        var q = p
        q.alerts = Array((alerts + p.alerts).prefix(300))
        q.allCards = AllCardsMarket(feed: feed, fetchedAt: isoNow(now), signals: signals, sent: Array(newSent.suffix(500)))
        return (q, fresh, digest)
    }

    /// Fetched at most every 3 hours (it changes once a day).
    public static func due(_ p: Profile, now: Date = Date()) -> Bool {
        guard p.settings.marketFeed else { return false }
        guard let a = p.allCards, let t = parseISO(a.fetchedAt) else { return true }
        return now.timeIntervalSince(t) > 3 * 3600
    }
}
