import Foundation

// Shared data model. JSON is identical to the web app's (web/src/lib/types.ts),
// so a backup exported on one platform imports on the other.

public let currentSchemaVersion = 1

public enum Finish: String, Codable, CaseIterable, Identifiable, Sendable {
    case nonfoil, foil, etched
    public var id: String { rawValue }
    public var label: String { rawValue.capitalized }
}

public enum Condition: String, Codable, CaseIterable, Identifiable, Sendable {
    case NM, LP, MP, HP, DMG
    public var id: String { rawValue }
}

public enum Board: String, Codable, CaseIterable, Identifiable, Sendable {
    case commander, main, side, maybe
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .commander: return "Commander"
        case .main: return "Main deck"
        case .side: return "Sideboard"
        case .maybe: return "Maybeboard"
        }
    }
}

public enum Format: String, Codable, CaseIterable, Identifiable, Sendable {
    case commander, standard, pioneer, modern, legacy, vintage, pauper, limited
    public var id: String { rawValue }
}

public struct Prices: Codable, Hashable, Sendable {
    public var usd: Double?
    public var usdFoil: Double?
    public var usdEtched: Double?
    public init(usd: Double? = nil, usdFoil: Double? = nil, usdEtched: Double? = nil) {
        self.usd = usd; self.usdFoil = usdFoil; self.usdEtched = usdEtched
    }
}

public struct CardSummary: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var oracleId: String?
    public var name: String
    public var set: String
    public var setName: String
    public var collectorNumber: String
    public var rarity: String
    public var typeLine: String
    public var manaCost: String?
    public var cmc: Double
    public var colors: [String]
    public var colorIdentity: [String]
    public var image: String?
    public var imageSmall: String?
    public var releasedAt: String
    public var reserved: Bool
    public var reprint: Bool
    public var edhrecRank: Int?
    public var legalities: [String: String]
    public var prices: Prices
    public var finishes: [Finish]
    public var tcgplayerUrl: String?
    public var edhrecUrl: String?
    public var scryfallUrl: String?
    public var oracleText: String?
    public var printsCount: Int?
    public var keywords: [String]?
    public var fetchedAt: String

    public init(id: String, oracleId: String? = nil, name: String, set: String, setName: String = "", collectorNumber: String,
                rarity: String = "common", typeLine: String = "", manaCost: String? = nil, cmc: Double = 0,
                colors: [String] = [], colorIdentity: [String] = [], image: String? = nil, imageSmall: String? = nil,
                releasedAt: String = "2000-01-01", reserved: Bool = false, reprint: Bool = false, edhrecRank: Int? = nil,
                legalities: [String: String] = [:], prices: Prices = Prices(), finishes: [Finish] = [.nonfoil],
                tcgplayerUrl: String? = nil, edhrecUrl: String? = nil, scryfallUrl: String? = nil, oracleText: String? = nil,
                printsCount: Int? = nil, keywords: [String]? = nil, fetchedAt: String = "") {
        self.id = id; self.oracleId = oracleId; self.name = name; self.set = set; self.setName = setName
        self.collectorNumber = collectorNumber; self.rarity = rarity; self.typeLine = typeLine; self.manaCost = manaCost
        self.cmc = cmc; self.colors = colors; self.colorIdentity = colorIdentity; self.image = image; self.imageSmall = imageSmall
        self.releasedAt = releasedAt; self.reserved = reserved; self.reprint = reprint; self.edhrecRank = edhrecRank
        self.legalities = legalities; self.prices = prices; self.finishes = finishes; self.tcgplayerUrl = tcgplayerUrl
        self.edhrecUrl = edhrecUrl; self.scryfallUrl = scryfallUrl; self.oracleText = oracleText
        self.printsCount = printsCount; self.keywords = keywords; self.fetchedAt = fetchedAt
    }

    public func price(_ finish: Finish) -> Double? {
        switch finish {
        case .foil: return prices.usdFoil ?? prices.usd
        case .etched: return prices.usdEtched ?? prices.usdFoil ?? prices.usd
        case .nonfoil: return prices.usd ?? prices.usdFoil
        }
    }
}

