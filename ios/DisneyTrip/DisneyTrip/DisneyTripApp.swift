import SwiftUI
import UIKit

/// Disney Trip loads the live family planner. The website stays the source of the plan.
@main
struct DisneyTripApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var trip = TripStore()

    var body: some Scene {
        WindowGroup {
            RootView(trip: trip)
        }
    }
}

struct RootView: View {
    @ObservedObject var trip: TripStore
    @State private var changing = false

    var body: some View {
        Group {
            if let key = trip.key {
                WebScreen(tripKey: key, onChangeTrip: { changing = true })
            } else {
                TripLinkView(currentKey: nil, onSave: { trip.save($0) })
            }
        }
        .background(Color("LaunchBackground").ignoresSafeArea())
        .sheet(isPresented: $changing) {
            TripLinkView(
                currentKey: trip.key,
                onSave: { newKey in
                    trip.save(newKey)
                    changing = false
                },
                onCancel: { changing = false }
            )
        }
        .onAppear(perform: openChangeTripIfRequested)
        .onReceive(NotificationCenter.default.publisher(for: .changeTrip)) { _ in
            openChangeTripIfRequested()
        }
    }

    private func openChangeTripIfRequested() {
        guard ShortcutRelay.consume(), trip.key != nil else { return }
        changing = true
    }
}

extension Notification.Name {
    static let changeTrip = Notification.Name("familyTrip.changeTrip")
}

/// Home Screen quick action. A free Apple ID can register shortcut items; they are not an entitlement.
enum ShortcutRelay {
    static let changeTripType = "change-trip"
    private static var pending = false

    @discardableResult
    static func note(_ item: UIApplicationShortcutItem) -> Bool {
        guard item.type == changeTripType else { return false }
        pending = true
        NotificationCenter.default.post(name: .changeTrip, object: nil)
        return true
    }

    static func consume() -> Bool {
        let value = pending
        pending = false
        return value
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        if let item = launchOptions?[.shortcutItem] as? UIApplicationShortcutItem {
            ShortcutRelay.note(item)
        }
        return true
    }

    func application(
        _ application: UIApplication,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        completionHandler(ShortcutRelay.note(shortcutItem))
    }
}
