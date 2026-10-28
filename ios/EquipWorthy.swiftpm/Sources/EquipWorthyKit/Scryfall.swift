import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// Scryfall API client. Requests are spaced >= 110ms apart (Scryfall asks for
// <= 10/s). Port of web/src/lib/scryfall.ts.

public struct ScryfallError: Error, LocalizedError, Sendable {
    public var status: Int
    public var message: String
    public var errorDescription: String? { message }
}

public struct SetInfo: Codable, Hashable, Identifiable, Sendable {
    public var code: String
    public var name: String
    public var released_at: String?
    public var set_type: String
    public var card_count: Int
    public var icon_svg_uri: String?
    public var digital: Bool?
    public var id: String { code }
}

public enum ScryfallIdentifier: Hashable, Sendable {
    case id(String)
    case setNumber(set: String, number: String)
    case name(String, set: String?)

    var json: [String: String] {
        switch self {
        case .id(let id): return ["id": id]
        case .setNumber(let s, let n): return ["set": s, "collector_number": n]
        case .name(let n, let s): return s.map { ["name": n, "set": $0] } ?? ["name": n]
        }
    }
}

struct RawCard: Decodable {
    struct ImageURIs: Decodable { var normal: String?; var small: String? }
    struct Face: Decodable { var image_uris: ImageURIs?; var type_line: String?; var mana_cost: String?; var oracle_text: String?; var colors: [String]? }
    struct RawPrices: Decodable { var usd: String?; var usd_foil: String?; var usd_etched: String? }
    struct Purchase: Decodable { var tcgplayer: String? }
    struct Related: Decodable { var edhrec: String? }
    var id: String
    var oracle_id: String?
    var name: String
    var set: String
    var set_name: String
    var collector_number: String
    var rarity: String
    var type_line: String?
    var mana_cost: String?
    var cmc: Double?
    var colors: [String]?
    var color_identity: [String]?
    var image_uris: ImageURIs?
    var card_faces: [Face]?
    var released_at: String
    var reserved: Bool?
    var reprint: Bool?
    var edhrec_rank: Int?
    var legalities: [String: String]?
    var prices: RawPrices?
    var finishes: [String]?
    var purchase_uris: Purchase?
    var related_uris: Related?
    var scryfall_uri: String?
    var oracle_text: String?
    var keywords: [String]?
    struct Preview: Decodable { var source: String?; var source_uri: String?; var previewed_at: String? }
    var preview: Preview?

    var summary: CardSummary {
        let face = card_faces?.first
        let num: (String?) -> Double? = { $0.flatMap(Double.init) }
        return CardSummary(
            id: id, oracleId: oracle_id, name: name, set: set, setName: set_name, collectorNumber: collector_number,
            rarity: rarity, typeLine: type_line ?? face?.type_line ?? "", manaCost: mana_cost ?? face?.mana_cost, cmc: cmc ?? 0,
            colors: colors ?? face?.colors ?? [], colorIdentity: color_identity ?? [],
            image: image_uris?.normal ?? face?.image_uris?.normal, imageSmall: image_uris?.small ?? face?.image_uris?.small,
            releasedAt: released_at, reserved: reserved ?? false, reprint: reprint ?? false, edhrecRank: edhrec_rank,
            legalities: legalities ?? [:],
            prices: Prices(usd: num(prices?.usd), usdFoil: num(prices?.usd_foil), usdEtched: num(prices?.usd_etched)),
            finishes: (finishes ?? ["nonfoil"]).compactMap(Finish.init(rawValue:)),
            tcgplayerUrl: purchase_uris?.tcgplayer, edhrecUrl: related_uris?.edhrec, scryfallUrl: scryfall_uri,
            oracleText: oracle_text ?? card_faces?.compactMap(\.oracle_text).joined(separator: "\n//\n"),
            keywords: keywords,
            preview: preview.map { p in
                CardPreview(source: p.source, url: p.source_uri.flatMap { $0.lowercased().hasPrefix("https://") ? $0 : nil }, at: p.previewed_at)
            },
            fetchedAt: isoNow())
    }
}

struct ListResponse<T: Decodable>: Decodable {
    var data: [T]
    var has_more: Bool?
    var total_cards: Int?
    var not_found: [[String: String]]?
}

