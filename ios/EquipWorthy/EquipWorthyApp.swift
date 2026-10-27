import SwiftUI
import BackgroundTasks
import UserNotifications
import EquipWorthyKit

@main
struct EquipWorthyApp: App {
    @StateObject private var store = ProfileStore()
    @Environment(\.scenePhase) private var phase

    init() {
        BackgroundRefresh.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .tint(Theme.accent)
                .task {
                    if Snapshot.needsRefresh(store.profile) { await store.refreshPrices() }
                }
        }
        .onChange(of: phase) { _, newPhase in
            switch newPhase {
            case .background, .inactive:
                store.saveNowBlocking()
                BackgroundRefresh.schedule()
            case .active:
                Task { if Snapshot.needsRefresh(store.profile) { await store.refreshPrices() } }
            @unknown default:
                break
            }
        }
    }
}

enum Theme {
    static let accent = Color(red: 0.80, green: 0.60, blue: 0.18)
    static let up = Color.green
    static let down = Color.red
}

/// Daily background price refresh + local notifications for watchlist alerts.
enum BackgroundRefresh {
    static let id = "com.equipworthy.refresh"

    static func register() {
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
