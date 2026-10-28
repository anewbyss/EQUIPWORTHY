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
    public var cardIds: [String]
    public var marked: Bool
    public var checklist: [String: Bool]
    public var remindersSent: [String]
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
    public var id: String { key }
}

public struct SecretLairCatalog: Codable, Hashable, Sendable {
    public var cards: [String: CardSummary]
    public var groups: [SecretLairGroup]
    public var fetchedAt: String
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
            groups.append(SecretLairGroup(key: "\(released)#\(first)", name: label, releasedAt: released, cardIds: current.map(\.id)))
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
}