public actor Scryfall {
    public static let shared = Scryfall()
    private let base = URL(string: "https://api.scryfall.com")!
    private var last = Date.distantPast
    private let session: URLSession

    public init(session: URLSession = .shared) { self.session = session }

    private func throttle() async {
        let wait = 0.11 - Date().timeIntervalSince(last)
        if wait > 0 { try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000)) }
        last = Date()
    }

    private func send<T: Decodable>(_ req: URLRequest, _ type: T.Type) async throws -> T {
        await throttle()
        var r = req
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("EquipWorthy/1.0", forHTTPHeaderField: "User-Agent")
        let (data, resp) = try await session.data(for: r)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let details = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["details"] as? String
            throw ScryfallError(status: status, message: details ?? "Scryfall error \(status)")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func get<T: Decodable>(_ path: String, _ query: [String: String] = [:], decoding t: T.Type) async throws -> T {
        var c = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { c.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        return try await send(URLRequest(url: c.url!), t)
    }

    public func search(_ q: String, unique: String = "cards", order: String = "name", dir: String? = nil, page: Int = 1) async throws -> (cards: [CardSummary], total: Int, hasMore: Bool) {
        do {
            var query = ["q": q, "unique": unique, "order": order, "page": String(page)]
            if let dir { query["dir"] = dir }
            let r = try await get("cards/search", query, decoding: ListResponse<RawCard>.self)
            return (r.data.map(\.summary), r.total_cards ?? r.data.count, r.has_more ?? false)
        } catch let e as ScryfallError where e.status == 404 {
            return ([], 0, false)
        }
    }

    public func autocomplete(_ q: String) async throws -> [String] {
        guard q.trimmed.count >= 2 else { return [] }
        struct R: Decodable { var data: [String] }
        return try await get("cards/autocomplete", ["q": q], decoding: R.self).data
    }

    public func named(_ name: String, fuzzy: Bool = true, set: String? = nil) async throws -> CardSummary {
        var q: [String: String] = [(fuzzy ? "fuzzy" : "exact"): name]
        if let set { q["set"] = set }
        return try await get("cards/named", q, decoding: RawCard.self).summary
    }

    public func card(set: String, number: String) async throws -> CardSummary {
        try await get("cards/\(set.lowercased())/\(number)", decoding: RawCard.self).summary
    }

    public func card(id: String) async throws -> CardSummary {
        try await get("cards/\(id)", decoding: RawCard.self).summary
    }

    public func prints(_ card: CardSummary) async throws -> [CardSummary] {
        guard let o = card.oracleId else { return [card] }
        return try await search("oracleid:\(o)", unique: "prints", order: "released").cards
    }

    /// Resolve identifiers in chunks of 75 (Scryfall's limit).
    public func collection(_ ids: [ScryfallIdentifier]) async throws -> [CardSummary] {
        var found: [CardSummary] = []
        var i = 0
        while i < ids.count {
            let chunk = Array(ids[i..<min(ids.count, i + 75)])
            var req = URLRequest(url: base.appendingPathComponent("cards/collection"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: ["identifiers": chunk.map(\.json)])
            found += try await send(req, ListResponse<RawCard>.self).data.map(\.summary)
            i += 75
        }
        return found
    }

    public func sets() async throws -> [SetInfo] {
        try await get("sets", decoding: ListResponse<SetInfo>.self).data
    }

    public func setCards(_ code: String, page: Int = 1) async throws -> (cards: [CardSummary], total: Int, hasMore: Bool) {
        try await search("e:\(code)", unique: "prints", order: "set", page: page)
    }

    /// Bulk-data download URL for the offline card database ("oracle_cards").
    public func bulkURL(type: String = "oracle_cards") async throws -> URL {
        struct Item: Decodable { var type: String; var download_uri: String }
        let items = try await get("bulk-data", decoding: ListResponse<Item>.self).data
        guard let s = items.first(where: { $0.type == type })?.download_uri, let u = URL(string: s) else {
            throw ScryfallError(status: 404, message: "Bulk data not found")
        }
        return u
    }

    /// Decode Scryfall bulk JSON (array of cards) into summaries.
    public nonisolated static func decodeBulk(_ data: Data) throws -> [CardSummary] {
        try JSONDecoder().decode([RawCard].self, from: data).map(\.summary)
    }
}

// MARK: - Resolving batch lines

public struct ResolvedLine: Sendable {
    public var line: BatchLine
    public var card: CardSummary?
    public var status: PendingRow.Status
}

public enum Resolver {
    static func identifier(_ l: BatchLine) -> ScryfallIdentifier? {
        if let id = l.scryfallId { return .id(id) }
        if let s = l.set, let n = l.collectorNumber { return .setNumber(set: s, number: n) }
        if !l.name.isEmpty { return .name(l.name, set: l.set) }
        return nil
    }

    static func norm(_ s: String) -> String { s.lowercased().filter { $0.isLetter || $0.isNumber } }

    static func matches(_ c: CardSummary, _ id: ScryfallIdentifier) -> Bool {
        switch id {
        case .id(let i): return c.id == i
        case .setNumber(let s, let n): return c.set == s.lowercased() && c.collectorNumber == n
        case .name(let n, let s):
            let nameOK = norm(c.name) == norm(n) || c.name.components(separatedBy: " // ").contains { norm($0) == norm(n) }
            return nameOK && (s == nil || c.set == s!.lowercased())
        }
    }

    public static func resolve(_ lines: [BatchLine], client: Scryfall = .shared, maxFuzzy: Int = 40) async throws -> [ResolvedLine] {
        let ids = lines.map(identifier)
        var unique: [ScryfallIdentifier] = []
        for case let i? in ids where !unique.contains(i) { unique.append(i) }
        let found = try await client.collection(unique)
        var out = lines.enumerated().map { (i, line) -> ResolvedLine in
            let card = ids[i].flatMap { id in found.first { matches($0, id) } }
            return ResolvedLine(line: line, card: card, status: card == nil ? .notfound : .ok)
        }
        var fuzzyCache: [String: CardSummary?] = [:]
        var fuzzyCount = 0
        for i in out.indices where out[i].card == nil && !out[i].line.name.isEmpty && fuzzyCount < maxFuzzy {
            let k = norm(out[i].line.name) + "|" + (out[i].line.set ?? "")
            if fuzzyCache[k] == nil {
                fuzzyCount += 1
                var c = try? await client.named(out[i].line.name, fuzzy: true, set: out[i].line.set)
                if c == nil, out[i].line.set != nil { c = try? await client.named(out[i].line.name, fuzzy: true) }
                fuzzyCache[k] = .some(c)
            }
            if let c = fuzzyCache[k] ?? nil {
                out[i].card = c
                out[i].status = .fuzzy
            }
        }
        return out
    }
}
