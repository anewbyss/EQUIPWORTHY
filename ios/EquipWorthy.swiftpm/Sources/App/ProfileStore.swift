import Foundation
import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

/// Local, on-device profile storage with frequent autosave and manual save.
///
/// Saving happens:
///  - 1.5 s after any change (debounced)
///  - every `settings.autosaveSeconds` while there are unsaved changes
///  - when the app moves to the background or becomes inactive
///  - when the user taps Save (toolbar button on every screen)
///
/// Profiles are JSON files in Application Support/Profiles, using the same
/// format as the web app's backups.
@MainActor
final class ProfileStore: ObservableObject {
    struct Meta: Codable, Identifiable, Hashable {
        var id: String
        var name: String
        var updatedAt: String
        var cards: Int
    }

    @Published private(set) var profile: Profile
    @Published private(set) var profiles: [Meta] = []
    @Published private(set) var dirty = false
    @Published private(set) var saving = false
    @Published private(set) var lastSaved: Date?
    @Published var lastError: String?
    @Published var refreshing: String?

    /// Called after each successful save (used to schedule sync).
    var onSaved: (@MainActor () -> Void)?

    private var debounceTask: Task<Void, Never>?
    private var timer: Timer?
    private let fm = FileManager.default

    nonisolated static let dir: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent("Profiles", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    nonisolated private static var indexURL: URL { dir.appendingPathComponent("index.json") }
    nonisolated static let activeKey = "ew.activeProfile"
    nonisolated static func url(for id: String) -> URL { dir.appendingPathComponent("\(id).json") }

    init() {
        let metas = (try? JSONDecoder().decode([Meta].self, from: Data(contentsOf: Self.indexURL))) ?? []
        let active = UserDefaults.standard.string(forKey: Self.activeKey) ?? metas.first?.id
        if let active, let p = Self.load(id: active) {
            profile = p
        } else if let first = metas.first, let p = Self.load(id: first.id) {
            profile = p
        } else {
            profile = Profile(name: "My Collection")
        }
        profiles = metas
        lastSaved = parseISO(profile.updatedAt)
        if !metas.contains(where: { $0.id == profile.id }) { Task { await save() } }
        UserDefaults.standard.set(profile.id, forKey: Self.activeKey)
        restartTimer()
    }

    nonisolated static func load(id: String) -> Profile? {
        guard let data = try? Data(contentsOf: url(for: id)) else { return nil }
        return try? JSONDecoder().decode(Profile.self, from: data)
    }

    // MARK: Mutation

    /// Apply a change and schedule an autosave.
    func mutate(_ change: (inout Profile) -> Void) {
        let oldInterval = profile.settings.autosaveSeconds
        var p = profile
        change(&p)
        p.updatedAt = isoNow()
        profile = p
        dirty = true
        if p.settings.autosaveSeconds != oldInterval { restartTimer() }
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard !Task.isCancelled else { return }
            await self?.save()
        }
    }

    func cache(_ cards: [CardSummary]) {
        guard !cards.isEmpty else { return }
        mutate { p in for c in cards { p.cardCache[c.id] = c } }
    }

    private func restartTimer() {
        timer?.invalidate()
        let secs = TimeInterval(max(5, profile.settings.autosaveSeconds))
        timer = Timer.scheduledTimer(withTimeInterval: secs, repeats: true) { [weak self] _ in
            Task { @MainActor in
                if self?.dirty == true { await self?.save() }
            }
        }
    }

    // MARK: Saving

