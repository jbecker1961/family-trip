import EventKit
import SwiftUI
import UIKit

struct CalendarOffer: Identifiable {
    let id = UUID()
    let filename: String
    let fileURL: URL
    let ics: String
    let eventCount: Int
}

enum CalendarFiles {
    static func safeFilename(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: " -_."))
        let mapped = String(trimmed.unicodeScalars.map { scalar in
            allowed.contains(scalar) ? Character(scalar) : "-"
        })
        var name = mapped
        while name.contains("--") {
            name = name.replacingOccurrences(of: "--", with: "-")
        }
        name = name.trimmingCharacters(in: CharacterSet(charactersIn: "-. "))
        if name.isEmpty { name = "trip" }
        if !name.lowercased().hasSuffix(".ics") { name += ".ics" }
        if name.count > 60 {
            let end = name.index(name.startIndex, offsetBy: 56)
            name = String(name[..<end]).trimmingCharacters(in: CharacterSet(charactersIn: "-. ")) + ".ics"
        }
        return name
    }

    static func write(text: String, filename: String) throws -> URL {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("ics-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent(safeFilename(filename))
        try text.write(to: url, atomically: true, encoding: .utf8)
        return url
    }
}

/// The planner builds an .ics file in the page (a blob the web view will not hand to
/// Calendar on its own). We parse that file and add the events, remembering each plan's
/// id so adding it again updates the event. The share sheet is the other way out.
@MainActor
enum CalendarAdder {
    enum Result {
        case added(Int)
        case denied
        case noCalendar
        case failed(String)
    }

    private static let store = EKEventStore()
    private static let mapKey = "familyTrip.calendarEventIDs"

    static func add(ics text: String) async -> Result {
        let parsed = ICSEvents.parse(text)
        guard !parsed.isEmpty else {
            return .failed("That file didn't contain any plans.")
        }
        guard await requestAccess() else { return .denied }
        guard let calendar = store.defaultCalendarForNewEvents else { return .noCalendar }

        var map = UserDefaults.standard.dictionary(forKey: mapKey) as? [String: String] ?? [:]
        var saved = 0
        do {
            for item in parsed {
                let existing = map[item.uid].flatMap { store.event(withIdentifier: $0) }
                let event = existing ?? EKEvent(eventStore: store)
                if event.calendar == nil { event.calendar = calendar }
                event.title = item.summary
                event.notes = item.notes.isEmpty ? nil : item.notes
                event.location = item.location.isEmpty ? nil : item.location
                event.isAllDay = item.allDay
                event.timeZone = item.allDay ? nil : item.timeZone
                event.startDate = item.start
                event.endDate = item.end
                try store.save(event, span: .thisEvent)
                // Nil until the event is saved. Read it loosely so a String vs String? overlay still compiles.
                let identifier = (event.value(forKey: "eventIdentifier") as? String) ?? ""
                if !identifier.isEmpty { map[item.uid] = identifier }
                saved += 1
            }
            UserDefaults.standard.set(map, forKey: mapKey)
            return .added(saved)
        } catch {
            UserDefaults.standard.set(map, forKey: mapKey)
            if saved > 0 {
                let noun = saved == 1 ? "1 plan" : "\(saved) plans"
                return .failed("Added \(noun), then Calendar stopped. Share the file if something is missing.")
            }
            return .failed("Couldn't add those plans to Calendar. Share the file and open it in Calendar instead.")
        }
    }

    private static func requestAccess() async -> Bool {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess:
            return true
        case .denied, .restricted:
            return false
        default:
            do {
                return try await store.requestFullAccessToEvents()
            } catch {
                return false
            }
        }
    }
}

/// A small reader for the calendar files this website writes. Times stay in the park's time zone.
enum ICSEvents {
    struct Event {
        var uid: String
        var summary: String
        var notes: String
        var location: String
        var start: Date
        var end: Date
        var allDay: Bool
        var timeZone: TimeZone?
    }

