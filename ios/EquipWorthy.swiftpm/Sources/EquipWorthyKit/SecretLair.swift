import Foundation

// Secret Lair drop tracking. Port of web/src/lib/secretlair.ts; see docs/SECRET_LAIR.md.
// EquipWorthy never joins the waiting room or buys anything for you: it gets you
// to the official page at the right moment, ready to check out.

/// `["2026-11-01T17:00:00.000Z", 5000]`, matching the web app's JSON.
public struct QueueReading: Codable, Hashable, Sendable {
    public var at: String
    public var position: Int
    public init(_ at: String, _ position: Int) { self.at = at; self.position = position }
    public init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        at = try c.decode(String.self)
        position = Int(try c.decode(Double.self))
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.unkeyedContainer()
        try c.encode(at)
        try c.encode(position)
    }
}

public struct QueueLog: Codable, Hashable, Sendable {
    public var startedAt: String
    public var entries: [QueueReading]
    public var notified: [String]
    public var admittedAt: String?
    public init(startedAt: String = isoNow(), entries: [QueueReading] = [], notified: [String] = [], admittedAt: String? = nil) {
        self.startedAt = startedAt; self.entries = entries; self.notified = notified; self.admittedAt = admittedAt
    }
}

public struct OwnedDrop: Codable, Hashable, Sendable {
    public var finish: Finish
    public var quantity: Int
    public var paid: Double?
    public var boughtAt: String?
    public init(finish: Finish, quantity: Int, paid: Double?, boughtAt: String? = isoNow()) {
        self.finish = finish; self.quantity = quantity; self.paid = paid; self.boughtAt = boughtAt
    }
}

public struct SecretLairDrop: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var saleStart: String?
    public var saleEnd: String?
    public var price: Double?
    public var foilPrice: Double?
    public var url: String?
    /// Where the drop was announced or previewed.
    public var announcementUrl: String?
    public var cardIds: [String]
    public var marked: Bool
    public var checklist: [String: Bool]
    public var remindersSent: [String]
    /// ntfy reminders already scheduled, as "key@saleStart" (shared across devices).
    public var pushScheduled: [String]?
    public var queue: QueueLog?
    public var owned: OwnedDrop?
    public var notes: String?
    public var createdAt: String
    public var updatedAt: String

    public init(name: String, cardIds: [String] = [], marked: Bool = true) {
        id = UUID().uuidString.lowercased()
        self.name = name
        self.cardIds = cardIds
        self.marked = marked
        checklist = [:]
        remindersSent = []
        createdAt = isoNow(); updatedAt = isoNow()
    }
}

public struct SecretLairGroup: Codable, Hashable, Identifiable, Sendable {
    public var key: String
    public var name: String
    public var releasedAt: String
    public var cardIds: [String]
    /// YYYY-MM-DD the first card was previewed.
    public var announcedAt: String?
    public var announcementUrl: String?
    public var announcementSource: String?
    /// Where this drop was found: "scryfall", "calendar".
    public var sources: [String]?
    /// Scryfall set code when the drop is its own set (e.g. Countdown Kits).
    public var set: String?
    public var saleStart: String?
    public var price: Double?
    public var foilPrice: Double?
    public var url: String?
    public var notes: String?
    public var tentative: Bool?
    /// Announced number of cards, when Scryfall doesn't list them yet.
    public var cardCount: Int?
    public var id: String { key }
}

/// One entry in EquipWorthy's Secret Lair drop calendar (web/public/secret-lair-drops.json).
public struct CalendarDrop: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var saleStart: String?
    public var releaseDate: String?
    public var price: Double?
    public var foilPrice: Double?
    public var url: String?
    public var announcementUrl: String?
    public var set: String?
    public var cards: Int?
    public var notes: String?
    public var tentative: Bool?
}

/// A Secret Lair product Scryfall lists as its own set.
public struct SecretLairSet: Codable, Hashable, Sendable {
    public var code: String
    public var name: String
    public var releasedAt: String?
    public init(code: String, name: String, releasedAt: String? = nil) { self.code = code; self.name = name; self.releasedAt = releasedAt }
}

/// Cheapest copies of a card outside Secret Lair, for pre-drop price comparisons.
public struct ReprintPrice: Codable, Hashable, Sendable {
    public var usd: Double?
    public var usdFoil: Double?
    public var setName: String?
    public var printings: Int
    public var fetchedAt: String
    public init(usd: Double? = nil, usdFoil: Double? = nil, setName: String? = nil, printings: Int, fetchedAt: String = isoNow()) {
        self.usd = usd; self.usdFoil = usdFoil; self.setName = setName; self.printings = printings; self.fetchedAt = fetchedAt
    }
}