    @discardableResult
    func save(quiet: Bool = false) async -> Bool {
        debounceTask?.cancel()
        let snapshot = profile
        saving = true
        defer { saving = false }
        do {
            let data = try await Task.detached(priority: .utility) { try JSONEncoder().encode(snapshot) }.value
            try data.write(to: Self.url(for: snapshot.id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var metas = profiles.filter { $0.id != snapshot.id }
            metas.append(Meta(id: snapshot.id, name: snapshot.name, updatedAt: snapshot.updatedAt, cards: snapshot.collection.reduce(0) { $0 + $1.quantity }))
            metas.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            try JSONEncoder().encode(metas).write(to: Self.indexURL, options: .atomic)
            profiles = metas
            // Only clear dirty if nothing changed while we were writing.
            if profile == snapshot { dirty = false }
            lastSaved = Date()
            lastError = nil
            if !quiet { onSaved?() }
            return true
        } catch {
            lastError = "Save failed: \(error.localizedDescription)"
            return false
        }
    }

    /// Synchronous save used when the app is being backgrounded.
    func saveNowBlocking() {
        guard dirty, let data = try? JSONEncoder().encode(profile) else { return }
        do {
            try data.write(to: Self.url(for: profile.id), options: .atomic)
            dirty = false
            lastSaved = Date()
        } catch {
            lastError = "Save failed: \(error.localizedDescription)"
        }
    }

    // MARK: Profiles

    func switchTo(_ id: String) async {
        if dirty { await save() }
        guard let p = Self.load(id: id) else { return }
        profile = p
        dirty = false
        UserDefaults.standard.set(id, forKey: Self.activeKey)
        restartTimer()
    }

    func create(name: String) async {
        if dirty { await save() }
        profile = Profile(name: name)
        UserDefaults.standard.set(profile.id, forKey: Self.activeKey)
        await save()
    }

    func delete(_ id: String) async {
        try? fm.removeItem(at: Self.url(for: id))
        profiles.removeAll { $0.id == id }
        try? JSONEncoder().encode(profiles).write(to: Self.indexURL, options: .atomic)
        if profile.id == id {
            if let next = profiles.first { await switchTo(next.id) } else { await create(name: "My Collection") }
        }
    }

    func exportData() throws -> Data {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return try enc.encode(profile)
    }

    func importBackup(_ data: Data) async throws {
        var p = try JSONDecoder().decode(Profile.self, from: data)
        if profiles.contains(where: { $0.id == p.id }) {
            p.id = UUID().uuidString
            p.name += " (imported)"
        }
        if dirty { await save() }
        profile = p
        UserDefaults.standard.set(p.id, forKey: Self.activeKey)
        await save()
    }

    // MARK: Sync

    /// Replace the active profile with a merged copy from sync. Keeps the merged
    /// `updatedAt` (unlike mutate) so devices don't bounce changes back and forth.
    func applySynced(_ merged: Profile) async {
        guard merged.id == profile.id else { return }
        var p = merged
        p.cardCache = profile.cardCache
        p.market = profile.market
        p.secretLairCatalog = profile.secretLairCatalog
        profile = p
        dirty = true
        await save(quiet: true)
    }

    /// Add a profile that came from another device (keeps its id) and switch to it.
    func addSynced(_ p: Profile) async {
        if dirty { await save() }
        profile = p
        UserDefaults.standard.set(p.id, forKey: Self.activeKey)
        await save(quiet: true)
    }

    nonisolated static func baseURL(for id: String) -> URL { dir.appendingPathComponent("\(id).syncbase.json") }

    func syncBase(_ id: String) -> Profile? {
        guard let d = try? Data(contentsOf: Self.baseURL(for: id)) else { return nil }
        return try? JSONDecoder().decode(Profile.self, from: d)
    }

    func setSyncBase(_ p: Profile) {
        try? JSONEncoder().encode(p).write(to: Self.baseURL(for: p.id), options: .atomic)
    }

    // MARK: Prices

    /// Fetch current prices for every tracked card and record today's snapshot.
    @discardableResult
    func refreshPrices() async -> [PriceAlert] {
        let ids = Snapshot.trackedIds(profile)
        guard !ids.isEmpty else { return [] }
        refreshing = "Updating \(ids.count) cards…"
        defer { refreshing = nil }
        do {
            let fresh = try await Scryfall.shared.collection(ids.map { .id($0) })
            let before = Set(profile.alerts.map(\.id))
            mutate { p in p = Snapshot.apply(p, fresh: fresh) }
            let new = profile.alerts.filter { !before.contains($0.id) }
            if profile.settings.notifications { Notifier.post(new) }
            return new
        } catch {
            lastError = "Price refresh failed: \(error.localizedDescription)"
            return []
        }
    }
}
