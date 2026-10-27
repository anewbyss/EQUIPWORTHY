import Foundation
import EquipWorthyKit

/// Optional offline card database (Scryfall "oracle_cards" bulk data, one
/// entry per card). Lets search and scanning work at a card shop with no signal.
final class OfflineCardDB: @unchecked Sendable {
    static let shared = OfflineCardDB()
    private let lock = NSLock()
    private var byName: [String: CardSummary] = [:]
    private var names: [String] = []

    private var fileURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("offline-cards.json")
    }

    var isInstalled: Bool { FileManager.default.fileExists(atPath: fileURL.path) }
    var count: Int { lock.lock(); defer { lock.unlock() }; return names.count }
    var installedDate: Date? { (try? FileManager.default.attributesOfItem(atPath: fileURL.path))?[.modificationDate] as? Date }

    private init() {
        DispatchQueue.global(qos: .utility).async { self.loadFromDisk() }
    }

    private func loadFromDisk() {
        guard let data = try? Data(contentsOf: fileURL), let cards = try? JSONDecoder().decode([CardSummary].self, from: data) else { return }
        index(cards)
    }

    private func index(_ cards: [CardSummary]) {
        var map: [String: CardSummary] = [:]
        for c in cards { map[c.name.lowercased()] = c }
        lock.lock()
        byName = map
        names = cards.map(\.name).sorted()
        lock.unlock()
    }

    /// Download and compact Scryfall's bulk file (~150 MB download, much smaller on disk).
    func download(progress: @escaping @Sendable (String) -> Void) async throws {
        progress("Finding latest card data…")
        let url = try await Scryfall.shared.bulkURL()
        progress("Downloading (this can take a minute)…")
        let (tmp, _) = try await URLSession.shared.download(from: url)
        progress("Processing…")
        let data = try Data(contentsOf: tmp)
        let cards = try Scryfall.decodeBulk(data).map { c -> CardSummary in
            var c = c
            c.oracleText = nil // keep the file small
            return c
        }
        try JSONEncoder().encode(cards).write(to: fileURL, options: .atomic)
        index(cards)
        progress("Installed \(cards.count) cards")
    }

    func remove() {
        try? FileManager.default.removeItem(at: fileURL)
        lock.lock(); byName = [:]; names = []; lock.unlock()
    }

    func card(named name: String) -> CardSummary? {
        lock.lock(); defer { lock.unlock() }
        if let c = byName[name.lowercased()] { return c }
        // Best fuzzy match for OCR'd names
        let best = names.max { ScanParser.similarity($0, name) < ScanParser.similarity($1, name) }
        guard let b = best, ScanParser.similarity(b, name) > 0.7 else { return nil }
        return byName[b.lowercased()]
    }

    func names(matching q: String) -> [String] {
        let s = q.lowercased()
        guard s.count >= 2 else { return [] }
        lock.lock(); defer { lock.unlock() }
        return Array(names.lazy.filter { $0.lowercased().contains(s) }.prefix(10))
    }
}
