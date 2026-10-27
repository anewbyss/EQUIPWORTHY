import XCTest
@testable import EquipWorthyKit

// Mirrors web/src/lib/__tests__ so both platforms agree.

final class BatchParserTests: XCTestCase {
    func testParseLine() {
        let a = BatchParser.parseLine("1 Sol Ring (CMM) 410 *F*")!
        XCTAssertEqual(a.quantity, 1); XCTAssertEqual(a.name, "Sol Ring"); XCTAssertEqual(a.set, "cmm")
        XCTAssertEqual(a.collectorNumber, "410"); XCTAssertEqual(a.finish, .foil)
        let b = BatchParser.parseLine("2 Counterspell LP @ 1.50")!
        XCTAssertEqual(b.quantity, 2); XCTAssertEqual(b.name, "Counterspell"); XCTAssertEqual(b.condition, .LP); XCTAssertEqual(b.purchasePrice, 1.5)
        XCTAssertEqual(BatchParser.parseLine("4x Lightning Bolt")?.quantity, 4)
        XCTAssertEqual(BatchParser.parseLine("Fire // Ice")?.name, "Fire // Ice")
        XCTAssertEqual(BatchParser.parseLine("SB: 2 Duress")?.board, .side)
    }

    func testSections() {
        let l = BatchParser.parseList("Commander\n1 Atraxa, Praetors' Voice\nDeck\n1 Sol Ring\n\n2 Negate")
        XCTAssertEqual(l.map { $0.board }, [.commander, .main, .side])
    }

    func testSetGrid() {
        let g = BatchParser.parseSetGrid(set: "DSK", "12, 45f, 3x88, 10-12, 101e")
        XCTAssertEqual(g.map { $0.collectorNumber! }, ["12", "45", "88", "10", "11", "12", "101"])
        XCTAssertEqual(g.map(\.finish), [.nonfoil, .foil, .nonfoil, .nonfoil, .nonfoil, .nonfoil, .etched])
        XCTAssertEqual(g[2].quantity, 3)
    }
}

final class CSVTests: XCTestCase {
    func testQuoted() {
        XCTAssertEqual(CSVImport.parse("a,\"b, c\",\"d \"\"e\"\"\"\n1,2,3"), [["a", "b, c", "d \"e\""], ["1", "2", "3"]])
    }

    func testMoxfield() {
        let csv = "\"Count\",\"Tradelist Count\",\"Name\",\"Edition\",\"Condition\",\"Language\",\"Foil\",\"Tags\",\"Last Modified\",\"Collector Number\"\n\"2\",\"0\",\"Sol Ring\",\"cmm\",\"Near Mint\",\"English\",\"foil\",\"\",\"\",\"410\""
        let l = CSVImport.toBatch(csv).lines[0]
        XCTAssertEqual(l.quantity, 2); XCTAssertEqual(l.set, "cmm"); XCTAssertEqual(l.collectorNumber, "410")
        XCTAssertEqual(l.finish, .foil); XCTAssertEqual(l.condition, .NM); XCTAssertEqual(l.language, "en")
    }
}

final class ForecastTests: XCTestCase {
    let now = ISO8601DateFormatter().date(from: "2026-10-27T12:00:00Z")!

    func card(released: String = "2020-01-01", reserved: Bool = false) -> CardSummary {
        CardSummary(id: "c1", name: "Test", set: "tst", collectorNumber: "1", releasedAt: released, reserved: reserved, legalities: ["commander": "legal"], prices: Prices(usd: 10))
    }

    func testUptrend() {
        var s: PriceSeries = []
        for i in 0..<20 { s.append(PricePoint(dayString(now.addingTimeInterval(Double(i - 20) * 86_400)), 10 * pow(1.01, Double(i)))) }
        let f = Forecaster.forecast(card: card(), series: s, currentPrice: nil, horizonDays: 30, now: now)!
        XCTAssertTrue(f.factors.contains { $0.label == "Upward trend" })
        XCTAssertEqual(f.direction, .up)
        XCTAssertLessThan(f.lowPct, f.expectedPct)
    }

    func testSignals() {
        XCTAssertNotNil(Forecaster.forecast(card: card(released: "2026-10-10"), series: [], currentPrice: 5, now: now)!.factors.first { $0.label == "New-set dip" })
        XCTAssertEqual(Forecaster.reprintRisk(card(reserved: true), price: 500, now: now), 0)
    }

    func testResolve() {
        let log = Forecaster.resolve([ForecastLogEntry(cardId: "c1", finish: .nonfoil, madeOn: "2026-10-01", horizonDays: 7, startPrice: 10, expectedPct: 5, resolvedPct: nil)],
                                     history: ["c1:nonfoil": [PricePoint("2026-10-08", 11)]], now: now)
        XCTAssertEqual(log[0].resolvedPct, 10)
        XCTAssertEqual(Forecaster.accuracy(log)?.directionHitRate, 1)
    }
}

final class DeckTests: XCTestCase {
    func testHypergeometric() {
        XCTAssertEqual(DeckStats.atLeast(N: 60, K: 4, n: 7, k: 1), 0.3995, accuracy: 0.001)
    }

    func testBuylist() {
        XCTAssertEqual(Buylist.value(market: 10, pct: 50, condition: .LP, settings: AppSettings()), 4.5)
    }
}