public struct SecretLairCatalog: Codable, Hashable, Sendable {
    public var cards: [String: CardSummary]
    public var groups: [SecretLairGroup]
    public var fetchedAt: String
    /// By oracle id.
    public var reprints: [String: ReprintPrice]?
    /// Secret Lair sets on Scryfall besides "sld".
    public var sets: [SecretLairSet]?
    public var calendar: [CalendarDrop]?
    public init(cards: [String: CardSummary], groups: [SecretLairGroup], fetchedAt: String, reprints: [String: ReprintPrice]? = nil,
                sets: [SecretLairSet]? = nil, calendar: [CalendarDrop]? = nil) {
        self.cards = cards; self.groups = groups; self.fetchedAt = fetchedAt; self.reprints = reprints; self.sets = sets; self.calendar = calendar
    }
}

public struct QueueEstimate: Hashable, Sendable {
    public var position: Int
    public var perMinute: Double?
    public var etaMinutes: Double?
    public var etaAt: Date?
}

public enum SecretLair {
    public static let storeURL = URL(string: "https://secretlair.wizards.com/")!
    public static let accountURL = URL(string: "https://myaccounts.wizards.com/")!

    /// The drop's own page, or the store front if no safe link is saved.
    public static func launchURL(_ d: SecretLairDrop) -> URL {
        if let s = d.url, s.lowercased().hasPrefix("https://"), let u = URL(string: s) { return u }
        return storeURL
    }

    public struct Reminder: Sendable { public let key: String; public let before: TimeInterval; public let text: @Sendable (String) -> String }

    public static let reminders: [Reminder] = [
        Reminder(key: "24h", before: 24 * 3600) { "\($0) goes on sale in 24 hours. Run the pre-sale checklist today." },
        Reminder(key: "1h", before: 3600) { "\($0) goes on sale in 1 hour. Sign in and check your saved address and payment." },
        Reminder(key: "15m", before: 15 * 60) { "\($0) in 15 minutes. Open EquipWorthy for the launch link." },
        Reminder(key: "5m", before: 5 * 60) { "\($0) in 5 minutes. Open the drop page now and wait there." },
        Reminder(key: "open", before: 0) { "\($0) is live! Tap to open the drop and join the line." },
    ]

    /// Only the latest due reminder; `skip` lists earlier keys to mark as sent with it.
    public static func dueReminder(_ d: SecretLairDrop, now: Date = Date()) -> (key: String, text: String, skip: [String])? {
        guard d.marked, let s = d.saleStart, let start = parseISO(s) else { return nil }
        if now.timeIntervalSince(start) > 2 * 3600 { return nil }
        var latest: Int?
        for (i, r) in reminders.enumerated() where now >= start.addingTimeInterval(-r.before) { latest = i }
        guard let i = latest, !d.remindersSent.contains(reminders[i].key) else { return nil }
        return (reminders[i].key, reminders[i].text(d.name), reminders.prefix(i).map(\.key))
    }

    public static func countdown(_ saleStart: String?, now: Date = Date()) -> String? {
        guard let s = saleStart, let start = parseISO(s) else { return nil }
        let ms = start.timeIntervalSince(now)
        if ms <= 0 { return "Live now" }
        let t = Int(ms)
        let d = t / 86400, h = (t % 86400) / 3600, m = (t % 3600) / 60, sec = t % 60
        if d > 0 { return "\(d)d \(h)h" }
        if h > 0 { return String(format: "%dh %02dm", h, m) }
        return String(format: "%dm %02ds", m, sec)
    }

    public enum State: String, Sendable { case upcoming, soon, live, ended, unscheduled }

    public static func state(_ d: SecretLairDrop, now: Date = Date()) -> State {
        guard let s = d.saleStart, let start = parseISO(s) else { return .unscheduled }
        let end = d.saleEnd.flatMap(parseISO) ?? start.addingTimeInterval(30 * 86400)
        if now >= end { return .ended }
        if now >= start { return .live }
        if start.timeIntervalSince(now) <= 3600 { return .soon }
        return .upcoming
    }

    public struct CheckItem: Sendable { public let key: String; public let label: String; public let detail: String; public let link: URL? }