public struct CollectionItem: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var cardId: String
    public var name: String
    public var set: String
    public var collectorNumber: String
    public var finish: Finish
    public var condition: Condition
    public var language: String
    public var quantity: Int
    public var purchasePrice: Double?
    public var purchaseDate: String?
    public var binder: String
    public var location: String?
    public var addedAt: String

    public init(id: String = UUID().uuidString, cardId: String, name: String, set: String, collectorNumber: String,
                finish: Finish = .nonfoil, condition: Condition = .NM, language: String = "en", quantity: Int = 1,
                purchasePrice: Double? = nil, purchaseDate: String? = nil, binder: String = "Main", location: String? = nil,
                addedAt: String = isoNow()) {
        self.id = id; self.cardId = cardId; self.name = name; self.set = set; self.collectorNumber = collectorNumber
        self.finish = finish; self.condition = condition; self.language = language; self.quantity = quantity
        self.purchasePrice = purchasePrice; self.purchaseDate = purchaseDate; self.binder = binder
        self.location = location; self.addedAt = addedAt
    }
}

public struct WishItem: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var cardId: String
    public var name: String
    public var finish: Finish
    public var quantity: Int
    public var maxPrice: Double?
    public var addedAt: String
    public init(id: String = UUID().uuidString, cardId: String, name: String, finish: Finish, quantity: Int = 1, maxPrice: Double? = nil, addedAt: String = isoNow()) {
        self.id = id; self.cardId = cardId; self.name = name; self.finish = finish; self.quantity = quantity; self.maxPrice = maxPrice; self.addedAt = addedAt
    }
}

public struct DeckCard: Codable, Hashable, Sendable {
    public var cardId: String
    public var name: String
    public var quantity: Int
    public var board: Board
    public init(cardId: String, name: String, quantity: Int, board: Board) {
        self.cardId = cardId; self.name = name; self.quantity = quantity; self.board = board
    }
}

public struct Deck: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var format: Format
    public var cards: [DeckCard]
    public var notes: String?
    public var source: String?
    public var createdAt: String
    public var updatedAt: String
    public init(id: String = UUID().uuidString, name: String, format: Format, cards: [DeckCard] = [], notes: String? = nil, source: String? = nil) {
        self.id = id; self.name = name; self.format = format; self.cards = cards; self.notes = notes; self.source = source
        self.createdAt = isoNow(); self.updatedAt = isoNow()
    }
}

public struct WatchItem: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var cardId: String
    public var name: String
    public var finish: Finish
    public var below: Double?
    public var above: Double?
    public var pctMove: Double?
    public var addedAt: String
    public init(id: String = UUID().uuidString, cardId: String, name: String, finish: Finish, below: Double? = nil, above: Double? = nil, pctMove: Double? = nil) {
        self.id = id; self.cardId = cardId; self.name = name; self.finish = finish
        self.below = below; self.above = above; self.pctMove = pctMove; self.addedAt = isoNow()
    }
}

public struct PriceAlert: Codable, Hashable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable { case below, above, move, spike, crash }
    public var id: String
    public var cardId: String
    public var name: String
    public var kind: Kind
    public var message: String
    public var createdAt: String
    public var read: Bool
}

public struct TradeSideCard: Codable, Hashable, Sendable {
    public var cardId: String
    public var name: String
    public var finish: Finish
    public var quantity: Int
    public var price: Double
    public init(cardId: String, name: String, finish: Finish, quantity: Int = 1, price: Double) {
        self.cardId = cardId; self.name = name; self.finish = finish; self.quantity = quantity; self.price = price
    }
}

