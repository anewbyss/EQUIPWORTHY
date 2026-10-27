import Foundation
import Security
import SwiftUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

/// Runs sync for the active profile: when the app opens or comes back to the
/// foreground, a few seconds after saves, every 5 minutes, and on demand.
@MainActor
final class SyncManager: ObservableObject {
    @Published private(set) var config: SyncConfig?
    @Published private(set) var syncing = false
    @Published private(set) var lastSync: Date?
    @Published var error: String?
    @Published var remote: [SyncEnvelope] = []

    private weak var store: ProfileStore?
    private var pending: Task<Void, Never>?
    private var timer: Timer?
    private var again = false

    var configured: Bool { config != nil }

    func attach(_ store: ProfileStore) {
        guard self.store == nil else { return }
        self.store = store
        config = Keychain.load()
        store.onSaved = { [weak self] in self?.scheduleSoon() }
        timer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            Task { @MainActor in if self?.config?.autoSync == true { await self?.syncNow() } }
        }
        if config?.autoSync == true { Task { await syncNow() } }
    }

    func scheduleSoon() {
        guard config?.autoSync == true else { return }
        pending?.cancel()
        pending = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            guard !Task.isCancelled else { return }
            await self?.syncNow()
        }
    }

    func appBecameActive() {
        if config?.autoSync == true { Task { await syncNow() } }
    }

    func syncNow() async {
        guard let cfg = config, let store else { return }
        if syncing { again = true; return }
        syncing = true
        error = nil
        defer {
            syncing = false
            if again { again = false; scheduleSoon() }
        }
        let local = store.profile
        do {
            let res = try await Syncer.syncOnce(cfg, local: local, base: store.syncBase(local.id))
            if cfg.gistId != res.gistId { var c = cfg; c.gistId = res.gistId; save(c) }
            if store.profile.id == local.id && store.profile.updatedAt != local.updatedAt {
                again = true // edited during sync; merge again
            } else if res.changedLocal {
                await store.applySynced(res.merged)
                let missing = (res.merged.collection.map(\.cardId) + res.merged.watchlist.map(\.cardId)).contains { store.profile.card($0) == nil }
                if missing { Task { await store.refreshPrices() } }
            }
            store.setSyncBase(res.merged)
            lastSync = Date()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Check the token and passphrase, then turn sync on.
    func connect(token: String, passphrase: String) async throws {
        var cfg = SyncConfig(token: token.trimmingCharacters(in: .whitespacesAndNewlines), passphrase: passphrase)
        let gist = GistStore(token: cfg.token)
        cfg.gistId = try await gist.ensureGist(nil)
        let envs = try await gist.list(cfg.gistId!)
        if let first = envs.first { _ = try SyncCrypto.decrypt(first, passphrase: passphrase) }
        save(cfg)
        remote = envs
        await syncNow()
    }

    func refreshRemote() async {
        guard let cfg = config, let id = cfg.gistId else { return }
        remote = (try? await GistStore(token: cfg.token).list(id)) ?? remote
    }

    func download(_ env: SyncEnvelope) async {
        guard let cfg = config, let store else { return }
        do {
            let p = try SyncCrypto.decrypt(env, passphrase: cfg.passphrase)
            await store.addSynced(p)
            store.setSyncBase(p)
            lastSync = Date()
            Task { await store.refreshPrices() }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func setAutoSync(_ on: Bool) {
        guard var c = config else { return }
        c.autoSync = on
        save(c)
    }

    func disconnect() {
        Keychain.delete()
        config = nil
        lastSync = nil
        remote = []
    }

    private func save(_ c: SyncConfig) {
        Keychain.save(c)
        config = c
    }
}

/// Stores the sync token and passphrase in the iOS Keychain.
enum Keychain {
    private static let service = "com.equipworthy.sync"
    private static let account = "config"

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func save(_ c: SyncConfig) {
        guard let data = try? JSONEncoder().encode(c) else { return }
        SecItemDelete(query as CFDictionary)
        var q = query
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    static func load() -> SyncConfig? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(SyncConfig.self, from: data)
    }

    static func delete() {
        SecItemDelete(query as CFDictionary)
    }
}