    public static let checklist: [CheckItem] = [
        CheckItem(key: "account", label: "Signed in to your Wizards account", detail: "Sign in on the device and browser you'll buy from, so you don't have to sign in mid-line.", link: accountURL),
        CheckItem(key: "address", label: "Shipping address saved", detail: "Check your default address in your account so checkout is one tap.", link: nil),
        CheckItem(key: "payment", label: "Payment method ready", detail: "Have your card or wallet ready (Apple Pay / PayPal if offered).", link: nil),
        CheckItem(key: "version", label: "Version and quantity decided", detail: "Know whether you want foil or non-foil and how many, and note any per-customer limit.", link: nil),
        CheckItem(key: "link", label: "Drop link added", detail: "Paste the product link from Wizards' announcement so EquipWorthy opens the exact page.", link: nil),
        CheckItem(key: "early", label: "Plan to open the page a few minutes early", detail: "If a waiting room appears, join and leave that tab alone. Refreshing or opening extra tabs can cost you your place.", link: nil),
        CheckItem(key: "device", label: "Device charged, awake and online", detail: "Plug in, use strong Wi-Fi, and keep the screen on while you're in line.", link: nil),
    ]

    public static func isChecked(_ d: SecretLairDrop, _ key: String) -> Bool {
        (d.checklist[key] ?? false) || (key == "link" && d.url != nil)
    }

    public static func readiness(_ d: SecretLairDrop) -> Double {
        Double(checklist.filter { isChecked(d, $0.key) }.count) / Double(checklist.count)
    }

    // MARK: Reminder plan (shared by notifications, ntfy, texts)

    public struct Planned: Hashable, Sendable {
        public var id: String
        public var key: String
        public var at: Date
        public var title: String
        public var body: String
        public var url: URL
    }

    /// Every reminder still ahead for a followed drop with a sale time.
    public static func planned(_ d: SecretLairDrop, now: Date = Date()) -> [Planned] {
        guard d.marked, d.owned == nil, let s = d.saleStart, let start = parseISO(s) else { return [] }
        return reminders.compactMap { r in
            let at = start.addingTimeInterval(-r.before)
            guard at > now else { return nil }
            return Planned(id: "\(d.id)-\(r.key)", key: r.key, at: at,
                           title: r.key == "open" ? "Secret Lair drop is live" : "Secret Lair reminder",
                           body: r.text(d.name), url: launchURL(d))
        }
    }

    // MARK: Place in line

    public static func estimate(_ q: QueueLog, now: Date = Date()) -> QueueEstimate? {
        let pts = Array(q.entries.filter { $0.position >= 0 }.suffix(6))
        guard let last = pts.last else { return nil }
        if last.position == 0 { return QueueEstimate(position: 0, perMinute: nil, etaMinutes: 0, etaAt: now) }
        guard pts.count >= 2, let t0 = parseISO(pts[0].at), let lastAt = parseISO(last.at) else {
            return QueueEstimate(position: last.position, perMinute: nil, etaMinutes: nil, etaAt: nil)
        }
        var xs: [Double] = []
        var ys: [Double] = []
        for p in pts {
            guard let t = parseISO(p.at) else { continue }
            xs.append(t.timeIntervalSince(t0) / 60)
            ys.append(Double(p.position))
        }
        let n = Double(xs.count)
        let mx = xs.reduce(0, +) / n
        let my = ys.reduce(0, +) / n
        var num = 0.0, den = 0.0
        for i in xs.indices {
            let dx = xs[i] - mx
            num += dx * (ys[i] - my)
            den += dx * dx
        }
        if den == 0 { return QueueEstimate(position: last.position, perMinute: nil, etaMinutes: nil, etaAt: nil) }
        let perMinute = -num / den
        let rate = (perMinute * 10).rounded() / 10
        if perMinute <= 0 { return QueueEstimate(position: last.position, perMinute: rate, etaMinutes: nil, etaAt: nil) }
        let since = now.timeIntervalSince(lastAt) / 60
        let eta = max(0, Double(last.position) / perMinute - since)
        return QueueEstimate(position: last.position, perMinute: rate, etaMinutes: (eta * 10).rounded() / 10, etaAt: now.addingTimeInterval(eta * 60))
    }

    public static func dueQueueNotice(_ q: QueueLog, _ est: QueueEstimate?) -> (key: String, text: String)? {
        guard let est, q.admittedAt == nil, let eta = est.etaMinutes else { return nil }
        if eta <= 1 && !q.notified.contains("near") { return ("near", "Almost through the line! Have the drop page in front of you.") }
        if eta <= 5 && !q.notified.contains("soon") { return ("soon", "About \(max(1, Int(eta.rounded()))) minutes to go in the line (place \(est.position)).") }
        return nil
    }

