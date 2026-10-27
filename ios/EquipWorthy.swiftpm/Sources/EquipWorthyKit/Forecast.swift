import Foundation

// Price-movement forecasting. Port of web/src/lib/forecast.ts. The two must
// produce identical numbers; see docs/FORECASTING.md.

public struct ForecastFactor: Hashable, Sendable, Identifiable {
    public var label: String
    public var impactPct: Double
    public var detail: String
    public var id: String { label }
}

public struct Forecast: Hashable, Sendable {
    public enum Direction: String, Sendable { case up, down, flat }
    public var price: Double
    public var horizonDays: Int
    public var expectedPct: Double
    public var lowPct: Double
    public var highPct: Double
    public var direction: Direction
    public var confidence: Double
    public var confidenceLabel: String
    public var volatility: Double
    public var reprintRisk: Double
    public var factors: [ForecastFactor]
    public var historyPoints: Int
}

private func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, v)) }
private func rnd(_ v: Double, _ d: Int = 2) -> Double { let p = pow(10.0, Double(d)); return (v * p + 0.5).rounded(.down) / p } // matches JS Math.round

private func stdev(_ v: [Double]) -> Double {
    guard v.count >= 2 else { return 0 }
    let m = v.reduce(0, +) / Double(v.count)
    return sqrt(v.reduce(0) { $0 + ($1 - m) * ($1 - m) } / Double(v.count - 1))
}

private func linregSlope(_ xs: [Double], _ ys: [Double]) -> Double {
    let n = Double(xs.count)
    let mx = xs.reduce(0, +) / n, my = ys.reduce(0, +) / n
    var num = 0.0, den = 0.0
    for i in xs.indices { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx) }
    return den == 0 ? 0 : num / den
}

public enum Forecaster {
    public static func reprintRisk(_ card: CardSummary, price: Double, now: Date = Date()) -> Double {
        if card.reserved { return 0 }
        let priceF = clamp(log10(max(price, 0.01)) / 2, 0, 1)
        let pop = card.edhrecRank.map { clamp(1 - Double($0) / 5000, 0, 1) } ?? 0.2
        let released = dayDate(String(card.releasedAt.prefix(10))) ?? now
        let ageYears = max(0, now.timeIntervalSince(released) / (365 * 86_400))
        let age = clamp(ageYears / 5, 0, 1)
        return rnd(0.4 * priceF + 0.35 * pop + 0.25 * age, 3)
    }

