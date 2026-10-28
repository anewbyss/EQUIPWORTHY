import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(CryptoKit)
import CryptoKit
#endif
#if canImport(CommonCrypto)
import CommonCrypto
#endif

// Cross-device sync through a private GitHub Gist, end-to-end encrypted.
// Port of web/src/lib/sync.ts: same envelope, encryption and merge rules.

// MARK: - Merge

public enum SyncMerge {
    /// Whichever side changed since `base` wins; if both changed, `preferLocal` decides.
    public static func value<T: Equatable>(_ base: T?, _ local: T, _ remote: T, preferLocal: Bool) -> T {
        if local == remote { return local }
        if let base, local == base { return remote }
        if let base, remote == base { return local }
        return preferLocal ? local : remote
    }

    /// Three-way merge of keyed records. Remote order first, then local-only items,
    /// so every device converges on the same order.
    public static func list<T: Equatable>(_ base: [T]?, _ local: [T], _ remote: [T], key: (T) -> String, preferLocal: Bool) -> [T] {
        var b: [String: T] = [:]
        for x in base ?? [] { b[key(x)] = x }
        var l: [String: T] = [:]
        for x in local { l[key(x)] = x }
        var r: [String: T] = [:]
        for x in remote { r[key(x)] = x }
        var order: [String] = []
        var seen = Set<String>()
        for k in remote.map(key) + local.map(key) where !seen.contains(k) { seen.insert(k); order.append(k) }
        var out: [T] = []
        for k in order {
            let bi = b[k], li = l[k], ri = r[k]
            if let li, let ri { out.append(value(bi, li, ri, preferLocal: preferLocal)) }
            else if let li {
                if let bi, bi == li { continue } // deleted remotely
                out.append(li)
            } else if let ri {
                if let bi, bi == ri { continue } // deleted here
                out.append(ri)
            }
        }
        return out
    }

    /// Union of price points by date; the first series wins on a clash.
    public static func series(_ a: PriceSeries?, _ b: PriceSeries?) -> PriceSeries {
        var m: [String: Double] = [:]
        for p in a ?? [] { m[p.date] = p.price }
        for p in b ?? [] where m[p.date] == nil { m[p.date] = p.price }
        return Array(m.sorted { $0.key < $1.key }.map { PricePoint($0.key, $0.value) }.suffix(730))
    }

    /// Card data isn't synced (large and re-downloadable).
    public static func forSync(_ p: Profile) -> Profile {
        var q = p
        q.cardCache = [:]
        q.market = nil
        q.secretLairCatalog = nil
        q.allCards = nil
        return q
    }

    public static func profiles(base: Profile?, local: Profile, remote: Profile) -> Profile {
        let preferLocal = local.updatedAt >= remote.updatedAt
        var m = local
        m.schemaVersion = max(local.schemaVersion, remote.schemaVersion)
        m.name = value(base?.name, local.name, remote.name, preferLocal: preferLocal)
        m.settings = value(base?.settings, local.settings, remote.settings, preferLocal: preferLocal)
        m.binders = list(base?.binders, local.binders, remote.binders, key: { $0 }, preferLocal: preferLocal)
        m.collection = list(base?.collection, local.collection, remote.collection, key: \.id, preferLocal: preferLocal)
        m.wishlist = list(base?.wishlist, local.wishlist, remote.wishlist, key: \.id, preferLocal: preferLocal)
        m.decks = list(base?.decks, local.decks, remote.decks, key: \.id, preferLocal: preferLocal)
        m.watchlist = list(base?.watchlist, local.watchlist, remote.watchlist, key: \.id, preferLocal: preferLocal)
        m.alerts = list(base?.alerts, local.alerts, remote.alerts, key: \.id, preferLocal: preferLocal)
        m.trades = list(base?.trades, local.trades, remote.trades, key: \.id, preferLocal: preferLocal)
        m.pendingBatch = list(base?.pendingBatch, local.pendingBatch ?? [], remote.pendingBatch ?? [], key: \.key, preferLocal: preferLocal)
        m.game = value(base?.game, local.game, remote.game, preferLocal: preferLocal)
        m.secretLair = list(base?.secretLair, local.secretLair ?? [], remote.secretLair ?? [], key: \.id, preferLocal: preferLocal)
        var history: [String: PriceSeries] = [:]
        for k in Set(local.priceHistory.keys).union(remote.priceHistory.keys) {
            history[k] = preferLocal ? series(local.priceHistory[k], remote.priceHistory[k]) : series(remote.priceHistory[k], local.priceHistory[k])
        }
        m.priceHistory = history
        m.portfolioHistory = preferLocal ? series(local.portfolioHistory, remote.portfolioHistory) : series(remote.portfolioHistory, local.portfolioHistory)
        m.forecastLog = Array(list(base?.forecastLog, local.forecastLog, remote.forecastLog,
                                   key: { "\($0.cardId)|\($0.finish.rawValue)|\($0.madeOn)" }, preferLocal: preferLocal).suffix(5000))
        m.lastPriceRefresh = [local.lastPriceRefresh, remote.lastPriceRefresh].compactMap { $0 }.max()
        m.updatedAt = preferLocal ? local.updatedAt : remote.updatedAt
        m.cardCache = [:]
        m.market = nil
        m.secretLairCatalog = nil
        m.allCards = nil
        return m
    }
}

