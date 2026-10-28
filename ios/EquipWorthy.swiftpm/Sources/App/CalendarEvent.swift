import SwiftUI
import EventKit
import EventKitUI
#if canImport(EquipWorthyKit)
import EquipWorthyKit
#endif

/// Shows the system "Add Event" sheet for a drop, with alerts 24 h, 1 h, 15 min
/// and 5 min before the sale and when it opens. The user reviews and taps Add,
/// so no calendar permission is needed.
struct CalendarEventSheet: UIViewControllerRepresentable {
    let drop: SecretLairDrop
    @Environment(\.dismiss) private var dismiss

    static let offsets: [TimeInterval] = SecretLair.reminders.map { -$0.before }

    func makeCoordinator() -> Coordinator { Coordinator(dismiss: { dismiss() }) }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        let start = drop.saleStart.flatMap(parseISO) ?? Date()
        let url = SecretLair.launchURL(drop)
        event.title = "Secret Lair: \(drop.name)"
        event.startDate = start
        event.endDate = start.addingTimeInterval(30 * 60)
        event.url = url
        event.notes = "Open the drop page a few minutes early. If a waiting room appears, join it and leave that tab alone.\n\(url.absoluteString)"
        event.alarms = Self.offsets.map { EKAlarm(relativeOffset: $0) }
        let vc = EKEventEditViewController()
        vc.eventStore = store
        vc.event = event
        vc.editViewDelegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: EKEventEditViewController, context: Context) {}

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        let dismiss: () -> Void
        init(dismiss: @escaping () -> Void) { self.dismiss = dismiss }
        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            dismiss()
        }
    }
}
