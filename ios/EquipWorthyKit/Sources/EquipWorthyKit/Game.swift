import Foundation

// Life, damage and counter tracking plus dice rolling. Port of web/src/lib/game.ts.

public struct GamePlayer: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var color: String
    public var life: Int
    public var poison: Int
    public var energy: Int
    public var experience: Int
    public var commanderTax: Int
    /// Commander damage received, keyed by the attacking player's id.
    public var commanderDamage: [String: Int]
}

public struct GameLogEntry: Codable, Hashable, Sendable {
    public var at: String
    public var text: String
}

public struct DiceRoll: Codable, Hashable, Sendable {
    public var at: String
    public var label: String
    public var results: [Int]
    public var total: Int
    public var text: String?
}

public struct GameState: Codable, Hashable, Sendable {
    public var startingLife: Int
    public var players: [GamePlayer]
    public var turn: Int
    public var activePlayer: Int
    public var log: [GameLogEntry]
    public var rolls: [DiceRoll]
    public var startedAt: String
}

public enum Counter: String, CaseIterable, Sendable {
    case poison, energy, experience, commanderTax
    public var label: String {
        switch self {
        case .poison: return "Poison"
        case .energy: return "Energy"
        case .experience: return "Exp"
        case .commanderTax: return "Cmdr tax"
        }
    }
    var logLabel: String { self == .commanderTax ? "commander tax" : rawValue }
    public var keyPath: WritableKeyPath<GamePlayer, Int> {
        switch self {
        case .poison: return \.poison
        case .energy: return \.energy
        case .experience: return \.experience
        case .commanderTax: return \.commanderTax
        }
    }
}

public enum Game {
    public static let playerColors = ["sky", "violet", "gold", "teal", "rose", "slate"]
    public static let commanderLethal = 21
    public static let poisonLethal = 10

    public static func new(players: Int, startingLife: Int, names: [String] = []) -> GameState {
        let n = max(1, min(8, players))
        let ps = (0..<n).map { i in
            GamePlayer(id: UUID().uuidString, name: i < names.count && !names[i].isEmpty ? names[i] : "Player \(i + 1)",
                       color: playerColors[i % playerColors.count], life: startingLife, poison: 0, energy: 0, experience: 0,
                       commanderTax: 0, commanderDamage: [:])
        }
        return GameState(startingLife: startingLife, players: ps, turn: 1, activePlayer: 0, log: [], rolls: [], startedAt: isoNow())
    }

    public static func rematch(_ g: GameState) -> GameState {
        var next = new(players: g.players.count, startingLife: g.startingLife, names: g.players.map(\.name))
        for i in next.players.indices { next.players[i].color = g.players[i].color }
        return next
    }

    static func fmt(_ n: Int) -> String { n > 0 ? "+\(n)" : "−\(abs(n))" }

    static func log(_ g: inout GameState, _ text: String, _ now: Date) {
        g.log.insert(GameLogEntry(at: isoNow(now), text: text), at: 0)
        if g.log.count > 300 { g.log.removeLast(g.log.count - 300) }
    }

    /// Rapid taps on the same player within 4 s are merged into one log line.
    public static func changeLife(_ g: GameState, id: String, delta: Int, now: Date = Date()) -> GameState {
        guard delta != 0, let i = g.players.firstIndex(where: { $0.id == id }) else { return g }
        var next = g
        let p = g.players[i]
        let newLife = p.life + delta
        next.players[i].life = newLife
        if let prev = g.log.first, let at = parseISO(prev.at), now.timeIntervalSince(at) < 4,
           let m = Rx.first("^(.*) ([+−]\\d+) \\((-?\\d+) → (-?\\d+)\\)$", in: prev.text),
           m[1] == p.name, Int(m[4] ?? "") == p.life, let start = Int(m[3] ?? "") {
            next.log.removeFirst()
            let total = newLife - start
            if total != 0 { next.log.insert(GameLogEntry(at: isoNow(now), text: "\(p.name) \(fmt(total)) (\(start) → \(newLife))"), at: 0) }
            return next
        }
        log(&next, "\(p.name) \(fmt(delta)) (\(p.life) → \(newLife))", now)
        return next
    }