    public static func etaText(_ est: QueueEstimate?) -> String {
        guard let est else { return "Enter your place in line to start." }
        if est.position == 0 { return "You're through!" }
        guard let rate = est.perMinute else { return "Place \(est.position). Add another reading in a minute or two to estimate your wait." }
        if rate <= 0 { return "Place \(est.position). The line isn't moving yet." }
        let m = est.etaMinutes ?? 0
        let wait = m < 1 ? "under a minute" : m < 60 ? "about \(Int(m.rounded())) min" : "about \(Int(m) / 60)h \(Int(m.truncatingRemainder(dividingBy: 60).rounded()))m"
        return "Place \(est.position) · moving ~\(rate.formatted())/min · \(wait) to go"
    }

    // MARK: Value and catalog

    public static func value(_ cardIds: [String], cards: [String: CardSummary], finish: Finish = .nonfoil) -> (total: Double, priced: Int) {
        var total = 0.0, priced = 0
        for id in cardIds {
            if let v = cards[id]?.price(finish) { total += v; priced += 1 }
        }
        return ((total * 100).rounded() / 100, priced)
    }

    /// Group Scryfall's single Secret Lair set into drops: same release date and consecutive collector numbers.
    /// Earliest preview date and first preview link among a drop's cards.
    static func applyAnnouncement(_ g: inout SecretLairGroup, _ cards: [CardSummary]) {
        let previewed = cards.filter { $0.preview?.at != nil || $0.preview?.url != nil }
            .sorted { ($0.preview?.at ?? "9") < ($1.preview?.at ?? "9") }
        let linked = previewed.first { $0.preview?.url != nil }
        g.announcedAt = previewed.first?.preview?.at.map { String($0.prefix(10)) }
        g.announcementUrl = linked?.preview?.url
        g.announcementSource = linked?.preview?.source
    }

    public static func groupDrops(_ cards: [CardSummary]) -> [SecretLairGroup] {
        let numbered: [(card: CardSummary, n: Int)] = cards.compactMap { c in
            let digits = c.collectorNumber.prefix { $0.isNumber }
            guard !digits.isEmpty, let n = Int(digits) else { return nil }
            return (c, n)
        }
        let sorted = numbered.sorted { $0.card.releasedAt != $1.card.releasedAt ? $0.card.releasedAt < $1.card.releasedAt : $0.n < $1.n }
        var groups: [SecretLairGroup] = []
        var current: [CardSummary] = []
        var first = 0, last = 0, released = ""
        func flush() {
            guard !current.isEmpty else { return }
            var names: [String] = []
            for c in current where !names.contains(c.name) { names.append(c.name) }
            let label = names.prefix(2).joined(separator: ", ") + (names.count > 2 ? " +\(names.count - 2) more" : "")
            var g = SecretLairGroup(key: "\(released)#\(first)", name: label, releasedAt: released, cardIds: current.map(\.id))
            applyAnnouncement(&g, current)
            g.sources = ["scryfall"]
            groups.append(g)
        }
        for (c, n) in sorted {
            if !current.isEmpty && released == c.releasedAt && n - last <= 1 {
                current.append(c); last = n
            } else {
                flush()
                current = [c]; first = n; last = n; released = c.releasedAt
            }
        }
        flush()
        return groups.sorted { $0.releasedAt != $1.releasedAt ? $0.releasedAt > $1.releasedAt : $0.key > $1.key }
    }

    // MARK: Upcoming drops and pre-drop price comparison

    /// Usual Secret Lair prices, used when a drop's price isn't known yet.
    public static let typicalPrice: Double = 29.99
    public static let typicalFoilPrice: Double = 39.99

    public static func announcementURL(_ s: String?) -> URL? {
        guard let s, s.lowercased().hasPrefix("https://") else { return nil }
        return URL(string: s)
    }

    /// Scryfall search showing the cards in a drop group.
    public static func scryfallURL(_ g: SecretLairGroup, cards: [String: CardSummary]) -> URL {
        let nums = g.cardIds.compactMap { cards[$0]?.collectorNumber }.map { "cn:\($0)" }
        var c = URLComponents(string: "https://scryfall.com/search")!
        c.queryItems = [URLQueryItem(name: "q", value: "e:sld (\(nums.joined(separator: " or ")))"), URLQueryItem(name: "unique", value: "prints")]
        return c.url!
    }

