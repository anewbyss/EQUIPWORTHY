import Foundation

// Fast-mover detection, synergy prediction and the daily market scan.
// Port of web/src/lib/market.ts and the pure parts of refresh.ts. See docs/MARKET.md.

public struct Mover: Codable, Hashable, Identifiable, Sendable {
    public enum Kind: String, Codable, Sendable { case spike, crash }
    public var cardId: String
    public var name: String
    public var set: String
    public var finish: Finish
    public var price: Double
    public var d1: Double?
    public var d7: Double?
    public var kind: Kind
    public var tracked: Bool
    public var id: String { cardId + finish.rawValue }
}

public struct SynergyPick: Codable, Hashable, Identifiable, Sendable {
    public var cardId: String
    public var name: String
    public var set: String
    public var price: Double?
    public var score: Double
    public var reasons: [String]
    public var sources: [String]
    public var id: String { cardId }
}

public struct MarketSet: Codable, Hashable, Sendable {
    public var code: String
    public var name: String
    public var releasedAt: String?
}

public struct MarketData: Codable, Hashable, Sendable {
    public var history: [String: PriceSeries]
    public var cards: [String: CardSummary]
    public var movers: [Mover]
    public var synergy: [SynergyPick]
    public var newSets: [MarketSet]
    public var lastScan: String?
}

public struct MoverInput: Sendable {
    public var cardId: String
    public var name: String
    public var set: String
    public var finish: Finish
    public var series: PriceSeries?
    public var tracked: Bool
    public init(cardId: String, name: String, set: String, finish: Finish, series: PriceSeries?, tracked: Bool) {
        self.cardId = cardId; self.name = name; self.set = set; self.finish = finish; self.series = series; self.tracked = tracked
    }
}

private func rnd1(_ v: Double) -> Double { (v * 10 + 0.5).rounded(.down) / 10 } // matches JS Math.round

public enum Market {
    // MARK: Fast movers

    /// % change from the most recent point at least `days` days before the latest one (within days+2).
    public static func pctOver(_ series: PriceSeries?, days: Int) -> Double? {
        guard let s = series, s.count >= 2, let last = s.last, let t = dayDate(last.date) else { return nil }
        for i in stride(from: s.count - 2, through: 0, by: -1) {
            guard let d = dayDate(s[i].date) else { continue }
            let age = t.timeIntervalSince(d) / 86_400
            if age < Double(days) { continue }
            if age > Double(days + 2) || s[i].price <= 0 { return nil }
            return (last.price - s[i].price) / s[i].price * 100
        }
        return nil
    }

    public static func detectMovers(_ inputs: [MoverInput], settings s: AppSettings) -> [Mover] {
        var out: [Mover] = []
        for m in inputs {
            guard let last = m.series?.last else { continue }
            let price = last.price
            let d1 = pctOver(m.series, days: 1)
            let d7 = pctOver(m.series, days: 7)
            var before: Double = price
            if let d = d7 { before = price / (1 + d / 100) } else if let d = d1 { before = price / (1 + d / 100) }
            if max(price, before) < s.moverMinPrice { continue }
            let up = (d1 ?? 0) >= s.spikePct1d || (d7 ?? 0) >= s.spikePct7d
            let down = (d1 ?? 0) <= -s.spikePct1d || (d7 ?? 0) <= -s.spikePct7d
            if !up && !down { continue }
            out.append(Mover(cardId: m.cardId, name: m.name, set: m.set, finish: m.finish, price: price, d1: d1, d7: d7, kind: up ? .spike : .crash, tracked: m.tracked))
        }
        func size(_ x: Mover) -> Double {
            let a: Double = abs(x.d1 ?? 0)
            let b: Double = abs(x.d7 ?? 0)
            return max(a, b)
        }
        return out.sorted { size($0) > size($1) }
    }

    public static func moverText(_ m: Mover) -> String {
        var parts: [String] = []
        if let d = m.d1 { parts.append("\(d > 0 ? "+" : "")\(String(format: "%.1f", d))% today") }
        if let d = m.d7 { parts.append("\(d > 0 ? "+" : "")\(String(format: "%.1f", d))% this week") }
        return "\(m.name) is \(m.kind == .spike ? "spiking" : "dropping fast"): \(parts.joined(separator: ", ")) (now \(m.price.usd))"
    }

    // MARK: Synergy themes

