import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// EDHREC and Moxfield. Neither has an official public API: these use the JSON
// endpoints their own sites use and every caller treats failure as normal.

public struct EDHRECInfo: Sendable {
    public var numDecks: Int?
    public var potentialDecks: Int?
    public var topCommanders: [String]
    public var synergies: [String]
    public var url: URL
    public var inclusionPct: Double? {
        guard let n = numDecks, let p = potentialDecks, p > 0 else { return nil }
        return 100 * Double(n) / Double(p)
    }
}

public enum EDHREC {
    public static func slug(_ name: String) -> String {
        let front = name.components(separatedBy: " // ").first ?? name
        let folded = front.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .init(identifier: "en_US")).lowercased()
        let kept = folded.filter { $0.isLetter || $0.isNumber || $0 == " " || $0 == "-" }
        return kept.trimmed.components(separatedBy: .whitespaces).filter { !$0.isEmpty }.joined(separator: "-")
    }

    public static func cardURL(_ name: String) -> URL { URL(string: "https://edhrec.com/cards/\(slug(name))")! }
    public static func commanderURL(_ name: String) -> URL { URL(string: "https://edhrec.com/commanders/\(slug(name))")! }

    public static func cardInfo(_ name: String) async -> EDHRECInfo? {
        guard let url = URL(string: "https://json.edhrec.com/pages/cards/\(slug(name)).json"),
              let res = try? await URLSession.shared.data(from: url),
              (res.1 as? HTTPURLResponse)?.statusCode == 200,
              let j = try? JSONSerialization.jsonObject(with: res.0) as? [String: Any],
              let dict = (j["container"] as? [String: Any])?["json_dict"] as? [String: Any] else { return nil }
        let card = dict["card"] as? [String: Any] ?? [:]
        let lists = dict["cardlists"] as? [[String: Any]] ?? []
        func names(_ match: String) -> [String] {
            let l = lists.first { (($0["header"] as? String) ?? ($0["tag"] as? String) ?? "").range(of: match, options: [.regularExpression, .caseInsensitive]) != nil }
            return ((l?["cardviews"] as? [[String: Any]]) ?? []).prefix(8).compactMap { $0["name"] as? String }
        }
        return EDHRECInfo(numDecks: card["num_decks"] as? Int, potentialDecks: card["potential_decks"] as? Int,
                          topCommanders: names("commander"), synergies: names("synerg|high"), url: cardURL(name))
    }
}

public enum Moxfield {
    public static func deckId(from url: String) -> String? {
        Rx.first("moxfield\\.com/decks/([A-Za-z0-9_-]+)", in: url)?[1]
    }

    public struct DeckImport: Sendable {
        public var name: String
        public var format: String
        public var lines: [BatchLine]
    }

    public static func fetchDeck(_ url: String) async throws -> DeckImport {
        guard let id = deckId(from: url), let api = URL(string: "https://api2.moxfield.com/v3/decks/all/\(id)") else {
            throw ScryfallError(status: 400, message: "Not a Moxfield deck URL")
        }
        var req = URLRequest(url: api)
        req.setValue("EquipWorthy/1.0", forHTTPHeaderField: "User-Agent")
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200, let j = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ScryfallError(status: status, message: "Moxfield returned \(status). Paste the deck's exported text instead.")
        }
        let boards = j["boards"] as? [String: Any] ?? [:]
        let map: [String: Board] = ["commanders": .commander, "mainboard": .main, "sideboard": .side, "maybeboard": .maybe]
        var lines: [BatchLine] = []
        for (boardName, value) in boards {
            guard let b = map[boardName], let cards = (value as? [String: Any])?["cards"] as? [String: Any] else { continue }
            for entry in cards.values {
                guard let e = entry as? [String: Any], let card = e["card"] as? [String: Any], let name = card["name"] as? String else { continue }
                lines.append(BatchLine(raw: name, quantity: e["quantity"] as? Int ?? 1, name: name, set: card["set"] as? String,
                                       collectorNumber: card["cn"] as? String, scryfallId: card["scryfall_id"] as? String, board: b))
            }
        }
        return DeckImport(name: j["name"] as? String ?? "Moxfield deck", format: j["format"] as? String ?? "commander", lines: lines)
    }
}
