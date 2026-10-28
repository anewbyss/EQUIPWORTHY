import Foundation
import UIKit
import UserNotifications
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

/// Schedules Secret Lair reminders as local notifications, so they fire even
/// when EquipWorthy is closed. Tapping one opens the drop's official page.
enum SecretLairNotifier {
    static let prefix = "sl-"

    /// Replace all scheduled drop reminders with ones matching the current drops.
    static func reschedule(_ drops: [SecretLairDrop], now: Date = Date()) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { pending in
            let stale = pending.map(\.identifier).filter { $0.hasPrefix(prefix) && !$0.contains("-queue-") }
            center.removePendingNotificationRequests(withIdentifiers: stale)
            for d in drops where d.marked && d.owned == nil {
                guard let s = d.saleStart, let start = parseISO(s) else { continue }
                for r in SecretLair.reminders {
                    let fire = start.addingTimeInterval(-r.before)
                    guard fire > now else { continue }
                    let content = UNMutableNotificationContent()
                    content.title = r.key == "open" ? "Secret Lair drop is live" : "Secret Lair reminder"
                    content.body = r.text(d.name)
                    content.sound = .default
                    content.userInfo = ["url": SecretLair.launchURL(d).absoluteString]
                    if r.key == "open" || r.key == "5m" { content.interruptionLevel = .timeSensitive }
                    let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, fire.timeIntervalSince(now)), repeats: false)
                    center.add(UNNotificationRequest(identifier: "\(prefix)\(d.id)-\(r.key)", content: content, trigger: trigger))
                }
            }
        }
    }

    /// Schedule "about 5 minutes left" and "almost through" alerts from the latest line estimate.
    static func scheduleQueue(_ d: SecretLairDrop, now: Date = Date()) {
        let center = UNUserNotificationCenter.current()
        let ids = ["soon", "near"].map { "\(prefix)\(d.id)-queue-\($0)" }
        center.removePendingNotificationRequests(withIdentifiers: ids)
        guard let q = d.queue, q.admittedAt == nil, let est = SecretLair.estimate(q, now: now), let eta = est.etaMinutes, eta > 0 else { return }
        let plan: [(String, Double, String)] = [
            ("soon", eta - 5, "About 5 minutes to go in the \(d.name) line. Get the drop page in front of you."),
            ("near", eta - 1, "Almost through the \(d.name) line!"),
        ]
        for (key, minutes, body) in plan where !q.notified.contains(key) {
            let content = UNMutableNotificationContent()
            content.title = "Secret Lair line"
            content.body = body
            content.sound = .default
            content.interruptionLevel = .timeSensitive
            content.userInfo = ["url": SecretLair.launchURL(d).absoluteString]
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, minutes * 60), repeats: false)
            center.add(UNNotificationRequest(identifier: "\(prefix)\(d.id)-queue-\(key)", content: content, trigger: trigger))
        }
    }
}

/// Opens a notification's drop link when it's tapped, and shows banners while the app is open.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let s = response.notification.request.content.userInfo["url"] as? String, let url = URL(string: s) {
            DispatchQueue.main.async { UIApplication.shared.open(url) }
        }
        completionHandler()
    }
}