    static let evergreen: Set<String> = [
        "flying", "trample", "haste", "vigilance", "deathtouch", "lifelink", "reach", "first strike", "double strike", "menace",
        "hexproof", "flash", "defender", "indestructible", "ward", "equip", "enchant", "protection", "shroud", "fear", "intimidate",
        "cycling", "kicker", "scry", "mill", "fight", "transform", "partner", "changeling",
    ]

    struct Theme { let tag: String; let label: String; let pattern: String; let weight: Double }

    static let themes: [Theme] = [
        Theme(tag: "counters", label: "+1/+1 counters", pattern: "\\+1/\\+1 counter", weight: 1),
        Theme(tag: "minus-counters", label: "-1/-1 counters", pattern: "-1/-1 counter", weight: 1),
        Theme(tag: "proliferate", label: "proliferate", pattern: "proliferate", weight: 1.2),
        Theme(tag: "tokens", label: "tokens", pattern: "create[^.]*token", weight: 0.8),
        Theme(tag: "treasure", label: "Treasure", pattern: "treasure", weight: 1),
        Theme(tag: "food", label: "Food", pattern: "\\bfood\\b", weight: 1),
        Theme(tag: "clues", label: "Clues", pattern: "\\bclue\\b", weight: 1),
        Theme(tag: "sacrifice", label: "sacrifice", pattern: "sacrifice (a|an|another|two|x)\\b", weight: 0.9),
        Theme(tag: "graveyard", label: "graveyard", pattern: "from (your|a) graveyard|cards? in (your|a) graveyard", weight: 0.8),
        Theme(tag: "lifegain", label: "life gain", pattern: "whenever you gain life|you gain \\w+ life", weight: 0.9),
        Theme(tag: "landfall", label: "landfall", pattern: "landfall|land enters the battlefield under your control|lands? you control enters", weight: 1.1),
        Theme(tag: "spells", label: "instants & sorceries", pattern: "instant or sorcery|noncreature spell", weight: 0.8),
        Theme(tag: "artifacts", label: "artifacts", pattern: "artifacts? you control|whenever an artifact|artifact spell", weight: 0.8),
        Theme(tag: "enchantments", label: "enchantments", pattern: "enchantments? you control|whenever an enchantment|enchantment spell|constellation", weight: 0.9),
        Theme(tag: "equipment", label: "Equipment & Auras", pattern: "equipped creature|enchanted creature|\\baura\\b|equipment", weight: 0.7),
        Theme(tag: "blink", label: "flicker / ETB", pattern: "exile[^.]*return (it|that card|them|those cards)[^.]*battlefield", weight: 0.8),
        Theme(tag: "attack", label: "attack triggers", pattern: "whenever [^.]* attacks", weight: 0.5),
        Theme(tag: "draw-two", label: "second card drawn", pattern: "second card each turn|draw your second card", weight: 1),
        Theme(tag: "discard", label: "discard", pattern: "whenever you discard|discards? a card", weight: 0.7),
        Theme(tag: "energy", label: "energy", pattern: "\\{E\\}|energy counter", weight: 1),
        Theme(tag: "voltron", label: "commander damage / voltron", pattern: "commander damage|equipped creature gets", weight: 0.6),
        Theme(tag: "extra-combat", label: "extra combats", pattern: "additional combat phase", weight: 1),
        Theme(tag: "copy", label: "copy spells", pattern: "copy (target|that) (instant|sorcery|spell)", weight: 0.9),
        Theme(tag: "mana-rocks", label: "ramp", pattern: "add (one mana|\\{[WUBRGC]\\})", weight: 0.3),
    ]

    public static func subtypes(_ typeLine: String) -> [String] {
        typeLine.components(separatedBy: "//")
            .filter { Rx.test("creature|tribal|kindred", $0, .caseInsensitive) }
            .flatMap { face -> [String] in
                let parts = face.components(separatedBy: "—")
                guard parts.count > 1 else { return [] }
                return parts[1].split(whereSeparator: { $0 == " " }).map(String.init)
            }
            .filter { !$0.isEmpty }
    }

    public static func plural(_ t: String) -> String {
        if t.hasSuffix("f") { return String(t.dropLast()) + "ves" }
        if Rx.test("(s|x|ch|sh)$", t) { return t + "es" }
        if Rx.test("[^aeiou]y$", t) { return String(t.dropLast()) + "ies" }
        return t + "s"
    }