    /// Announced drops not yet released, plus ones released in the last `recentDays` days, soonest first.
    public static func upcomingGroups(_ groups: [SecretLairGroup], now: Date = Date(), recentDays: Int = 30) -> [SecretLairGroup] {
        let from = dayString(now.addingTimeInterval(-Double(recentDays) * 86400))
        return groups.filter { $0.releasedAt >= from }.sorted { a, b in
            let x = a.saleStart ?? a.releasedAt, y = b.saleStart ?? b.releasedAt
            return x != y ? x < y : a.key < b.key
        }
    }

    public static func isUpcoming(_ g: SecretLairGroup, now: Date = Date()) -> Bool {
        if let s = g.saleStart, let t = parseISO(s) { return t > now }
        return g.releasedAt > dayString(now)
    }

    /// Cheapest non-Secret Lair copies from a list of printings of one card.
    public static func cheapestReprint(_ prints: [CardSummary], now: Date = Date(), secretLairSets: [String] = ["sld"]) -> ReprintPrice {
        let skip = Set(secretLairSets)
        let paper = prints.filter { !skip.contains($0.set) }
        let usd = paper.compactMap { $0.prices.usd }.filter { $0 > 0 }.min()
        let foil = paper.compactMap { $0.prices.usdFoil }.filter { $0 > 0 }.min()
        let setName = usd.flatMap { u in paper.first { $0.prices.usd == u }?.setName }
        return ReprintPrice(usd: usd, usdFoil: foil, setName: setName, printings: paper.count, fetchedAt: isoNow(now))
    }

    public struct CompareRow: Hashable, Sendable, Identifiable {
        public var cardId: String
        public var name: String
        public var sld: Double?
        public var reprint: Double?
        public var reprintSet: String?
        public var isNew: Bool
        public var id: String { cardId }
    }

    public struct Comparison: Hashable, Sendable {
        public var foil: Bool
        public var price: Double
        public var priceIsTypical: Bool
        public var rows: [CompareRow]
        public var sldTotal: Double
        public var sldPriced: Int
        public var reprintTotal: Double
        public var reprintPriced: Int
        public var newCards: Int
        /// Price minus the cards' cost in other printings (positive = premium for the Secret Lair versions).
        public var premium: Double?
        /// Secret Lair market minus price (positive = trading above the price).
        public var marketGap: Double?
    }

    private static func cents(_ x: Double) -> Double { (x * 100).rounded() / 100 }

    /// Compare a drop's price with its cards' Secret Lair market and the cheapest copies elsewhere.
    public static func compare(_ cardIds: [String], cards: [String: CardSummary], reprints: [String: ReprintPrice],
                               foil: Bool = false, price: Double? = nil) -> Comparison {
        let p = price ?? (foil ? typicalFoilPrice : typicalPrice)
        var rows: [CompareRow] = []
        for id in cardIds {
            guard let c = cards[id] else { continue }
            let r = c.oracleId.flatMap { reprints[$0] }
            let reprint: Double? = foil ? (r?.usdFoil ?? r?.usd) : (r?.usd ?? r?.usdFoil)
            rows.append(CompareRow(cardId: id, name: c.name, sld: c.price(foil ? .foil : .nonfoil), reprint: reprint,
                                   reprintSet: r?.setName, isNew: r?.printings == 0))
        }
        let sldPriced = rows.filter { $0.sld != nil }.count
        let reprintPriced = rows.filter { $0.reprint != nil }.count
        let sldTotal = cents(rows.reduce(0) { $0 + ($1.sld ?? 0) })
        let reprintTotal = cents(rows.reduce(0) { $0 + ($1.reprint ?? 0) })
        return Comparison(foil: foil, price: p, priceIsTypical: price == nil, rows: rows, sldTotal: sldTotal, sldPriced: sldPriced,
                          reprintTotal: reprintTotal, reprintPriced: reprintPriced, newCards: rows.filter(\.isNew).count,
                          premium: reprintPriced > 0 ? cents(p - reprintTotal) : nil,
                          marketGap: sldPriced > 0 && sldPriced == rows.count ? cents(sldTotal - p) : nil)
    }