// MARK: - Encryption (PBKDF2-SHA256 + AES-256-GCM)

public struct SyncEnvelope: Codable, Hashable, Sendable {
    public var app: String
    public var v: Int
    public var profileId: String
    public var name: String
    public var updatedAt: String
    public var kdf: String
    public var iter: Int
    public var salt: String
    public var iv: String
    public var data: String
}

public enum SyncError: Error, LocalizedError {
    case wrongPassphrase, unsupported, badToken, http(Int)
    public var errorDescription: String? {
        switch self {
        case .wrongPassphrase: return "Couldn't decrypt the synced data. Check that the sync passphrase matches your other devices."
        case .unsupported: return "Encryption isn't available on this platform."
        case .badToken: return "GitHub rejected the token. Create a new one with the 'gist' permission."
        case .http(let s): return "GitHub error \(s)"
        }
    }
}

public enum SyncCrypto {
    public static let iterations = 210_000

    static func randomBytes(_ n: Int) -> Data {
        Data((0..<n).map { _ in UInt8.random(in: 0...255) })
    }

    static func deriveKey(_ passphrase: String, salt: Data, iter: Int) throws -> Data {
        #if canImport(CommonCrypto)
        var key = Data(count: 32)
        let pass = Array(passphrase.utf8)
        let status = key.withUnsafeMutableBytes { keyBuf in
            salt.withUnsafeBytes { saltBuf in
                CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),
                                     pass.map { Int8(bitPattern: $0) }, pass.count,
                                     saltBuf.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                     CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iter),
                                     keyBuf.bindMemory(to: UInt8.self).baseAddress, 32)
            }
        }
        guard Int(status) == kCCSuccess else { throw SyncError.unsupported }
        return key
        #else
        throw SyncError.unsupported
        #endif
    }

    public static func encrypt(_ p: Profile, passphrase: String, salt: Data? = nil, iv: Data? = nil, iter: Int = iterations) throws -> SyncEnvelope {
        #if canImport(CryptoKit)
        let salt = salt ?? randomBytes(16)
        let iv = iv ?? randomBytes(12)
        let key = SymmetricKey(data: try deriveKey(passphrase, salt: salt, iter: iter))
        let plain = try JSONEncoder().encode(SyncMerge.forSync(p))
        let box = try AES.GCM.seal(plain, using: key, nonce: AES.GCM.Nonce(data: iv))
        return SyncEnvelope(app: "equipworthy", v: 1, profileId: p.id, name: p.name, updatedAt: p.updatedAt, kdf: "PBKDF2-SHA256", iter: iter,
                            salt: salt.base64EncodedString(), iv: iv.base64EncodedString(), data: (box.ciphertext + box.tag).base64EncodedString())
        #else
        throw SyncError.unsupported
        #endif
    }

    public static func decrypt(_ env: SyncEnvelope, passphrase: String) throws -> Profile {
        #if canImport(CryptoKit)
        guard let salt = Data(base64Encoded: env.salt), let iv = Data(base64Encoded: env.iv), let data = Data(base64Encoded: env.data), data.count >= 16 else {
            throw SyncError.wrongPassphrase
        }
        let key = SymmetricKey(data: try deriveKey(passphrase, salt: salt, iter: env.iter))
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: iv), ciphertext: data.dropLast(16), tag: data.suffix(16))
            let plain = try AES.GCM.open(box, using: key)
            return SyncMerge.forSync(try JSONDecoder().decode(Profile.self, from: plain))
        } catch {
            throw SyncError.wrongPassphrase
        }
        #else
        throw SyncError.unsupported
        #endif
    }
}

// MARK: - GitHub Gist storage