    /// Strategy tags: non-evergreen mechanics and text themes. Creature types are matched separately.
    public static func themesOf(_ c: CardSummary) -> [String: (label: String, weight: Double)] {
        var out: [String: (label: String, weight: Double)] = [:]
        let text = c.oracleText ?? ""
        for k in c.keywords ?? [] where !evergreen.contains(k.lowercased()) {
            out["kw:\(k.lowercased())"] = (k, 1.2)
        }
        for t in themes where Rx.test(t.pattern, text, .caseInsensitive) { out[t.tag] = (t.label, t.weight) }
        return out
    }

    static func cares(_ text: String, about type: String) -> Bool {
        let esc = NSRegularExpression.escapedPattern(for: type)
        let escP = NSRegularExpression.escapedPattern(for: plural(type))
        return Rx.test("\\b(\(esc)|\(escP))\\b", text)
    }

    public static func scoreSynergy(_ candidates: [CardSummary], newCards: [CardSummary], exclude: Set<String> = [], minScore: Double = 2, limit: Int = 60) -> [SynergyPick] {
        let newThemes = newCards.map { (n: $0, t: themesOf($0), legendary: Rx.test("legendary creature", $0.typeLine, .caseInsensitive)) }
        let newOracle = Set(newCards.compactMap(\.oracleId))
        var picks: [SynergyPick] = []
        for c in candidates {
            if exclude.contains(c.id) { continue }
            if let o = c.oracleId, newOracle.contains(o) { continue }
            let ct = themesOf(c)
            let text = c.oracleText ?? ""
            var reasonWeight: [String: Double] = [:]
            var reasonOrder: [String] = []
            var reasonSources: [String: Set<String>] = [:]
            var contributions: [(score: Double, source: String)] = []
            for (n, t, legendary) in newThemes {
                var s = 0.0
                func add(_ label: String, _ w: Double) {
                    s += w
                    if reasonWeight[label] == nil { reasonOrder.append(label) }
                    reasonWeight[label, default: 0] += w
                    reasonSources[label, default: []].insert(n.name)
                }
                for (tag, info) in t.sorted(by: { $0.key < $1.key }) {
                    if let mine = ct[tag] { add(info.label, min(info.weight, mine.weight)) }
                }
                for st in subtypes(c.typeLine) where cares(n.oracleText ?? "", about: st) { add("\(st) synergy", 1.3) }
                for st in subtypes(n.typeLine) where cares(text, about: st) { add("\(st) synergy", 1.3) }
                if s == 0 { continue }
                if legendary && c.colorIdentity.allSatisfy({ n.colorIdentity.contains($0) }) {
                    s *= 1.5
                    let label = "Fits new commander \(n.name)"
                    if reasonWeight[label] == nil { reasonOrder.append(label) }
                    reasonWeight[label] = s
                    reasonSources[label] = [n.name]
                }
                contributions.append((s, n.name))
            }
            if contributions.isEmpty { continue }
            contributions.sort { $0.score > $1.score }
            var score = 0.0
            for x in contributions.prefix(5) { score += x.score }
            let price = c.prices.usd ?? c.prices.usdFoil
            if let p = price, p > 40 { score *= 0.6 }
            if let p = price, p < 0.5 { score *= 0.5 }
            if let r = c.edhrecRank, r < 3000 { score *= 1.15 }
            if c.reserved { score *= 1.1 }
            score = rnd1(score)
            if score < minScore { continue }
            // Stable sort by weight, ties keep first-seen order (like the web version).
            let ranked: [String] = reasonOrder.enumerated().sorted { a, b in
                let wa: Double = reasonWeight[a.element] ?? 0
                let wb: Double = reasonWeight[b.element] ?? 0
                return wa != wb ? wa > wb : a.offset < b.offset
            }.map { $0.element }
            var reasons: [String] = []
            for label in ranked.prefix(4) {
                let n: Int = reasonSources[label]?.count ?? 0
                if label.hasPrefix("Fits new commander") { reasons.append(label) }
                else { reasons.append("\(label): shared with \(n) new card\(n == 1 ? "" : "s")") }
            }
            picks.append(SynergyPick(cardId: c.id, name: c.name, set: c.set, price: price, score: score, reasons: reasons, sources: contributions.prefix(5).map(\.source)))
        }
        return Array(picks.sorted { $0.score > $1.score }.prefix(limit))
    }