public struct Trade: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var mine: [TradeSideCard]
    public var theirs: [TradeSideCard]
    public var mineCash: Double
    public var theirsCash: Double
    public var createdAt: String
    public var updatedAt: String
    public init(name: String) {
        id = UUID().uuidString; self.name = name; mine = []; theirs = []; mineCash = 0; theirsCash = 0
        createdAt = isoNow(); updatedAt = isoNow()
    }
}

public struct ForecastLogEntry: Codable, Hashable, Sendable {
    public var cardId: String
    public var finish: Finish
    public var madeOn: String
    public var horizonDays: Int
    public var startPrice: Double
    public var expectedPct: Double
    public var resolvedPct: Double?
}

/// Encoded as a two-element JSON array `["2026-10-27", 12.34]`, matching the web app.
public struct PricePoint: Codable, Hashable, Sendable {
    public var date: String
    public var price: Double
    public init(_ date: String, _ price: Double) { self.date = date; self.price = price }
    public init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        date = try c.decode(String.self)
        price = try c.decode(Double.self)
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.unkeyedContainer()
        try c.encode(date)
        try c.encode(price)
    }
}

public typealias PriceSeries = [PricePoint]

public struct AppSettings: Codable, Hashable, Sendable {
    public var autosaveSeconds: Int = 20
    public var buylistCashPct: Double = 50
    public var buylistCreditPct: Double = 65
    public var defaultCondition: Condition = .NM
    public var defaultBinder: String = "Main"
    public var conditionMultipliers: [String: Double] = ["NM": 1, "LP": 0.9, "MP": 0.75, "HP": 0.55, "DMG": 0.35]
    public var autoRefreshHours: Double = 24
    public var notifications: Bool = true
    /// Fast-mover detection: % move in 1 day / 7 days that counts as a spike or crash.
    public var spikePct1d: Double = 15
    public var spikePct7d: Double = 25
    /// Ignore moves on cards cheaper than this (bulk noise).
    public var moverMinPrice: Double = 1
    /// Daily scan of popular Commander cards for market-wide movers and synergy picks.
    public var marketScan: Bool = true
    public var marketUniverse: Int = 525
    /// Push alerts through the free ntfy app.
    public var ntfyEnabled: Bool = false
    public var ntfyServer: String = "https://ntfy.sh"
    public var ntfyTopic: String?
    /// Text messages through your own EquipWorthy SMS worker (Twilio).
    public var smsEnabled: Bool = false
    public var smsWorkerUrl: String?
    public var smsKey: String?

    public init() {}

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = AppSettings()
        autosaveSeconds = try c.decodeIfPresent(Int.self, forKey: .autosaveSeconds) ?? d.autosaveSeconds
        buylistCashPct = try c.decodeIfPresent(Double.self, forKey: .buylistCashPct) ?? d.buylistCashPct
        buylistCreditPct = try c.decodeIfPresent(Double.self, forKey: .buylistCreditPct) ?? d.buylistCreditPct
        defaultCondition = try c.decodeIfPresent(Condition.self, forKey: .defaultCondition) ?? d.defaultCondition
        defaultBinder = try c.decodeIfPresent(String.self, forKey: .defaultBinder) ?? d.defaultBinder
        conditionMultipliers = try c.decodeIfPresent([String: Double].self, forKey: .conditionMultipliers) ?? d.conditionMultipliers
        autoRefreshHours = try c.decodeIfPresent(Double.self, forKey: .autoRefreshHours) ?? d.autoRefreshHours
        notifications = try c.decodeIfPresent(Bool.self, forKey: .notifications) ?? d.notifications
        spikePct1d = try c.decodeIfPresent(Double.self, forKey: .spikePct1d) ?? d.spikePct1d
        spikePct7d = try c.decodeIfPresent(Double.self, forKey: .spikePct7d) ?? d.spikePct7d
        moverMinPrice = try c.decodeIfPresent(Double.self, forKey: .moverMinPrice) ?? d.moverMinPrice
        marketScan = try c.decodeIfPresent(Bool.self, forKey: .marketScan) ?? d.marketScan
        marketUniverse = try c.decodeIfPresent(Int.self, forKey: .marketUniverse) ?? d.marketUniverse
        ntfyEnabled = try c.decodeIfPresent(Bool.self, forKey: .ntfyEnabled) ?? d.ntfyEnabled
        ntfyServer = try c.decodeIfPresent(String.self, forKey: .ntfyServer) ?? d.ntfyServer
        ntfyTopic = try c.decodeIfPresent(String.self, forKey: .ntfyTopic)
        smsEnabled = try c.decodeIfPresent(Bool.self, forKey: .smsEnabled) ?? d.smsEnabled
        smsWorkerUrl = try c.decodeIfPresent(String.self, forKey: .smsWorkerUrl)
        smsKey = try c.decodeIfPresent(String.self, forKey: .smsKey)
    }

    public func multiplier(_ c: Condition) -> Double { conditionMultipliers[c.rawValue] ?? 1 }
}

