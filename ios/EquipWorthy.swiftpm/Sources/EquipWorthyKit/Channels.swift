import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Extra ways to deliver Secret Lair reminders, matching the web app:
///   - ntfy: free push alerts through the ntfy app (scheduled up to 3 days ahead)
///   - text messages: your own EquipWorthy SMS worker (Twilio), scheduled any time ahead
public enum Channels {
    /// ntfy.sh holds scheduled messages for up to 3 days.
    public static let ntfyMaxAhead: TimeInterval = 3 * 86400 - 10 * 60

    public struct ChannelError: LocalizedError {
        public let message: String
        public init(_ message: String) { self.message = message }
        public var errorDescription: String? { message }
    }

    /// A hard-to-guess topic name; anyone who knows it can read the alerts.
    public static func newTopic() -> String {
        let chars = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return "equipworthy-" + String((0..<18).map { _ in chars.randomElement()! })
    }

    static func trimSlash(_ s: String) -> String {
        var t = s.trimmingCharacters(in: .whitespaces)
        while t.hasSuffix("/") { t.removeLast() }
        return t
    }

    // MARK: ntfy

    public struct NtfyItem: Sendable {
        public let reminder: SecretLair.Planned
        public let tag: String
    }

    /// Which ntfy reminders still need scheduling, and their "key@saleStart" tags.
    public static func ntfyPlan(_ d: SecretLairDrop, now: Date = Date()) -> [NtfyItem] {
        let done = Set(d.pushScheduled ?? [])
        let start = d.saleStart ?? ""
        var out: [NtfyItem] = []
        for r in SecretLair.planned(d, now: now) where r.at.timeIntervalSince(now) <= ntfyMaxAhead {
            let tag = "\(r.key)@\(start)"
            if !done.contains(tag) { out.append(NtfyItem(reminder: r, tag: tag)) }
        }
        return out
    }

    public static func ntfyRequest(server: String, topic: String, title: String, body: String, url: URL? = nil, at: Date? = nil) throws -> URLRequest {
        let base = trimSlash(server.isEmpty ? "https://ntfy.sh" : server)
        let encoded = topic.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? topic
        guard !topic.isEmpty, let u = URL(string: "\(base)/\(encoded)") else { throw ChannelError("No ntfy topic set") }
        var req = URLRequest(url: u)
        req.httpMethod = "POST"
        req.setValue(title, forHTTPHeaderField: "Title")
        req.setValue("sparkles", forHTTPHeaderField: "Tags")
        req.setValue("high", forHTTPHeaderField: "Priority")
        if let url { req.setValue(url.absoluteString, forHTTPHeaderField: "Click") }
        if let at { req.setValue(String(Int(at.timeIntervalSince1970)), forHTTPHeaderField: "At") }
        req.httpBody = Data(body.utf8)
        return req
    }

    public static func ntfySend(_ s: AppSettings, title: String, body: String, url: URL? = nil, at: Date? = nil) async throws {
        guard let topic = s.ntfyTopic, !topic.isEmpty else { throw ChannelError("No ntfy topic set") }
        let req = try ntfyRequest(server: s.ntfyServer, topic: topic, title: title, body: body, url: url, at: at)
        let (_, res) = try await URLSession.shared.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(code) { throw ChannelError("ntfy returned \(code)") }
    }

    public static func testNtfy(_ s: AppSettings) async throws {
        try await ntfySend(s, title: "EquipWorthy", body: "Push alerts are working. 🎉")
    }

    // MARK: Text messages

    public struct SmsReminder: Codable, Hashable, Sendable {
        public var id: String
        public var at: String
        public var body: String
        public var url: String
    }

    public struct SmsPayload: Codable, Hashable, Sendable {
        public var reminders: [SmsReminder]
        public var remove: [String]
    }

    /// Everything the SMS worker should hold: all future reminders, plus ids to remove.
    public static func smsPayload(_ drops: [SecretLairDrop], previousIds: [String], now: Date = Date()) -> SmsPayload {
        let reminders = drops.flatMap { SecretLair.planned($0, now: now) }.map {
            SmsReminder(id: $0.id, at: isoNow($0.at), body: "\($0.title): \($0.body)", url: $0.url.absoluteString)
        }
        let keep = Set(reminders.map(\.id))
        return SmsPayload(reminders: reminders, remove: previousIds.filter { !keep.contains($0) })
    }

    public static func smsRequest(_ s: AppSettings, path: String, body: Data) throws -> URLRequest {
        guard let base = s.smsWorkerUrl, !base.isEmpty, let key = s.smsKey, !key.isEmpty,
              let u = URL(string: trimSlash(base) + path), u.scheme == "https"
        else { throw ChannelError("Text reminders aren't set up") }
        var req = URLRequest(url: u)
        req.httpMethod = "POST"
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        return req
    }

    private static func smsPost(_ s: AppSettings, path: String, body: Data) async throws {
        let req = try smsRequest(s, path: path, body: body)
        let (data, res) = try await URLSession.shared.data(for: req)
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(code) {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            if let e = obj?["error"] as? String { throw ChannelError("Text service: \(e)") }
            throw ChannelError("Text service returned \(code)")
        }
    }

    public static func smsSync(_ s: AppSettings, payload: SmsPayload) async throws {
        try await smsPost(s, path: "/reminders", body: try JSONEncoder().encode(payload))
    }

    public static func testSms(_ s: AppSettings) async throws {
        try await smsPost(s, path: "/test", body: Data("{}".utf8))
    }
}