public struct SyncConfig: Codable, Hashable, Sendable {
    public var token: String
    public var passphrase: String
    public var gistId: String?
    public var autoSync: Bool
    public init(token: String, passphrase: String, gistId: String? = nil, autoSync: Bool = true) {
        self.token = token; self.passphrase = passphrase; self.gistId = gistId; self.autoSync = autoSync
    }
}

public struct GistStore: Sendable {
    public static let description = "EquipWorthy sync (encrypted)"
    public static func fileName(_ profileId: String) -> String { "equipworthy-\(profileId).json" }

    let token: String
    public init(token: String) { self.token = token }

    struct GistFile: Decodable { var filename: String; var content: String?; var truncated: Bool?; var raw_url: String }
    struct Gist: Decodable { var id: String; var description: String?; var files: [String: GistFile] }

    private func request(_ path: String, method: String = "GET", body: Any? = nil) async throws -> Data {
        var req = URLRequest(url: URL(string: "https://api.github.com\(path)")!)
        req.httpMethod = method
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        if let body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw SyncError.badToken }
        guard (200..<300).contains(status) else { throw SyncError.http(status) }
        return data
    }

    public func ensureGist(_ known: String?) async throws -> String {
        if let known { return known }
        for page in 1...10 {
            let list = try JSONDecoder().decode([Gist].self, from: try await request("/gists?per_page=100&page=\(page)"))
            if let g = list.first(where: { $0.description == Self.description }) { return g.id }
            if list.count < 100 { break }
        }
        let created = try await request("/gists", method: "POST", body: [
            "description": Self.description, "public": false,
            "files": ["README.md": ["content": "Encrypted EquipWorthy profiles. Only readable with your sync passphrase. Don't edit by hand."]],
        ])
        return try JSONDecoder().decode(Gist.self, from: created).id
    }

    private func content(_ f: GistFile) async throws -> Data {
        if f.truncated != true, let c = f.content { return Data(c.utf8) }
        guard let url = URL(string: f.raw_url) else { throw SyncError.http(0) }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return try await URLSession.shared.data(for: req).0
    }

    public func list(_ gistId: String) async throws -> [SyncEnvelope] {
        let g = try JSONDecoder().decode(Gist.self, from: try await request("/gists/\(gistId)"))
        var out: [SyncEnvelope] = []
        for f in g.files.values where f.filename.hasPrefix("equipworthy-") && f.filename.hasSuffix(".json") {
            if let env = try? JSONDecoder().decode(SyncEnvelope.self, from: try await content(f)) { out.append(env) }
        }
        return out
    }

    public func read(_ gistId: String, profileId: String) async throws -> SyncEnvelope? {
        let g = try JSONDecoder().decode(Gist.self, from: try await request("/gists/\(gistId)"))
        guard let f = g.files[Self.fileName(profileId)] else { return nil }
        return try JSONDecoder().decode(SyncEnvelope.self, from: try await content(f))
    }

    public func write(_ gistId: String, _ env: SyncEnvelope) async throws {
        let json = String(decoding: try JSONEncoder().encode(env), as: UTF8.self)
        _ = try await request("/gists/\(gistId)", method: "PATCH", body: ["files": [Self.fileName(env.profileId): ["content": json]]])
    }
}

public struct SyncResult: Sendable {
    public var merged: Profile
    public var changedLocal: Bool
    public var pushed: Bool
    public var gistId: String
}

public enum Syncer {
    /// Pull, merge with the local profile, push if anything changed.
    public static func syncOnce(_ cfg: SyncConfig, local: Profile, base: Profile?) async throws -> SyncResult {
        let store = GistStore(token: cfg.token)
        let gistId = try await store.ensureGist(cfg.gistId)
        let localS = SyncMerge.forSync(local)
        guard let env = try await store.read(gistId, profileId: local.id) else {
            try await store.write(gistId, try SyncCrypto.encrypt(localS, passphrase: cfg.passphrase))
            return SyncResult(merged: localS, changedLocal: false, pushed: true, gistId: gistId)
        }
        let remote = try SyncCrypto.decrypt(env, passphrase: cfg.passphrase)
        let merged = SyncMerge.profiles(base: base.map(SyncMerge.forSync), local: localS, remote: remote)
        let pushed = merged != remote
        if pushed { try await store.write(gistId, try SyncCrypto.encrypt(merged, passphrase: cfg.passphrase)) }
        return SyncResult(merged: merged, changedLocal: merged != localS, pushed: pushed, gistId: gistId)
    }
}