public struct PendingRow: Codable, Hashable, Identifiable, Sendable {
    public enum Status: String, Codable, Sendable { case ok, fuzzy, notfound }
    public enum Source: String, Codable, Sendable { case list, grid, csv, scan }
    public var key: String
    public var raw: String
    public var status: Status
    public var cardId: String?
    public var name: String
    public var set: String?
    public var collectorNumber: String?
    public var finish: Finish
    public var condition: Condition
    public var language: String
    public var quantity: Int
    public var purchasePrice: Double?
    public var board: Board?
    public var source: Source
    public var id: String { key }

    public init(raw: String, status: Status, card: CardSummary?, line: BatchLine, condition: Condition, source: Source) {
        key = UUID().uuidString
        self.raw = raw
        self.status = status
        cardId = card?.id
        name = card?.name ?? line.name
        set = card?.set ?? line.set
        collectorNumber = card?.collectorNumber ?? line.collectorNumber
        if let card, !card.finishes.contains(line.finish) { finish = card.finishes.first ?? line.finish } else { finish = line.finish }
        self.condition = line.condition ?? condition
        language = line.language ?? "en"
        quantity = max(1, line.quantity)
        purchasePrice = line.purchasePrice
        board = line.board
        self.source = source
    }
}

public struct Profile: Codable, Hashable, Identifiable, Sendable {
    public var schemaVersion: Int
    public var id: String
    public var name: String
    public var createdAt: String
    public var updatedAt: String
    public var settings: AppSettings
    public var binders: [String]
    public var collection: [CollectionItem]
    public var wishlist: [WishItem]
    public var decks: [Deck]
    public var watchlist: [WatchItem]
    public var alerts: [PriceAlert]
    public var trades: [Trade]
    public var priceHistory: [String: PriceSeries]
    public var portfolioHistory: PriceSeries
    public var forecastLog: [ForecastLogEntry]
    public var cardCache: [String: CardSummary]
    public var lastPriceRefresh: String?
    public var pendingBatch: [PendingRow]?
    /// Current life-tracker game, saved so a game survives closing the app.
    public var game: GameState?
    /// Market-wide price watch and synergy picks. Rebuilt on each device, not synced.
    public var market: MarketData?
    /// Secret Lair drops you've marked or added (synced).
    public var secretLair: [SecretLairDrop]?
    /// Recent Secret Lair cards from Scryfall, grouped into drops. Not synced.
    public var secretLairCatalog: SecretLairCatalog?

    public init(name: String) {
        schemaVersion = currentSchemaVersion
        id = UUID().uuidString
        self.name = name
        createdAt = isoNow(); updatedAt = isoNow()
        settings = AppSettings()
        binders = ["Main", "Trade Binder"]
        collection = []; wishlist = []; decks = []; watchlist = []; alerts = []; trades = []
        priceHistory = [:]; portfolioHistory = []; forecastLog = []; cardCache = [:]
    }

