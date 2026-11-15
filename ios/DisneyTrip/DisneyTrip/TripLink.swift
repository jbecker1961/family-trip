import SwiftUI
import UIKit

/// Where the app navigates, and how a pasted trip link becomes a key.
/// The website's own rule is `?t=` plus 24–64 lowercase letters and digits.
enum Site {
    /// Change this if the GitHub Pages address moves. The iPhone app loads this URL.
    static let home = URL(string: "https://jbecker1961.github.io/family-trip/")!

    static func pageURL(key: String) -> URL {
        guard var parts = URLComponents(url: home, resolvingAgainstBaseURL: false) else { return home }
        parts.queryItems = [URLQueryItem(name: "t", value: key)]
        return parts.url ?? home
    }

    static func isValidKey(_ key: String) -> Bool {
        key.range(of: "^[a-z0-9]{24,64}$", options: .regularExpression) != nil
    }

    /// A full trip link, a message that contains one, or the bare key.
    static func key(from raw: String) -> String? {
        let trimmed = raw
            .replacingOccurrences(of: "\u{200b}", with: "")
            .replacingOccurrences(of: "\u{feff}", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let found = queryKey(in: trimmed) { return found }
        let lowered = trimmed.lowercased()
        if isValidKey(lowered) { return lowered }
        let separators = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\"'<>()[]"))
        for token in lowered.components(separatedBy: separators) where !token.isEmpty {
            let piece = token.trimmingCharacters(in: CharacterSet(charactersIn: ".,;:"))
            if isValidKey(piece) { return piece }
            if let found = queryKey(in: piece) { return found }
        }
        return nil
    }

    /// Pages on the planner stay in the app. Other http(s) links go to Safari.
    static func isInApp(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return false }
        guard url.host?.lowercased() == home.host?.lowercased() else { return false }
        let prefix = home.path.hasSuffix("/") ? String(home.path.dropLast()) : home.path
        return url.path == prefix || url.path.hasPrefix(prefix + "/")
    }

    static func shouldOpenOutside(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "http" || scheme == "https" { return !isInApp(url) }
        return ["mailto", "tel", "sms", "facetime", "maps"].contains(scheme)
    }

    static func httpsURL(_ url: URL) -> URL {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "http" else { return url }
        parts.scheme = "https"
        return parts.url ?? url
    }

    private static func queryKey(in string: String) -> String? {
        let pattern = "(?:[?&]|^)[tT]=([A-Za-z0-9]{24,64})(?![A-Za-z0-9])"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(string.startIndex..., in: string)
        guard let match = regex.firstMatch(in: string, options: [], range: range),
              match.numberOfRanges > 1,
              let capture = Range(match.range(at: 1), in: string) else { return nil }
        let key = string[capture].lowercased()
        return isValidKey(key) ? key : nil
    }
}

/// The trip key lives in UserDefaults. The password does not: Firebase keeps that
/// in the web view's persistent website data, the same way Safari does.
@MainActor
final class TripStore: ObservableObject {
    @Published private(set) var key: String?
    private let defaultsKey = "familyTrip.key"

    init() {
        if let saved = UserDefaults.standard.string(forKey: defaultsKey), Site.isValidKey(saved) {
            key = saved
        }
    }

    func save(_ newKey: String) {
        guard Site.isValidKey(newKey) else { return }
        UserDefaults.standard.set(newKey, forKey: defaultsKey)
        key = newKey
    }
}

struct TripLinkView: View {
    var currentKey: String?
    var onSave: (String) -> Void
    var onCancel: (() -> Void)?

    @State private var text: String
    @State private var message: String?
    @FocusState private var focused: Bool

    init(currentKey: String?, onSave: @escaping (String) -> Void, onCancel: (() -> Void)? = nil) {
        self.currentKey = currentKey
        self.onSave = onSave
        self.onCancel = onCancel
        let starting = currentKey.map { Site.pageURL(key: $0).absoluteString } ?? ""
        _text = State(initialValue: starting)
    }

    private var isChange: Bool { onCancel != nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !isChange {
                        Image("AppLogo")
                            .resizable()
                            .frame(width: 88, height: 88)
                            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .accessibilityHidden(true)
                    }
                    Text(isChange ? "Paste a different trip link" : "Open your trip")
                        .font(.largeTitle.bold())
                        .accessibilityAddTraits(.isHeader)
                    Text(isChange
                         ? "You'll enter that trip's password next. This phone then stays signed in to it."
                         : "Paste the trip link you were sent, or just the key after ?t=. You'll enter the trip password next, and this phone remembers it.")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    TextField("Trip link or key", text: $text, axis: .vertical)
                        .lineLimit(3...6)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .focused($focused)
                        .submitLabel(.go)
                        .onSubmit(submit)
                        .padding(12)
                        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .accessibilityLabel("Trip link")
                    if let message {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Button(isChange ? "Use this trip" : "Open trip", action: submit)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .frame(maxWidth: .infinity)
                    Button("Paste", action: paste)
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)
                }
                .padding(24)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .background(Color("LaunchBackground").ignoresSafeArea())
            .navigationTitle(isChange ? "Change trip" : "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(isChange ? .visible : .hidden, for: .navigationBar)
            .toolbar {
                if let onCancel {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", action: onCancel)
                    }
                }
            }
        }
        .onAppear { focused = true }
    }

    private func paste() {
        guard let value = UIPasteboard.general.string, !value.isEmpty else { return }
        text = value
        message = nil
    }

    private func submit() {
        guard let key = Site.key(from: text) else {
            message = "That doesn't look like a trip link. Paste the whole link, or the key after ?t= (24 to 64 letters and numbers)."
            return
        }
        onSave(key)
    }
}

#Preview("First run") {
    TripLinkView(currentKey: nil, onSave: { _ in })
}
