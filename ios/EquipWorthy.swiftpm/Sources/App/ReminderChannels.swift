import Foundation
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

/// Keeps ntfy push alerts and text reminders in step with followed drops, so
/// they arrive even when EquipWorthy is closed (or on another phone).
@MainActor
final class ReminderChannels: ObservableObject {
    @Published private(set) var error: String?
    @Published private(set) var lastSync: Date?

    private weak var store: ProfileStore?
    private var lastSignature = ""
    private var running = false
    private static let smsIdsKey = "ew.sms-ids"

    func attach(_ store: ProfileStore) {
        self.store = store
        Task { await sync() }
    }

    private func signature(_ p: Profile) -> String {
        let s = p.settings
        let drops = (p.secretLair ?? []).map { "\($0.id)|\($0.marked)|\($0.saleStart ?? "")|\($0.url ?? "")|\($0.name)|\($0.owned != nil)" }
        let hour = Int(Date().timeIntervalSince1970 / 3600)
        return "\(s.ntfyEnabled)|\(s.ntfyTopic ?? "")|\(s.smsEnabled)|\(s.smsWorkerUrl ?? "")|\(drops.joined(separator: ";"))|\(hour)"
    }

    /// Schedule anything new, but only when drops or settings changed (or hourly for ntfy's rolling 3-day window).
    func sync(force: Bool = false) async {
        guard let store, !running else { return }
        let p = store.profile
        guard p.settings.ntfyEnabled || p.settings.smsEnabled else { return }
        let sig = signature(p)
        if !force && sig == lastSignature { return }
        running = true
        defer { running = false }
        do {
            try await syncNtfy(p, store: store)
            try await syncSms(store.profile)
            lastSignature = sig
            lastSync = Date()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func syncNtfy(_ p: Profile, store: ProfileStore) async throws {
        guard p.settings.ntfyEnabled, p.settings.ntfyTopic != nil else { return }
        for d in p.secretLair ?? [] {
            let plan = Channels.ntfyPlan(d)
            if plan.isEmpty { continue }
            var done: [String] = []
            for item in plan {
                let r = item.reminder
                try await Channels.ntfySend(p.settings, title: r.title, body: r.body, url: r.url, at: r.at)
                done.append(item.tag)
            }
            store.mutate { prof in
                guard let i = prof.secretLair?.firstIndex(where: { $0.id == d.id }) else { return }
                let merged = (prof.secretLair?[i].pushScheduled ?? []) + done
                prof.secretLair?[i].pushScheduled = Array(merged.suffix(40))
            }
        }
    }

    private func syncSms(_ p: Profile) async throws {
        let s = p.settings
        guard s.smsEnabled, s.smsWorkerUrl != nil, s.smsKey != nil else { return }
        let previous = UserDefaults.standard.stringArray(forKey: Self.smsIdsKey) ?? []
        let payload = Channels.smsPayload(p.secretLair ?? [], previousIds: previous)
        if payload.reminders.isEmpty && payload.remove.isEmpty { return }
        try await Channels.smsSync(s, payload: payload)
        UserDefaults.standard.set(payload.reminders.map(\.id), forKey: Self.smsIdsKey)
    }
}