    /// Tolerant decoding: any missing field falls back to its default (older backups).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = Profile(name: "Imported")
        schemaVersion = currentSchemaVersion
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? d.id
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? d.name
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? d.createdAt
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? d.updatedAt
        settings = try c.decodeIfPresent(AppSettings.self, forKey: .settings) ?? d.settings
        binders = try c.decodeIfPresent([String].self, forKey: .binders) ?? d.binders
        collection = try c.decodeIfPresent([CollectionItem].self, forKey: .collection) ?? []
        wishlist = try c.decodeIfPresent([WishItem].self, forKey: .wishlist) ?? []
        decks = try c.decodeIfPresent([Deck].self, forKey: .decks) ?? []
        watchlist = try c.decodeIfPresent([WatchItem].self, forKey: .watchlist) ?? []
        alerts = try c.decodeIfPresent([PriceAlert].self, forKey: .alerts) ?? []
        trades = try c.decodeIfPresent([Trade].self, forKey: .trades) ?? []
        priceHistory = try c.decodeIfPresent([String: PriceSeries].self, forKey: .priceHistory) ?? [:]
        portfolioHistory = try c.decodeIfPresent(PriceSeries.self, forKey: .portfolioHistory) ?? []
        forecastLog = try c.decodeIfPresent([ForecastLogEntry].self, forKey: .forecastLog) ?? []
        cardCache = try c.decodeIfPresent([String: CardSummary].self, forKey: .cardCache) ?? [:]
        lastPriceRefresh = try c.decodeIfPresent(String.self, forKey: .lastPriceRefresh)
        pendingBatch = try c.decodeIfPresent([PendingRow].self, forKey: .pendingBatch)
        game = try c.decodeIfPresent(GameState.self, forKey: .game)
        market = try? c.decodeIfPresent(MarketData.self, forKey: .market)
        secretLair = try c.decodeIfPresent([SecretLairDrop].self, forKey: .secretLair)
        secretLairCatalog = try? c.decodeIfPresent(SecretLairCatalog.self, forKey: .secretLairCatalog)
    }

    public func card(_ id: String) -> CardSummary? { cardCache[id] }
    public func price(_ cardId: String, _ finish: Finish) -> Double? { cardCache[cardId]?.price(finish) }
    public func history(_ cardId: String, _ finish: Finish) -> PriceSeries { priceHistory[historyKey(cardId, finish)] ?? [] }
}

public func historyKey(_ cardId: String, _ finish: Finish) -> String { "\(cardId):\(finish.rawValue)" }

private let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

public func isoNow(_ date: Date = Date()) -> String { isoFormatter.string(from: date) }

public func parseISO(_ s: String) -> Date? {
    if let d = isoFormatter.date(from: s) { return d }
    let f = ISO8601DateFormatter()
    if let d = f.date(from: s) { return d }
    return dayDate(String(s.prefix(10)))
}

private let dayFormatter: DateFormatter = {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "UTC")
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

/// YYYY-MM-DD in UTC (matches the web app's `toISOString().slice(0, 10)`).
public func dayString(_ date: Date = Date()) -> String { dayFormatter.string(from: date) }
public func dayDate(_ s: String) -> Date? { dayFormatter.date(from: s) }

public func daysBetween(_ a: String, _ b: String) -> Int {
    guard let da = dayDate(String(a.prefix(10))), let db = dayDate(String(b.prefix(10))) else { return 0 }
    return Int((db.timeIntervalSince(da) / 86_400).rounded())
}

public extension Double {
    var usd: String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.locale = Locale(identifier: "en_US")
        return f.string(from: NSNumber(value: self)) ?? "$\(self)"
    }
    var signedPct: String { String(format: "%@%.1f%%", self > 0 ? "+" : "", self) }
}

public extension Optional where Wrapped == Double {
    var usd: String { self.map(\.usd) ?? "—" }
}