    /// Commander damage also costs the same amount of life.
    public static func commanderDamage(_ g: GameState, target: String, from: String, delta: Int, now: Date = Date()) -> GameState {
        guard delta != 0, let t = g.players.firstIndex(where: { $0.id == target }), let f = g.players.first(where: { $0.id == from }) else { return g }
        let cur = g.players[t].commanderDamage[from] ?? 0
        let nextDmg = max(0, cur + delta)
        let applied = nextDmg - cur
        guard applied != 0 else { return g }
        var next = g
        next.players[t].commanderDamage[from] = nextDmg
        next.players[t].life -= applied
        log(&next, "\(f.name)'s commander → \(g.players[t].name): \(fmt(applied)) (\(nextDmg) total)", now)
        return next
    }

    public static func change(_ g: GameState, id: String, counter: Counter, delta: Int, now: Date = Date()) -> GameState {
        guard let i = g.players.firstIndex(where: { $0.id == id }) else { return g }
        let old = g.players[i][keyPath: counter.keyPath]
        let value = max(0, old + delta)
        guard value != old else { return g }
        var next = g
        next.players[i][keyPath: counter.keyPath] = value
        log(&next, "\(g.players[i].name) \(counter.logLabel) \(fmt(value - old)) (\(value))", now)
        return next
    }

    public static func eliminated(_ p: GamePlayer) -> String? {
        if p.life <= 0 { return "life" }
        if p.poison >= poisonLethal { return "poison" }
        if p.commanderDamage.values.contains(where: { $0 >= commanderLethal }) { return "commander damage" }
        return nil
    }

    public static func nextTurn(_ g: GameState, now: Date = Date()) -> GameState {
        guard g.players.contains(where: { eliminated($0) == nil }) else { return g }
        var idx = (g.activePlayer + 1) % g.players.count
        var k = 0
        while k < g.players.count && eliminated(g.players[idx]) != nil { idx = (idx + 1) % g.players.count; k += 1 }
        var next = g
        next.turn = idx <= g.activePlayer ? g.turn + 1 : g.turn
        next.activePlayer = idx
        log(&next, "Turn \(next.turn): \(g.players[idx].name)", now)
        return next
    }

    // MARK: Dice

    public static func roll(count: Int, sides: Int, modifier: Int = 0, now: Date = Date(), rng: () -> Double = { Double.random(in: 0..<1) }) -> DiceRoll {
        let n = max(1, min(100, count))
        let results = (0..<n).map { _ in 1 + Int(rng() * Double(sides)) }
        let mod = modifier == 0 ? "" : (modifier > 0 ? "+\(modifier)" : "\(modifier)")
        return DiceRoll(at: isoNow(now), label: "\(n)d\(sides)\(mod)", results: results, total: results.reduce(0, +) + modifier)
    }

    public static func flipCoin(now: Date = Date(), rng: () -> Double = { Double.random(in: 0..<1) }) -> DiceRoll {
        let r = rng() < 0.5 ? 1 : 0
        return DiceRoll(at: isoNow(now), label: "Coin", results: [r], total: r, text: r == 1 ? "Heads" : "Tails")
    }

    public static func randomPlayer(_ g: GameState, now: Date = Date(), rng: () -> Double = { Double.random(in: 0..<1) }) -> DiceRoll {
        let i = min(g.players.count - 1, Int(rng() * Double(g.players.count)))
        return DiceRoll(at: isoNow(now), label: "Random player", results: [i + 1], total: i + 1, text: g.players[i].name)
    }

    public static func add(_ g: GameState, roll r: DiceRoll) -> GameState {
        var next = g
        next.rolls.insert(r, at: 0)
        if next.rolls.count > 100 { next.rolls.removeLast(next.rolls.count - 100) }
        return next
    }
}
