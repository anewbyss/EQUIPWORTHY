import Foundation

// Daily price snapshot: history, portfolio value, watchlist alerts and the
// forecast log. Port of applySnapshot in web/src/lib/prices.ts.

public enum Snapshot {
    public static let maxPoints = 730

    public static func trackedIds(_ p: Profile) -> [String] {
        var ids = Set<String>()
        p.collection.forEach { ids.insert($0.cardId) }
        p.wishlist.forEach { ids.insert($0.cardId) }
        p.watchlist.forEach { ids.insert($0.cardId) }
        p.decks.forEach { $0.cards.forEach { ids.insert($0.cardId) } }
        p.trades.forEach { t in (t.mine + t.theirs).forEach { ids.insert($0.cardId) } }
        return ids.filter { !$0.isEmpty }.sorted()
    }

    public static func appendPoint(_ series: PriceSeries?, date: String, price: Double) -> PriceSeries {
        var s = (series ?? []).filter { $0.date != date }
        s.append(PricePoint(date, (price * 100).rounded() / 100))
        s.sort { $0.date < $1.date }
        return Array(s.suffix(maxPoints))
    }

    public static func collectionValue(_ p: Profile) -> Double {
        p.collection.reduce(0) { $0 + (p.price($1.cardId, $1.finish) ?? 0) * Double($1.quantity) }
    }

    /// Percent change over the last `days` days of a series.
    public static func change(_ series: PriceSeries?, days: Int) -> Double? {
        guard let s = series, s.count >= 2, let last = s.last, let lastDate = dayDate(last.date) else { return nil }
        let cutoff = dayString(lastDate.addingTimeInterval(-Double(days) * 86_400))
        let base = s.reversed().first { $0.date <= cutoff } ?? s[0]
        if base.date == last.date || base.price <= 0 { return nil }
        return (last.price - base.price) / base.price * 100
    }

    public static func apply(_ p: Profile, fresh: [CardSummary], now: Date = Date()) -> Profile {
        let date = dayString(now)
        var next = p
        for c in fresh {
            next.cardCache[c.id] = c
            let pairs: [(Finish, Double?)] = [(.nonfoil, c.prices.usd), (.foil, c.prices.usdFoil), (.etched, c.prices.usdEtched)]
            for (f, v) in pairs {
                if let v { next.priceHistory[historyKey(c.id, f)] = appendPoint(next.priceHistory[historyKey(c.id, f)], date: date, price: v) }
            }
        }
        next.lastPriceRefresh = isoNow(now)
        next.portfolioHistory = appendPoint(p.portfolioHistory, date: date, price: collectionValue(next))

        var alerts = p.alerts
        for w in p.watchlist {
            guard let price = next.price(w.cardId, w.finish) else { continue }
            var msgs: [(PriceAlert.Kind, String)] = []
            if let b = w.below, price <= b { msgs.append((.below, "dropped to \(price.usd) (target ≤ \(b.usd))")) }
            if let a = w.above, price >= a { msgs.append((.above, "rose to \(price.usd) (target ≥ \(a.usd))")) }
            if let pm = w.pctMove, let move = change(next.priceHistory[historyKey(w.cardId, w.finish)], days: 7), abs(move) >= pm {
                msgs.append((.move, "moved \(move.signedPct) this week"))
            }
            for (kind, m) in msgs {
                let already = alerts.contains { $0.cardId == w.cardId && $0.kind == kind && $0.createdAt.hasPrefix(date) }
                if !already {
                    alerts.insert(PriceAlert(id: UUID().uuidString, cardId: w.cardId, name: w.name, kind: kind, message: "\(w.name) \(m)", createdAt: isoNow(now), read: false), at: 0)
                }
            }
        }
        // Fast movers among your own cards (one alert per card per direction per day)
        var moverInputs: [MoverInput] = []
        for id in trackedIds(p) {
            guard let card = next.card(id) else { continue }
            for f in card.finishes {
                guard let series = next.priceHistory[historyKey(id, f)] else { continue }
                moverInputs.append(MoverInput(cardId: id, name: card.name + (f == .nonfoil ? "" : " (\(f.rawValue))"), set: card.set, finish: f, series: series, tracked: true))
            }
        }
        for m in Market.detectMovers(moverInputs, settings: p.settings) {
            let kind: PriceAlert.Kind = m.kind == .spike ? .spike : .crash
            let already = alerts.contains { $0.cardId == m.cardId && $0.kind == kind && $0.createdAt.hasPrefix(date) }
            if !already {
                alerts.insert(PriceAlert(id: UUID().uuidString, cardId: m.cardId, name: m.name, kind: kind, message: Market.moverText(m), createdAt: isoNow(now), read: false), at: 0)
            }
        }
        next.alerts = Array(alerts.prefix(200))

        // Log 7-day forecasts once per day for watched + collection cards
        let logged = Set(p.forecastLog.filter { $0.madeOn == date }.map { "\($0.cardId):\($0.finish.rawValue)" })
        var toLog: [(String, Finish)] = []
        var seen = Set<String>()
        for w in p.watchlist where !seen.contains(w.cardId) { seen.insert(w.cardId); toLog.append((w.cardId, w.finish)) }
        for c in p.collection where !seen.contains(c.cardId) { seen.insert(c.cardId); toLog.append((c.cardId, c.finish)) }
        var log = p.forecastLog
        for (id, finish) in toLog where !logged.contains("\(id):\(finish.rawValue)") {
            guard let card = next.cardCache[id], let price = card.price(finish) else { continue }
            if let f = Forecaster.forecast(card: card, series: next.history(id, finish), currentPrice: price, horizonDays: 7, now: now) {
                log.append(ForecastLogEntry(cardId: id, finish: finish, madeOn: date, horizonDays: 7, startPrice: price, expectedPct: f.expectedPct, resolvedPct: nil))
            }
        }
        next.forecastLog = Array(Forecaster.resolve(log, history: next.priceHistory, now: now).suffix(5000))
        return next
    }

    public static func needsRefresh(_ p: Profile, now: Date = Date()) -> Bool {
        guard let last = p.lastPriceRefresh, let d = parseISO(last) else { return !trackedIds(p).isEmpty }
        return now.timeIntervalSince(d) > p.settings.autoRefreshHours * 3600
    }

    /// Move resolved pending rows into the collection. Port of commitRows (collection destination).
    public static func commitToCollection(_ p: Profile, keys: Set<String>, binder: String, now: Date = Date()) -> Profile {
        var next = p
        let rows = (p.pendingBatch ?? []).filter { keys.contains($0.key) && $0.cardId != nil }
        let rowKeys = Set(rows.map(\.key))
        next.pendingBatch = (p.pendingBatch ?? []).filter { !rowKeys.contains($0.key) }
        for r in rows {
            if let i = next.collection.firstIndex(where: { $0.cardId == r.cardId && $0.finish == r.finish && $0.condition == r.condition && $0.language == r.language && $0.binder == binder && $0.purchasePrice == r.purchasePrice }) {
                next.collection[i].quantity += r.quantity
            } else {
                next.collection.append(CollectionItem(cardId: r.cardId!, name: r.name, set: r.set ?? "", collectorNumber: r.collectorNumber ?? "",
                                                      finish: r.finish, condition: r.condition, language: r.language, quantity: r.quantity,
                                                      purchasePrice: r.purchasePrice, purchaseDate: r.purchasePrice != nil ? dayString(now) : nil,
                                                      binder: binder, addedAt: isoNow(now)))
            }
        }
        return apply(next, fresh: rows.compactMap { p.cardCache[$0.cardId!] }, now: now)
    }
}