    /// Forecast impact (% per 30 days) for a synergy score.
    public static func synergyImpact(_ score: Double) -> Double { min(6, rnd1(score * 0.8)) }

    // MARK: Schedule and scan

    static func localDay(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    /// Prices are due once per calendar day (or sooner if the interval setting is shorter).
    public static func pricesDue(_ p: Profile, now: Date = Date()) -> Bool {
        guard let last = p.lastPriceRefresh.flatMap(parseISO) else { return !Snapshot.trackedIds(p).isEmpty || p.settings.marketScan }
        if localDay(last) != localDay(now) { return true }
        return now.timeIntervalSince(last) > p.settings.autoRefreshHours * 3600
    }

    public static func marketDue(_ p: Profile, now: Date = Date()) -> Bool {
        guard p.settings.marketScan else { return false }
        guard let last = p.market?.lastScan.flatMap(parseISO) else { return true }
        return localDay(last) != localDay(now)
    }

    static let mainSetTypes: Set<String> = ["expansion", "core", "masters", "commander", "draft_innovation"]

    /// Sets released in the last 45 days or coming in the next 120 (spoiler season).
    public static func recentSets(_ sets: [SetInfo], now: Date = Date()) -> [SetInfo] {
        let lo = dayString(now.addingTimeInterval(-45 * 86_400))
        let hi = dayString(now.addingTimeInterval(120 * 86_400))
        return Array(sets.filter { s in
            guard let r = s.released_at else { return false }
            return mainSetTypes.contains(s.set_type) && r >= lo && r <= hi && s.card_count > 0
        }.prefix(5))
    }

    /// Fold a fresh market scan into the profile. Pure.
    public static func applyScan(_ p: Profile, universe: [CardSummary], newCards: [CardSummary], newSets: [SetInfo], now: Date = Date()) -> Profile {
        let date = dayString(now)
        var history = p.market?.history ?? [:]
        var cards: [String: CardSummary] = [:]
        func slim(_ c: CardSummary) -> CardSummary { var x = c; x.oracleText = nil; return x }
        for c in universe {
            guard let v = c.prices.usd ?? c.prices.usdFoil else { continue }
            history[c.id] = Array(Snapshot.appendPoint(history[c.id], date: date, price: v).suffix(120))
            cards[c.id] = slim(c)
        }
        let cutoff = dayString(now.addingTimeInterval(-30 * 86_400))
        for (id, s) in history where cards[id] == nil && (s.last?.date ?? "") < cutoff { history[id] = nil }

        let tracked = Snapshot.trackedIds(p)
        var inputs: [MoverInput] = []
        var seen = Set<String>()
        for id in tracked {
            guard let card = p.card(id) else { continue }
            for f in card.finishes {
                guard let s = p.priceHistory[historyKey(id, f)] else { continue }
                inputs.append(MoverInput(cardId: id, name: card.name + (f == .nonfoil ? "" : " (\(f.rawValue))"), set: card.set, finish: f, series: s, tracked: true))
                seen.insert(id)
            }
        }
        for c in universe where !seen.contains(c.id) {
            inputs.append(MoverInput(cardId: c.id, name: c.name, set: c.set, finish: c.prices.usd != nil ? .nonfoil : .foil, series: history[c.id], tracked: false))
        }
        let movers = Array(detectMovers(inputs, settings: p.settings).prefix(80))

        let newCodes = Set(newSets.map(\.code))
        var candidateMap: [String: CardSummary] = [:]
        var order: [String] = []
        for c in universe + tracked.compactMap({ p.card($0) }).filter({ $0.oracleText != nil }) where !newCodes.contains(c.set) {
            if candidateMap[c.id] == nil { order.append(c.id) }
            candidateMap[c.id] = c
        }
        let candidates = order.compactMap { candidateMap[$0] }
        let synergy = newCards.isEmpty ? (p.market?.synergy ?? []) : scoreSynergy(candidates, newCards: newCards, exclude: Set(newCards.map(\.id)))
        for n in newCards { cards[n.id] = slim(n) }
        for s in synergy where cards[s.cardId] == nil { if let c = candidateMap[s.cardId] { cards[c.id] = slim(c) } }

        var next = p
        next.market = MarketData(history: history, cards: cards, movers: movers, synergy: synergy,
                                 newSets: newSets.map { MarketSet(code: $0.code, name: $0.name, releasedAt: $0.released_at) },
                                 lastScan: isoNow(now))
        return next
    }
}