    public static func forecast(card: CardSummary, series: PriceSeries, currentPrice: Double?, horizonDays: Int = 30, now: Date = Date()) -> Forecast? {
        let sorted = series.filter { $0.price > 0 }.sorted { $0.date < $1.date }
        guard let price = currentPrice ?? sorted.last?.price, price > 0 else { return nil }
        var factors: [ForecastFactor] = []
        let nowDay = dayString(now)
        let recent = sorted.filter { daysBetween($0.date, nowDay) <= 30 }
        let spanDays = recent.isEmpty ? 0 : daysBetween(recent.first!.date, recent.last!.date)

        // 1. Momentum + 2. mean reversion
        if recent.count >= 5 && spanDays >= 5 {
            let xs = recent.map { Double(daysBetween(recent[0].date, $0.date)) }
            let ys = recent.map { log($0.price) }
            let slope = linregSlope(xs, ys)
            let trend30 = (exp(slope * 30) - 1) * 100
            factors.append(ForecastFactor(
                label: trend30 >= 0 ? "Upward trend" : "Downward trend",
                impactPct: rnd(clamp(0.4 * trend30, -25, 25)),
                detail: "Recent prices are moving \(trend30 >= 0 ? "up" : "down") about \(abs(rnd(trend30, 1)))% per 30 days. Trends usually carry on partway."))
            let prices = recent.map(\.price)
            let mean = prices.reduce(0, +) / Double(prices.count)
            let sd = stdev(prices)
            if sd > 0 {
                let z = (price - mean) / sd
                if abs(z) > 1.5 {
                    factors.append(ForecastFactor(
                        label: z > 0 ? "Spike cooling" : "Dip recovery",
                        impactPct: rnd(clamp(-0.3 * ((price - mean) / price) * 100, -20, 20)),
                        detail: "The price is \(abs(rnd(z, 1))) standard deviations \(z > 0 ? "above" : "below") its 30-day average. Sharp moves often partly reverse."))
                }
            }
        }

        // 3. Reserved list
        if card.reserved {
            factors.append(ForecastFactor(label: "Reserved List", impactPct: 2, detail: "Wizards has promised never to reprint this card, so supply only shrinks."))
        }

        // 4. Reprint risk
        let risk = reprintRisk(card, price: price, now: now)
        if !card.reserved {
            let level = risk >= 0.6 ? "high" : risk >= 0.35 ? "moderate" : "low"
            factors.append(ForecastFactor(label: "Reprint risk: \(level)", impactPct: rnd(-risk * 4),
                                          detail: "Based on price, how much it's played (EDHREC rank) and how long since it was printed. Valuable, popular cards are prime reprint targets."))
        }

        // 5. Demand
        if let rank = card.edhrecRank {
            if rank < 1000 { factors.append(ForecastFactor(label: "High Commander demand", impactPct: 1.5, detail: "EDHREC rank #\(rank): one of the most-played Commander cards.")) }
            else if rank < 5000 { factors.append(ForecastFactor(label: "Steady Commander demand", impactPct: 0.5, detail: "EDHREC rank #\(rank).")) }
        }

        // 6. Set lifecycle
        let ageDays = daysBetween(card.releasedAt, nowDay)
        if ageDays >= 0 && ageDays < 45 { factors.append(ForecastFactor(label: "New-set dip", impactPct: -6, detail: "Cards usually lose value in the first weeks after release as boxes get opened.")) }
        else if ageDays >= 45 && ageDays < 120 { factors.append(ForecastFactor(label: "Settling after release", impactPct: -2, detail: "Prices are still finding their floor after release.")) }
        else if ageDays >= 120 && ageDays < 365 { factors.append(ForecastFactor(label: "Post-release recovery", impactPct: 1, detail: "Once a set stops being opened, prices usually drift back up.")) }

        // 7. Standard rotation
        if card.legalities["standard"] == "legal" && ageDays > 30 * 30 {
            factors.append(ForecastFactor(label: "Nearing Standard rotation", impactPct: -2, detail: "Cards that are mostly played in Standard tend to sell off before rotation."))
        }

        // 8. Bans
        let banned = ["commander", "modern", "pioneer", "standard", "legacy"].filter { card.legalities[$0] == "banned" }
        if !banned.isEmpty {
            factors.append(ForecastFactor(label: "Banned in \(banned.joined(separator: ", "))", impactPct: -3, detail: "Banned cards lose demand from those formats."))
        }

        if price < 0.5 {
            for i in factors.indices where factors[i].impactPct < 0 { factors[i].impactPct = rnd(factors[i].impactPct / 2) }
        }

        let expected30 = factors.reduce(0) { $0 + $1.impactPct }
        let expected = rnd(expected30 * (Double(horizonDays) / 30))

        var rets: [Double] = []
        if recent.count > 1 {
            for i in 1..<recent.count {
                let gap = Double(max(1, daysBetween(recent[i - 1].date, recent[i].date)))
                rets.append(log(recent[i].price / recent[i - 1].price) / sqrt(gap))
            }
        }
        let sigma = rets.count >= 5 ? max(0.005, stdev(rets)) : (price < 1 ? 0.03 : price < 10 ? 0.02 : 0.015)
        let band = 1.2816 * sigma * sqrt(Double(horizonDays)) * 100
        let dataScore = min(1, Double(recent.count) / 30)
        let confidence = rnd(clamp(0.5 * dataScore + 0.3 * (1 - min(1, sigma / 0.05)) + 0.2 * min(1, Double(factors.count) / 3), 0, 1))

        return Forecast(
            price: price, horizonDays: horizonDays, expectedPct: expected,
            lowPct: rnd(expected - band), highPct: rnd(expected + band),
            direction: expected > 2 ? .up : expected < -2 ? .down : .flat,
            confidence: confidence, confidenceLabel: confidence >= 0.66 ? "High" : confidence >= 0.4 ? "Medium" : "Low",
            volatility: rnd(sigma, 4), reprintRisk: risk, factors: factors, historyPoints: recent.count)
    }

    public static func resolve(_ log: [ForecastLogEntry], history: [String: PriceSeries], now: Date = Date()) -> [ForecastLogEntry] {
        let nowDay = dayString(now)
        return log.map { e in
            if e.resolvedPct != nil || daysBetween(e.madeOn, nowDay) < e.horizonDays { return e }
            guard let made = dayDate(e.madeOn) else { return e }
            let target = dayString(made.addingTimeInterval(Double(e.horizonDays) * 86_400))
            guard let point = (history["\(e.cardId):\(e.finish.rawValue)"] ?? []).first(where: { $0.date >= target }) else { return e }
            var out = e
            out.resolvedPct = rnd((point.price - e.startPrice) / e.startPrice * 100)
            return out
        }
    }

    public struct Accuracy: Sendable { public var count: Int; public var directionHitRate: Double; public var meanAbsErrorPct: Double }

    public static func accuracy(_ log: [ForecastLogEntry]) -> Accuracy? {
        let done = log.filter { $0.resolvedPct != nil }
        guard !done.isEmpty else { return nil }
        func dir(_ v: Double) -> Int { v > 2 ? 1 : v < -2 ? -1 : 0 }
        let hits = done.filter { dir($0.expectedPct) == dir($0.resolvedPct!) }.count
        let mae = done.reduce(0) { $0 + abs($1.expectedPct - $1.resolvedPct!) } / Double(done.count)
        return Accuracy(count: done.count, directionHitRate: Double(hits) / Double(done.count), meanAbsErrorPct: rnd(mae))
    }
}
