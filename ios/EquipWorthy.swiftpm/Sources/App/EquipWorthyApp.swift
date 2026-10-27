import SwiftUI
import BackgroundTasks
import UserNotifications
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

@main
struct EquipWorthyApp: App {
    @StateObject private var store = ProfileStore()
    @StateObject private var sync = SyncManager()
    @Environment(\.scenePhase) private var phase

    init() {
        BackgroundRefresh.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(sync)
                .tint(Theme.accent)
                .task {
                    sync.attach(store)
                    if Snapshot.needsRefresh(store.profile) { await store.refreshPrices() }
                }
        }
        .onChange(of: phase) { _, newPhase in
            switch newPhase {
            case .background, .inactive:
                store.saveNowBlocking()
                BackgroundRefresh.schedule()
            case .active:
                sync.appBecameActive()
                Task { if Snapshot.needsRefresh(store.profile) { await store.refreshPrices() } }
            @unknown default:
                break
            }
        }
    }
}

/// Sky blue, violet and mustard gold.
enum Theme {
    static let sky = Color(red: 0.31, green: 0.70, blue: 0.96)     // #4FB3F6
    static let violet = Color(red: 0.42, green: 0.29, blue: 0.82)  // #6A4BD1
    static let gold = Color(red: 0.85, green: 0.65, blue: 0.13)    // #D9A520
    static let accent = violet
    static let up = Color.green
    static let down = Color.red
    static let gradient = LinearGradient(colors: [sky, violet], startPoint: .topLeading, endPoint: .bottomTrailing)

    static func player(_ name: String) -> Color {
        switch name {
        case "sky": return sky
        case "violet": return Color(red: 0.54, green: 0.42, blue: 0.94)
        case "gold": return gold
        case "teal": return Color(red: 0.17, green: 0.70, blue: 0.64)
        case "rose": return Color(red: 0.88, green: 0.38, blue: 0.49)
        default: return Color(red: 0.48, green: 0.53, blue: 0.66)
        }
    }
}

/// Daily background price refresh + local notifications for watchlist alerts.
enum BackgroundRefresh {
    static let id = "com.equipworthy.refresh"

    /// Background refresh needs Info.plist keys that Swift Playgrounds can't
    /// add. When they're missing (Playgrounds builds) prices refresh whenever
    /// the app is opened instead.
    static var isAvailable: Bool {
        let ids = Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String] ?? []
        return ids.contains(id)
    }

    static func register() {
        guard isAvailable else { return }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { return }
            schedule()
            let work = Task {
                guard let activeId = UserDefaults.standard.string(forKey: "ew.activeProfile"),
                      var p = ProfileStore.load(id: activeId) else { task.setTaskCompleted(success: true); return }
                do {
                    let fresh = try await Scryfall.shared.collection(Snapshot.trackedIds(p).map { .id($0) })
                    let before = Set(p.alerts.map(\.id))
                    p = Snapshot.apply(p, fresh: fresh)
                    p.updatedAt = isoNow()
                    try JSONEncoder().encode(p).write(to: ProfileStore.url(for: p.id), options: .atomic)
                    if p.settings.notifications { Notifier.post(p.alerts.filter { !before.contains($0.id) }) }
                    task.setTaskCompleted(success: true)
                } catch {
                    task.setTaskCompleted(success: false)
                }
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    static func schedule() {
        guard isAvailable else { return }
        let req = BGAppRefreshTaskRequest(identifier: id)
        req.earliestBeginDate = Date(timeIntervalSinceNow: 6 * 3600)
        try? BGTaskScheduler.shared.submit(req)
    }
}

enum Notifier {
    static func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    static func post(_ alerts: [PriceAlert]) {
        for a in alerts.prefix(5) {
            let content = UNMutableNotificationContent()
            content.title = "EquipWorthy price alert"
            content.body = a.message
            content.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: a.id, content: content, trigger: nil))
        }
    }
}