    /// One-line plain-English read of a comparison (same wording as the web app).
    public static func summary(_ c: Comparison) -> String {
        var parts: [String] = []
        let money: (Double) -> String = { String(format: "$%.2f", abs($0)) }
        if let g = c.marketGap {
            parts.append(g >= 0 ? "Secret Lair copies trade \(money(g)) above the price" : "Secret Lair copies trade \(money(g)) below the price")
        }
        if let pr = c.premium {
            let partial = c.reprintPriced < c.rows.count ? " (\(c.reprintPriced) of \(c.rows.count) cards)" : ""
            parts.append(pr >= 0 ? "the cards cost \(money(pr)) less in other printings\(partial)" : "the drop is \(money(pr)) cheaper than other printings\(partial)")
        }
        if c.newCards > 0 { parts.append("\(c.newCards) new card\(c.newCards == 1 ? "" : "s") with no other printing") }
        guard !parts.isEmpty else { return "No prices yet. Compare again once pre-orders or reprint prices show up." }
        let s = parts.joined(separator: "; ")
        return String(s.prefix(1)).uppercased() + String(s.dropFirst()) + "."
    }

    /// Oracle ids among these cards that have no reprint prices from the last two days.
    public static func staleReprintIds(_ cards: [CardSummary?], known: [String: ReprintPrice], now: Date = Date()) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for c in cards {
            guard let id = c?.oracleId, !seen.contains(id) else { continue }
            seen.insert(id)
            if let k = known[id], let t = parseISO(k.fetchedAt), now.timeIntervalSince(t) < 2 * 86400 { continue }
            out.append(id)
        }
        return out
    }

    /// Look up the cheapest non-Secret Lair copies of cards (by oracle id) in a few batched Scryfall searches.
    public static func fetchReprints(_ oracleIds: [String], secretLairSets: [String] = ["sld"]) async throws -> [String: ReprintPrice] {
        let exclude = secretLairSets.map { "-e:\($0)" }.joined(separator: " ")
        var found: [String: ReprintPrice] = [:]
        var i = 0
        while i < oracleIds.count {
            let batch = Array(oracleIds[i..<min(i + 12, oracleIds.count)])
            i += 12
            var byOracle: [String: [CardSummary]] = [:]
            for id in batch { byOracle[id] = [] }
            let q = "(" + batch.map { "oracleid:\($0)" }.joined(separator: " or ") + ") " + exclude
            var page = 1
            while true {
                let r = try await Scryfall.shared.search(q, unique: "prints", order: "usd", dir: "asc", page: page)
                for c in r.cards { if let o = c.oracleId, byOracle[o] != nil { byOracle[o]?.append(c) } }
                if !r.hasMore || page >= 4 { break }
                page += 1
            }
            for id in batch { found[id] = cheapestReprint(byOracle[id] ?? [], secretLairSets: secretLairSets) }
        }
        return found
    }

    /// Median of (cards' value now ÷ typical price) for drops released 2 months to 2 years ago with every card priced.
    public static func pastDropTrend(_ cat: SecretLairCatalog, now: Date = Date(), foil: Bool = false,
                                     minDays: Int = 60, maxDays: Int = 730) -> (median: Double, drops: Int)? {
        let lo = dayString(now.addingTimeInterval(-Double(maxDays) * 86400))
        let hi = dayString(now.addingTimeInterval(-Double(minDays) * 86400))
        var ratios: [Double] = []
        for g in cat.groups where g.releasedAt >= lo && g.releasedAt <= hi && g.cardIds.count >= 2 {
            let v = value(g.cardIds, cards: cat.cards, finish: foil ? .foil : .nonfoil)
            if v.priced == g.cardIds.count { ratios.append(v.total / (foil ? typicalFoilPrice : typicalPrice)) }
        }
        guard ratios.count >= 3 else { return nil }
        ratios.sort()
        let m = ratios.count / 2
        return (ratios.count % 2 == 1 ? ratios[m] : (ratios[m - 1] + ratios[m]) / 2, ratios.count)
    }

    // MARK: More sources: other Secret Lair sets and the drop calendar

    /// EquipWorthy's drop calendar, read from GitHub so edits show up without an app update.
    public static let calendarURL = URL(string: "https://raw.githubusercontent.com/anewbyss/EQUIPWORTHY/main/web/public/secret-lair-drops.json")!
    public static let calendarEditURL = URL(string: "https://github.com/anewbyss/EQUIPWORTHY/blob/main/web/public/secret-lair-drops.json")!

    /// Secret Lair products Scryfall lists as their own sets, excluding promos and digital.
    public static func isSecretLairSet(code: String, name: String, digital: Bool = false) -> Bool {
        guard code != "sld", !digital else { return false }
        let n = name.lowercased()
        return n.contains("secret lair") && !["promo", "showdown", "token", "art series"].contains { n.contains($0) }
    }

    private static func https(_ s: String?) -> String? { s.flatMap { $0.lowercased().hasPrefix("https://") ? $0 : nil } }
    private static func text(_ s: String?, _ max: Int) -> String? {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return String(t.prefix(max))
    }

    /// Validate the drop calendar file; bad entries are skipped.
    public static func parseCalendar(_ data: Data) -> [CalendarDrop] {
        struct File: Decodable { var drops: [Raw]? }
        struct Raw: Decodable {
            var id: String?; var name: String?; var saleStart: String?; var releaseDate: String?
            var price: Double?; var foilPrice: Double?; var url: String?; var announcementUrl: String?
            var set: String?; var cards: Int?; var notes: String?; var tentative: Bool?
        }
        guard let file = try? JSONDecoder().decode(File.self, from: data) else { return [] }
        var out: [CalendarDrop] = []
        for r in (file.drops ?? []).prefix(300) {
            guard let id = text(r.id, 80), let name = text(r.name, 160) else { continue }
            let sale = r.saleStart.flatMap(parseISO).map { isoNow($0) }
            let day = r.releaseDate.flatMap { $0.count == 10 && dayDate($0) != nil ? $0 : nil }
            guard sale != nil || day != nil else { continue }
            let money: (Double?) -> Double? = { v in v.flatMap { $0 >= 0 && $0 < 100_000 ? $0 : nil } }
            let set = r.set.flatMap { s in s.count >= 2 && s.count <= 8 && s.allSatisfy { $0.isLetter || $0.isNumber } ? s.lowercased() : nil }
            out.append(CalendarDrop(id: id, name: name, saleStart: sale, releaseDate: day, price: money(r.price), foilPrice: money(r.foilPrice),
                                    url: https(r.url), announcementUrl: https(r.announcementUrl), set: set,
                                    cards: r.cards.flatMap { $0 > 0 && $0 < 1000 ? $0 : nil }, notes: text(r.notes, 400),
                                    tentative: r.tentative == true ? true : nil))
        }
        return out
    }

    /// Loose name key for matching: "Secret Lair Countdown Kit: Marvel's History of Heroes" → "marvel s history of heroes".
    public static func nameKey(_ s: String) -> String {
        var t = s.lowercased()
        t = t.replacingOccurrences(of: "secret lair|countdown kit|drop series|\\bdrop\\b|\\bx\\b", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression)
        return t.trimmingCharacters(in: .whitespaces)
    }

    static func sameDrop(_ a: String, _ b: String) -> Bool {
        let x = nameKey(a), y = nameKey(b)
        return x.count >= 6 && y.count >= 6 && (x.contains(y) || y.contains(x))
    }

    /// Every drop from every source, newest first (same rules as the web app).
    public static func buildCatalogGroups(_ cards: [CardSummary], sets: [SecretLairSet] = [], calendar: [CalendarDrop] = []) -> [SecretLairGroup] {
        var groups = groupDrops(cards.filter { $0.set == "sld" })
        for set in sets {
            let mine = cards.filter { $0.set == set.code }.sorted { (Int($0.collectorNumber.prefix { $0.isNumber }) ?? 0) < (Int($1.collectorNumber.prefix { $0.isNumber }) ?? 0) }
            guard let released = set.releasedAt ?? mine.map(\.releasedAt).min() else { continue }
            var g = SecretLairGroup(key: "set:\(set.code)", name: set.name, releasedAt: released, cardIds: mine.map(\.id))
            applyAnnouncement(&g, mine)
            g.set = set.code
            g.sources = ["scryfall"]
            groups.append(g)
        }
        for cal in calendar {
            if let i = groups.firstIndex(where: { g in (cal.set != nil && g.set == cal.set) || (g.set != nil && sameDrop(g.name, cal.name)) }) {
                var g = groups[i]
                g.name = cal.name
                if let v = cal.saleStart { g.saleStart = v }
                if let v = cal.price { g.price = v }
                if let v = cal.foilPrice { g.foilPrice = v }
                if let v = cal.url { g.url = v }
                if let v = cal.notes { g.notes = v }
                if let v = cal.tentative { g.tentative = v }
                if let v = cal.cards { g.cardCount = v }
                g.announcementUrl = cal.announcementUrl ?? g.announcementUrl
                if !(g.sources ?? []).contains("calendar") { g.sources = (g.sources ?? []) + ["calendar"] }
                groups[i] = g
            } else {
                let day = String((cal.saleStart ?? cal.releaseDate ?? "").prefix(10))
                var g = SecretLairGroup(key: "cal:\(cal.id)", name: cal.name, releasedAt: day, cardIds: [])
                g.announcementUrl = cal.announcementUrl
                g.set = cal.set; g.sources = ["calendar"]; g.saleStart = cal.saleStart; g.price = cal.price; g.foilPrice = cal.foilPrice
                g.url = cal.url; g.notes = cal.notes; g.tentative = cal.tentative; g.cardCount = cal.cards
                groups.append(g)
            }
        }
        return groups.sorted { $0.releasedAt != $1.releasedAt ? $0.releasedAt > $1.releasedAt : $0.key > $1.key }
    }

    /// Give followed drops added before their cards were listed (e.g. from the calendar) their cards.
    public static func attachCards(_ drops: [SecretLairDrop], groups: [SecretLairGroup]) -> [SecretLairDrop]? {
        var changed = false
        let out = drops.map { d -> SecretLairDrop in
            guard d.cardIds.isEmpty else { return d }
            let match = groups.first { g in
                !g.cardIds.isEmpty && (g.name.lowercased() == d.name.lowercased() || (g.set != nil && sameDrop(g.name, d.name)))
            }
            guard let g = match else { return d }
            changed = true
            var x = d
            x.cardIds = g.cardIds
            x.announcementUrl = d.announcementUrl ?? g.announcementUrl
            x.updatedAt = isoNow()
            return x
        }
        return changed ? out : nil
    }

    public static func isFollowed(_ drops: [SecretLairDrop], _ g: SecretLairGroup) -> Bool {
        drops.contains { d in (!g.cardIds.isEmpty && d.cardIds == g.cardIds) || d.name.lowercased() == g.name.lowercased() }
    }

    // MARK: Sorting

    public enum GroupSort: String, CaseIterable, Sendable {
        case soonest = "Release: soonest first"
        case latest = "Release: newest first"
        case announced = "Recently announced"
        case deal = "Best deal vs price"
        case value = "Card value: high to low"
        case price = "Price: low to high"
        case name = "Name"
    }

    /// Market gap, else savings vs other printings. Higher is better.
    public static func dealScore(_ c: Comparison) -> Double? { c.marketGap ?? c.premium.map { -$0 } }

    public static func sortGroups(_ groups: [SecretLairGroup], by: GroupSort, cards: [String: CardSummary], reprints: [String: ReprintPrice] = [:]) -> [SecretLairGroup] {
        let when: (SecretLairGroup) -> String = { $0.saleStart ?? $0.releasedAt }
        switch by {
        case .soonest:
            return groups.sorted { when($0) != when($1) ? when($0) < when($1) : $0.key < $1.key }
        case .latest:
            return groups.sorted { when($0) != when($1) ? when($0) > when($1) : $0.key > $1.key }
        case .name:
            return groups.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        default:
            break
        }
        // Lower key sorts first; missing values go last.
        var keys: [String: Double] = [:]
        for g in groups {
            var k: Double?
            switch by {
            case .deal: k = dealScore(compare(g.cardIds, cards: cards, reprints: reprints, price: g.price)).map { -$0 }
            case .value:
                let v = value(g.cardIds, cards: cards)
                k = v.priced > 0 ? -v.total : nil
            case .price: k = g.price
            case .announced: k = g.announcedAt.flatMap(dayDate).map { -$0.timeIntervalSince1970 }
            default: k = nil
            }
            keys[g.key] = k ?? .infinity
        }
        return groups.sorted { a, b in
            let x = keys[a.key] ?? .infinity, y = keys[b.key] ?? .infinity
            return x != y ? x < y : when(a) < when(b)
        }
    }

    public enum DropSort: String, CaseIterable, Sendable {
        case sale = "Sale time"
        case added = "Recently added"
        case ready = "Least ready first"
        case name = "Name"
    }

    public static func sortDrops(_ drops: [SecretLairDrop], by: DropSort) -> [SecretLairDrop] {
        switch by {
        case .name: return drops.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        case .added: return drops.sorted { $0.createdAt > $1.createdAt }
        case .ready:
            return drops.sorted { a, b in
                let x = readiness(a), y = readiness(b)
                return x != y ? x < y : (a.saleStart ?? "9") < (b.saleStart ?? "9")
            }
        case .sale: return drops.sorted { ($0.saleStart ?? "9") < ($1.saleStart ?? "9") }
        }
    }
}