    static func parse(_ text: String) -> [Event] {
        var events: [Event] = []
        var inEvent = false
        var uid = ""
        var summary = ""
        var notes = ""
        var location = ""
        var start: When?
        var end: When?

        func flush() {
            guard let start else { return }
            let endDate = end?.date ?? start.date.addingTimeInterval(start.allDay ? 86_400 : 3_600)
            let finalEnd = endDate > start.date ? endDate : start.date.addingTimeInterval(start.allDay ? 86_400 : 3_600)
            let title = summary.trimmingCharacters(in: .whitespacesAndNewlines)
            let stable = uid.isEmpty ? "\(title)#\(start.date.timeIntervalSince1970)" : uid
            events.append(Event(
                uid: stable,
                summary: title.isEmpty ? "Plan" : title,
                notes: notes,
                location: location,
                start: start.date,
                end: finalEnd,
                allDay: start.allDay,
                timeZone: start.allDay ? nil : start.timeZone
            ))
        }

        for line in unfold(text) {
            if line == "BEGIN:VEVENT" {
                inEvent = true
                uid = ""
                summary = ""
                notes = ""
                location = ""
                start = nil
                end = nil
                continue
            }
            if line == "END:VEVENT" {
                if inEvent { flush() }
                inEvent = false
                continue
            }
            guard inEvent, let property = split(line) else { continue }
            switch property.name {
            case "UID":
                uid = unescape(property.value)
            case "SUMMARY":
                summary = unescape(property.value)
            case "DESCRIPTION":
                notes = unescape(property.value)
            case "LOCATION":
                location = unescape(property.value)
            case "DTSTART":
                start = parseWhen(property.value, params: property.params)
            case "DTEND":
                end = parseWhen(property.value, params: property.params)
            default:
                break
            }
        }
        return events
    }

    private struct When {
        var date: Date
        var allDay: Bool
        var timeZone: TimeZone?
    }

    private struct Property {
        var name: String
        var params: [String: String]
        var value: String
    }

    private static func unfold(_ text: String) -> [String] {
        let normalized = text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        var lines: [String] = []
        for line in normalized.split(separator: "\n", omittingEmptySubsequences: false) {
            let row = String(line)
            if (row.hasPrefix(" ") || row.hasPrefix("\t")), !lines.isEmpty {
                lines[lines.count - 1].append(contentsOf: row.dropFirst())
            } else {
                lines.append(row)
            }
        }
        return lines
    }

    private static func split(_ line: String) -> Property? {
        var escaped = false
        var colon: String.Index?
        for index in line.indices {
            let character = line[index]
            if escaped {
                escaped = false
                continue
            }
            if character == "\\" {
                escaped = true
                continue
            }
            if character == ":" {
                colon = index
                break
            }
        }
        guard let colon else { return nil }
        let left = line[..<colon]
        let value = String(line[line.index(after: colon)...])
        let parts = left.split(separator: ";", omittingEmptySubsequences: false)
        guard let name = parts.first else { return nil }
        var params: [String: String] = [:]
        for part in parts.dropFirst() {
            let pair = part.split(separator: "=", maxSplits: 1)
            guard pair.count == 2 else { continue }
            let raw = String(pair[1]).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            params[String(pair[0]).uppercased()] = raw
        }
        return Property(name: String(name).uppercased(), params: params, value: value)
    }

