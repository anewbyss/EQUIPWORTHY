import Foundation

// Deck statistics, legality, draw odds and buylist math. Port of web/src/lib/deckstats.ts.

public enum DeckStats {
    public static func choose(_ n: Int, _ k: Int) -> Double {
        if k < 0 || k > n { return 0 }
        let k = min(k, n - k)
        var r = 1.0
        if k > 0 { for i in 1...k { r = r * Double(n - k + i) / Double(i) } }
        return r
    }

    public static func hypergeom(N: Int, K: Int, n: Int, k: Int) -> Double {
        choose(K, k) * choose(N - K, n - k) / choose(N, n)
    }

    /// Probability of at least `k` hits drawing `n` from `N` cards containing `K` hits.
    public static func atLeast(N: Int, K: Int, n: Int, k: Int) -> Double {
        guard N > 0, n <= N else { return 0 }
        var p = 0.0
        let upper = min(n, K)
        if k <= upper { for i in k...upper { p += hypergeom(N: N, K: K, n: n, k: i) } }
        return min(1, p)
    }

    struct Rule { let min: Int; let max: Int?; let copies: Int; let side: Int? }
    static let rules: [Format: Rule] = [
        .commander: Rule(min: 100, max: 100, copies: 1, side: nil),
        .standard: Rule(min: 60, max: nil, copies: 4, side: 15),
        .pioneer: Rule(min: 60, max: nil, copies: 4, side: 15),
        .modern: Rule(min: 60, max: nil, copies: 4, side: 15),
        .legacy: Rule(min: 60, max: nil, copies: 4, side: 15),
        .vintage: Rule(min: 60, max: nil, copies: 4, side: 15),
        .pauper: Rule(min: 60, max: nil, copies: 4, side: 15),
        .limited: Rule(min: 40, max: nil, copies: Int.max, side: nil),
    ]

    static func isBasic(_ c: CardSummary?, _ name: String) -> Bool {
        (c?.typeLine ?? "").contains("Basic Land") || ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].contains(name)
    }

    public static func legality(_ deck: Deck, cards: [String: CardSummary]) -> [String] {
        var issues: [String] = []
        guard let r = rules[deck.format] else { return issues }
        let main = deck.cards.filter { $0.board == .main || $0.board == .commander }
        let side = deck.cards.filter { $0.board == .side }
        let count = main.reduce(0) { $0 + $1.quantity }
        let sideCount = side.reduce(0) { $0 + $1.quantity }
        if count < r.min { issues.append("Deck has \(count) cards; \(deck.format.rawValue) needs \(r.min)\(r.max == r.min ? " exactly" : "+").") }
        if let max = r.max, count > max { issues.append("Deck has \(count) cards; max is \(max).") }
        if let s = r.side, sideCount > s { issues.append("Sideboard has \(sideCount) cards; max is \(s).") }

        var byName: [String: Int] = [:]
        for c in main + side { byName[c.name, default: 0] += c.quantity }
        for (name, n) in byName.sorted(by: { $0.key < $1.key }) {
            let card = cards.values.first { $0.name == name }
            let anyNumber = (card?.oracleText ?? "").range(of: "A deck can have any number of cards named", options: .caseInsensitive) != nil
            if n > r.copies && !isBasic(card, name) && !anyNumber { issues.append("\(n)× \(name) (limit \(r.copies)).") }
        }

        if deck.format != .limited {
            for c in deck.cards where c.board != .maybe {
                if let status = cards[c.cardId]?.legalities[deck.format.rawValue], status != "legal", !(status == "restricted" && c.quantity == 1) {
                    issues.append("\(c.name) is \(status.replacingOccurrences(of: "_", with: " ")) in \(deck.format.rawValue).")
                }
            }
        }

        if deck.format == .commander {
            let commanders = deck.cards.filter { $0.board == .commander }
            if commanders.isEmpty { issues.append("No commander set.") }
            else {
                let identity = Set(commanders.flatMap { cards[$0.cardId]?.colorIdentity ?? [] })
                for c in deck.cards where c.board == .main || c.board == .side {
                    let ci = cards[c.cardId]?.colorIdentity ?? []
                    if ci.contains(where: { !identity.contains($0) }) { issues.append("\(c.name) is outside the commander's color identity.") }
                }
            }
        }
        return issues
    }

    public static func manaCurve(_ deck: Deck, cards: [String: CardSummary]) -> [Int] {
        var curve = Array(repeating: 0, count: 8)
        for c in deck.cards where c.board == .main || c.board == .commander {
            guard let card = cards[c.cardId], !card.typeLine.contains("Land") else { continue }
            curve[min(7, Int(card.cmc))] += c.quantity
        }
        return curve
    }

    public static func colorCounts(_ deck: Deck, cards: [String: CardSummary]) -> [(String, Int)] {
        var out: [String: Int] = ["W": 0, "U": 0, "B": 0, "R": 0, "G": 0, "C": 0]
        for c in deck.cards where c.board == .main || c.board == .commander {
            guard let card = cards[c.cardId], !card.typeLine.contains("Land") else { continue }
            if card.colors.isEmpty { out["C", default: 0] += c.quantity }
            for col in card.colors { out[col, default: 0] += c.quantity }
        }
        return ["W", "U", "B", "R", "G", "C"].map { ($0, out[$0] ?? 0) }.filter { $0.1 > 0 }
    }

    public static func typeCounts(_ deck: Deck, cards: [String: CardSummary]) -> [(String, Int)] {
        let types = ["Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker", "Battle", "Land"]
        var out: [String: Int] = [:]
        for c in deck.cards where c.board == .main || c.board == .commander {
            let tl = cards[c.cardId]?.typeLine ?? ""
            out[types.first { tl.contains($0) } ?? "Other", default: 0] += c.quantity
        }
        return (types + ["Other"]).compactMap { t in out[t].map { (t, $0) } }
    }

    /// Cards in the deck the profile doesn't own (any printing, matched by name).
    public static func missing(_ deck: Deck, profile: Profile) -> [(card: DeckCard, missing: Int)] {
        var owned: [String: Int] = [:]
        for c in profile.collection { owned[c.name, default: 0] += c.quantity }
        var need: [String: DeckCard] = [:]
        var order: [String] = []
        for c in deck.cards where c.board != .maybe {
            if need[c.name] == nil { order.append(c.name); need[c.name] = c } else { need[c.name]!.quantity += c.quantity }
        }
        return order.compactMap { name in
            let c = need[name]!
            let m = c.quantity - (owned[name] ?? 0)
            return m > 0 ? (card: c, missing: m) : nil
        }
    }

    public static func value(_ deck: Deck, profile: Profile) -> Double {
        deck.cards.filter { $0.board != .maybe }.reduce(0) { $0 + (profile.price($1.cardId, .nonfoil) ?? 0) * Double($1.quantity) }
    }

    public static func text(_ deck: Deck) -> String {
        var out: [String] = []
        for b in Board.allCases {
            let cards = deck.cards.filter { $0.board == b }
            if cards.isEmpty { continue }
            out.append(b == .main ? "Deck" : b.label)
            out.append(contentsOf: cards.map { "\($0.quantity) \($0.name)" })
            out.append("")
        }
        return out.joined(separator: "\n").trimmed
    }
}

public enum Buylist {
    /// What a store would pay: market × condition multiplier × percent.
    public static func value(market: Double, pct: Double, condition: Condition, settings: AppSettings) -> Double {
        (market * settings.multiplier(condition) * (pct / 100) * 100).rounded() / 100
    }
}