final class ProfileTests: XCTestCase {
    func testSnapshotAndAlerts() {
        var p = Profile(name: "t")
        p.collection.append(CollectionItem(cardId: "c1", name: "Test", set: "tst", collectorNumber: "1", quantity: 2))
        p.watchlist.append(WatchItem(cardId: "c1", name: "Test", finish: .nonfoil, below: 12))
        let c = CardSummary(id: "c1", name: "Test", set: "tst", collectorNumber: "1", prices: Prices(usd: 10))
        let t = ISO8601DateFormatter().date(from: "2026-10-27T00:00:00Z")!
        let next = Snapshot.apply(p, fresh: [c], now: t)
        XCTAssertEqual(next.priceHistory["c1:nonfoil"], [PricePoint("2026-10-27", 10)])
        XCTAssertEqual(next.portfolioHistory, [PricePoint("2026-10-27", 20)])
        XCTAssertEqual(next.alerts.count, 1)
        XCTAssertEqual(Snapshot.apply(next, fresh: [c], now: t.addingTimeInterval(3600)).alerts.count, 1)
    }

    /// A backup written by the web app must decode on iOS and round-trip.
    func testWebBackupCompatibility() throws {
        let json = """
        {"schemaVersion":1,"id":"p1","name":"Web","createdAt":"2026-10-27T00:00:00.000Z","updatedAt":"2026-10-27T00:00:00.000Z",
         "settings":{"autosaveSeconds":20,"buylistCashPct":55,"buylistCreditPct":70,"defaultCondition":"NM","defaultBinder":"Main",
           "conditionMultipliers":{"NM":1,"LP":0.9,"MP":0.75,"HP":0.55,"DMG":0.35},"autoRefreshHours":12,"notifications":true},
         "binders":["Main","Trade Binder"],
         "collection":[{"id":"i1","cardId":"c1","name":"Sol Ring","set":"cmm","collectorNumber":"410","finish":"foil","condition":"LP","language":"en","quantity":2,"binder":"Main","addedAt":"2026-10-27T00:00:00.000Z"}],
         "wishlist":[],"decks":[],"watchlist":[],"alerts":[],"trades":[],
         "priceHistory":{"c1:foil":[["2026-10-26",3.5],["2026-10-27",3.75]]},
         "portfolioHistory":[["2026-10-27",7.5]],"forecastLog":[],"cardCache":{}}
        """
        let p = try JSONDecoder().decode(Profile.self, from: Data(json.utf8))
        XCTAssertEqual(p.settings.buylistCashPct, 55)
        XCTAssertEqual(p.collection[0].finish, .foil)
        XCTAssertEqual(p.priceHistory["c1:foil"]?.last, PricePoint("2026-10-27", 3.75))
        let again = try JSONDecoder().decode(Profile.self, from: JSONEncoder().encode(p))
        XCTAssertEqual(again, p)
    }
}

final class ScanTests: XCTestCase {
    func testScanParsing() {
        XCTAssertEqual(ScanParser.cleanName("Sol Ring  1\n"), "Sol Ring")
        let a = ScanParser.parseCollectorLine("U 0410\nCMM • EN  Jeff Laubenstein")
        XCTAssertEqual(a.set, "cmm"); XCTAssertEqual(a.collectorNumber, "410")
        let b = ScanParser.parseCollectorLine("123/281 R\nDSK · EN")
        XCTAssertEqual(b.set, "dsk"); XCTAssertEqual(b.collectorNumber, "123")
        XCTAssertGreaterThan(ScanParser.similarity("Sol Rinq", "Sol Ring"), 0.6)
    }
}

final class GameTests: XCTestCase {
    func testMergedLifeLog() {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        var g = Game.new(players: 2, startingLife: 20)
        let id = g.players[0].id
        for i in 0..<3 { g = Game.changeLife(g, id: id, delta: -1, now: t0.addingTimeInterval(Double(i) * 0.5)) }
        XCTAssertEqual(g.players[0].life, 17)
        XCTAssertEqual(g.log.map(\.text), ["Player 1 −3 (20 → 17)"])
    }

    func testCommanderDamageAndPoison() {
        var g = Game.new(players: 2, startingLife: 40)
        let a = g.players[0].id, b = g.players[1].id
        g = Game.commanderDamage(g, target: a, from: b, delta: 21)
        XCTAssertEqual(g.players[0].life, 19)
        XCTAssertEqual(Game.eliminated(g.players[0]), "commander damage")
        g = Game.change(g, id: b, counter: .poison, delta: -1)
        XCTAssertEqual(g.players[1].poison, 0)
    }

    func testTurnsSkipEliminated() {
        var g = Game.new(players: 3, startingLife: 20)
        g = Game.changeLife(g, id: g.players[1].id, delta: -20)
        g = Game.nextTurn(g)
        XCTAssertEqual(g.activePlayer, 2)
        g = Game.nextTurn(g)
        XCTAssertEqual(g.activePlayer, 0)
        XCTAssertEqual(g.turn, 2)
    }

    func testDice() {
        var values = [0.0, 0.999].makeIterator()
        let r = Game.roll(count: 2, sides: 6, modifier: 1, rng: { values.next() ?? 0 })
        XCTAssertEqual(r.results, [1, 6]); XCTAssertEqual(r.total, 8); XCTAssertEqual(r.label, "2d6+1")
        XCTAssertEqual(Game.flipCoin(rng: { 0.1 }).text, "Heads")
    }

    func testGameRoundTrips() throws {
        var p = Profile(name: "t")
        p.game = Game.new(players: 4, startingLife: 40)
        let back = try JSONDecoder().decode(Profile.self, from: JSONEncoder().encode(p))
        XCTAssertEqual(back.game, p.game)
    }
}