    private static func unescape(_ value: String) -> String {
        var output = ""
        var escaped = false
        for character in value {
            if escaped {
                switch character {
                case "n", "N": output.append("\n")
                case "\\": output.append("\\")
                case ",": output.append(",")
                case ";": output.append(";")
                default: output.append(character)
                }
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else {
                output.append(character)
            }
        }
        if escaped { output.append("\\") }
        return output
    }

    private static func parseWhen(_ value: String, params: [String: String]) -> When? {
        let kind = params["VALUE"]?.uppercased()
        if kind == "DATE" || (value.count == 8 && !value.contains("T")) {
            guard let date = floatingDate(value) else { return nil }
            return When(date: date, allDay: true, timeZone: nil)
        }
        let zone: TimeZone
        let stamp: String
        if value.hasSuffix("Z") {
            zone = TimeZone(secondsFromGMT: 0) ?? .current
            stamp = String(value.dropLast())
        } else if let identifier = params["TZID"], let parsed = TimeZone(identifier: identifier) {
            zone = parsed
            stamp = value
        } else {
            zone = .current
            stamp = value
        }
        guard let date = zonedDate(stamp, timeZone: zone) else { return nil }
        return When(date: date, allDay: false, timeZone: zone)
    }

    private static func floatingDate(_ value: String) -> Date? {
        guard value.count >= 8,
              let year = Int(value.prefix(4)),
              let month = Int(value.dropFirst(4).prefix(2)),
              let day = Int(value.dropFirst(6).prefix(2)) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        for hour in [0, 1, 2] {
            if let date = calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour)) {
                return calendar.startOfDay(for: date)
            }
        }
        return nil
    }

    private static func zonedDate(_ value: String, timeZone: TimeZone) -> Date? {
        guard value.count >= 15,
              let year = Int(value.prefix(4)),
              let month = Int(value.dropFirst(4).prefix(2)),
              let day = Int(value.dropFirst(6).prefix(2)),
              let hour = Int(value.dropFirst(9).prefix(2)),
              let minute = Int(value.dropFirst(11).prefix(2)),
              let second = Int(value.dropFirst(13).prefix(2)) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.date(from: DateComponents(
            year: year, month: month, day: day, hour: hour, minute: minute, second: second
        ))
    }
}

struct CalendarOfferView: View {
    let offer: CalendarOffer
    @Environment(\.dismiss) private var dismiss
    @State private var status: String?
    @State private var working = false
    @State private var done = false
    @State private var denied = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(summary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(offer.filename)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let status {
                        Text(status)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if offer.eventCount > 0 {
                        Button(done ? "Added" : (working ? "Adding…" : "Add to Calendar")) {
                            Task { await add() }
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .frame(maxWidth: .infinity)
                        .disabled(working || done)
                    }
                    Button("Share the file…") {
                        SharePresenter.present(fileURL: offer.fileURL)
                    }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                    if denied {
                        Button("Open Settings") {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(20)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color("LaunchBackground").ignoresSafeArea())
            .navigationTitle("Calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var summary: String {
        switch offer.eventCount {
        case 0:
            return "There's nothing in this file to add. You can still share it."
        case 1:
            return "1 plan from this trip. It goes on this iPhone's calendar. Adding it again later updates it, instead of making a second copy."
        default:
            return "\(offer.eventCount) plans from this trip. They go on this iPhone's calendar. Adding a plan again later updates it, instead of making a second copy."
        }
    }

    private func add() async {
        working = true
        denied = false
        let result = await CalendarAdder.add(ics: offer.ics)
        working = false
        switch result {
        case .added(let count):
            done = true
            status = count == 1 ? "Added 1 plan to Calendar." : "Added \(count) plans to Calendar."
        case .denied:
            denied = true
            status = "Calendar access is off for Disney Trip. Allow it in Settings, or share the file and open it in Calendar."
        case .noCalendar:
            status = "Open the Calendar app once so this iPhone has a calendar to add to, then try again. You can also share the file."
        case .failed(let message):
            status = message
        }
    }
}

@MainActor
enum SharePresenter {
    static func present(fileURL: URL) {
        let controller = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        guard let presenter = UIApplication.shared.topmostViewController else { return }
        let bounds = presenter.view.bounds
        controller.popoverPresentationController?.sourceView = presenter.view
        controller.popoverPresentationController?.sourceRect = CGRect(x: bounds.midX, y: bounds.midY, width: 1, height: 1)
        controller.popoverPresentationController?.permittedArrowDirections = []
        presenter.present(controller, animated: true)
    }
}

extension UIApplication {
    @MainActor
    var topmostViewController: UIViewController? {
        let scenes = connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let next = top?.presentedViewController {
            top = next
        }
        return top
    }
}
