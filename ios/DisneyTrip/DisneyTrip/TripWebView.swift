import SwiftUI
import UIKit
import WebKit

enum WebPhase: Equatable {
    case browsing
    case failed(offline: Bool, detail: String)
}

/// Load state for the page. The web view itself is owned by the representable.
final class WebSession: ObservableObject {
    @Published var phase: WebPhase = .browsing
    @Published var progress: Double = 0
    @Published var offer: CalendarOffer?
    var onChangeTrip: () -> Void = {}
    var reloadHook: () -> Void = {}
    private var lastOfferAt = Date.distantPast

    func reload() {
        reloadHook()
    }

    func presentCalendar(filename: String, text: String, existingFile: URL? = nil) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let now = Date()
        guard now.timeIntervalSince(lastOfferAt) > 1.5 else { return }
        lastOfferAt = now
        let count = ICSEvents.parse(text).count
        do {
            let url = try existingFile ?? CalendarFiles.write(text: text, filename: filename)
            offer = CalendarOffer(
                filename: url.lastPathComponent,
                fileURL: url,
                ics: text,
                eventCount: count
            )
        } catch {
            lastOfferAt = .distantPast
        }
    }
}

struct WebScreen: View {
    let tripKey: String
    var onChangeTrip: () -> Void
    @StateObject private var session = WebSession()

    var body: some View {
        ZStack(alignment: .top) {
            TripWebRepresentable(session: session, tripKey: tripKey, onChangeTrip: onChangeTrip)
                .ignoresSafeArea()
            if session.phase == .browsing, session.progress > 0.01, session.progress < 0.99 {
                ProgressView(value: session.progress)
                    .progressViewStyle(.linear)
                    .tint(Color.accentColor)
                    .frame(height: 3)
                    .accessibilityLabel("Loading")
                    .allowsHitTesting(false)
            }
            if case let .failed(offline, detail) = session.phase {
                LoadFailureView(
                    offline: offline,
                    detail: detail,
                    onRetry: { session.reload() },
                    onSafari: { UIApplication.shared.open(Site.pageURL(key: tripKey)) },
                    onChangeTrip: onChangeTrip
                )
            }
        }
        .sheet(item: $session.offer) { offer in
            CalendarOfferView(offer: offer)
        }
    }
}

struct TripWebRepresentable: UIViewRepresentable {
    let session: WebSession
    let tripKey: String
    let onChangeTrip: () -> Void

    func makeCoordinator() -> TripWebCoordinator {
        TripWebCoordinator(session: session)
    }

    func makeUIView(context: Context) -> WebHostView {
        let host = WebHostView(webView: context.coordinator.makeWebView())
        context.coordinator.attach(host: host)
        return host
    }

    func updateUIView(_ host: WebHostView, context: Context) {
        context.coordinator.session.onChangeTrip = onChangeTrip
        context.coordinator.loadIfNeeded(key: tripKey)
    }

    static func dismantleUIView(_ uiView: WebHostView, coordinator: TripWebCoordinator) {
        coordinator.teardown()
    }
}

/// Edge-to-edge host. The website already pads for the notch and the home indicator
/// (`viewport-fit=cover` and `env(safe-area-inset-*)`), so the web view must run under
/// the status bar. UIKit must not add a second inset on top of that.
final class WebHostView: UIView {
    let webView: WKWebView
    var onLayout: (() -> Void)?

    init(webView: WKWebView) {
        self.webView = webView
        super.init(frame: .zero)
        backgroundColor = PageChrome.background
        webView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?()
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        onLayout?()
    }
}

enum PageChrome {
    /// Matches the spark on the app icon (`#3347D1`).
    static let accent = UIColor(red: 51 / 255, green: 71 / 255, blue: 209 / 255, alpha: 1)
    /// Matches the website's Main Street background, light and dark.
    static let background = UIColor { traits in
        if traits.userInterfaceStyle == .dark {
            return UIColor(red: 20 / 255, green: 26 / 255, blue: 38 / 255, alpha: 1)
        }
        return UIColor(red: 246 / 255, green: 243 / 255, blue: 238 / 255, alpha: 1)
    }
}

final class TripWebCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    let session: WebSession
    private(set) weak var webView: WKWebView?
    private var refreshControl: UIRefreshControl?
    private var progressObservation: NSKeyValueObservation?
    private var keyboardTokens: [NSObjectProtocol] = []
    private var loadedKey: String?
    private var hasLoaded = false
    private var recoveringFromCrash = false
    private var keyboardOverlap: CGFloat = 0
    private var downloadURL: URL?
    private var tornDown = false
    private let bridge = ScriptBridge()

    init(session: WebSession) {
        self.session = session
        super.init()
        bridge.owner = self
    }

    func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // The default store is on disk. Firebase keeps the trip sign-in there, so the
        // password survives quitting the app. An ephemeral store would ask every launch.
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsInlineMediaPlayback = true
        configuration.dataDetectorTypes = []
        // App-bound domains would turn on service workers on older iOS, and would also
        // block navigations the page needs (Firebase). Leave them off. The page works
        // without its service worker; Firestore still keeps its own offline copy.

        let controller = configuration.userContentController
        controller.addUserScript(WKUserScript(
            source: Self.pageScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        controller.add(bridge, name: "calendarFile")
        controller.add(bridge, name: "changeTrip")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.tintColor = PageChrome.accent
        webView.backgroundColor = PageChrome.background
        webView.isOpaque = true
        webView.scrollView.backgroundColor = PageChrome.background
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        webView.scrollView.alwaysBounceVertical = true
        webView.scrollView.keyboardDismissMode = .interactive
        webView.isInspectable = true
        self.webView = webView
        return webView
    }

    func attach(host: WebHostView) {
        let webView = host.webView
        let refresh = UIRefreshControl()
        refresh.tintColor = PageChrome.accent
        refresh.addTarget(self, action: #selector(refreshTriggered), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
        refreshControl = refresh
        host.onLayout = { [weak self] in
            self?.applyIndicatorInsets()
        }
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
            let value = webView.estimatedProgress
            DispatchQueue.main.async {
                self?.session.progress = value
            }
        }
        let token = NotificationCenter.default.addObserver(
            forName: UIResponder.keyboardWillChangeFrameNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            self?.adjustKeyboard(note)
        }
        keyboardTokens.append(token)
        session.reloadHook = { [weak self] in
            self?.reloadFromUser()
        }
    }

    func teardown() {
        guard !tornDown else { return }
        tornDown = true
        progressObservation?.invalidate()
        progressObservation = nil
        let center = NotificationCenter.default
        keyboardTokens.forEach { center.removeObserver($0) }
        keyboardTokens.removeAll()
        let controller = webView?.configuration.userContentController
        controller?.removeScriptMessageHandler(forName: "calendarFile")
        controller?.removeScriptMessageHandler(forName: "changeTrip")
        webView?.scrollView.refreshControl = nil
        session.reloadHook = {}
    }

    deinit {
        teardown()
    }

    func loadIfNeeded(key: String) {
        guard key != loadedKey else { return }
        beginLoad(key: key)
    }

    func requestChangeTrip() {
        webView?.endEditing(true)
        session.onChangeTrip()
    }

    func handleScript(name: String, body: Any) {
        switch name {
        case "changeTrip":
            requestChangeTrip()
        case "calendarFile":
            guard let info = body as? [String: Any],
                  let text = info["text"] as? String else { return }
            let filename = info["filename"] as? String ?? "trip.ics"
            session.presentCalendar(filename: filename, text: text)
        default:
            break
        }
    }

    private func beginLoad(key: String) {
        guard let webView else { return }
        loadedKey = key
        hasLoaded = false
        recoveringFromCrash = false
        let url = Site.pageURL(key: key)
        webView.load(URLRequest(url: url))
        // updateUIView calls this. Publish on the next turn so SwiftUI isn't mid-update.
        DispatchQueue.main.async { [weak self] in
            guard let self, self.loadedKey == key, !self.hasLoaded else { return }
            if case .failed = self.session.phase { return }
            self.session.phase = .browsing
            if self.session.progress < 0.05 { self.session.progress = 0.05 }
        }
    }

    private func reloadFromUser() {
        hasLoaded = false
        session.phase = .browsing
        session.progress = 0.05
        guard let webView else { return }
        if webView.url != nil {
            webView.reload()
        } else if let key = loadedKey {
            webView.load(URLRequest(url: Site.pageURL(key: key)))
        }
    }

    @objc private func refreshTriggered() {
        guard let webView else {
            refreshControl?.endRefreshing()
            return
        }
        if webView.url != nil {
            webView.reload()
        } else {
            reloadFromUser()
        }
    }

    private func applyIndicatorInsets() {
        guard let webView else { return }
        let safe = webView.safeAreaInsets
        var insets = webView.scrollView.verticalScrollIndicatorInsets
        insets.top = safe.top
        insets.bottom = max(safe.bottom, keyboardOverlap)
        webView.scrollView.verticalScrollIndicatorInsets = insets
    }

    private func adjustKeyboard(_ note: Notification) {
        guard let webView,
              let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let converted = webView.convert(frame, from: nil)
        keyboardOverlap = max(0, webView.bounds.intersection(converted).height)
        let duration = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        UIView.animate(withDuration: duration) {
            webView.scrollView.contentInset.bottom = self.keyboardOverlap
            self.applyIndicatorInsets()
        }
    }

    private func shouldIgnore(_ error: Error) -> Bool {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return true }
        if ns.domain == "WebKitErrorDomain" && ns.code == 102 { // frame load interrupted by policy change
            return true
        }
        return false
    }

    private func isOffline(_ error: Error) -> Bool {
        let ns = error as NSError
        guard ns.domain == NSURLErrorDomain else { return false }
        switch ns.code {
        case NSURLErrorNotConnectedToInternet,
             NSURLErrorNetworkConnectionLost,
             NSURLErrorDataNotAllowed,
             NSURLErrorInternationalRoamingOff:
            return true
        default:
            return false
        }
    }

    private func noteFailure(_ error: Error) {
        refreshControl?.endRefreshing()
        guard !shouldIgnore(error), !hasLoaded else { return }
        let offline = isOffline(error)
        let detail = offline ? "" : (error as NSError).localizedDescription
        session.phase = .failed(offline: offline, detail: detail)
        session.progress = 1
    }

    private func isCalendarResponse(_ response: URLResponse) -> Bool {
        let mime = response.mimeType?.lowercased() ?? ""
        let name = (response.suggestedFilename ?? "").lowercased()
        if mime == "text/calendar" || mime == "application/ics" || mime.contains("calendar") { return true }
        return name.hasSuffix(".ics")
    }

    // MARK: Navigation

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "blob" || scheme == "javascript" || scheme == "data" {
            decisionHandler(.cancel)
            return
        }
        // Same-window taps that leave the planner (and mailto/tel) open outside.
        // target=_blank is handled in createWebViewWith; that is how FlightAware and
        // Google Calendar links are written.
        if navigationAction.navigationType == .linkActivated && Site.shouldOpenOutside(url) {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if navigationResponse.isForMainFrame && isCalendarResponse(navigationResponse.response) {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if session.progress >= 1 {
            session.progress = 0.05
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasLoaded = true
        recoveringFromCrash = false
        refreshControl?.endRefreshing()
        session.phase = .browsing
        session.progress = 1
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        noteFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        noteFailure(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        refreshControl?.endRefreshing()
        if recoveringFromCrash {
            hasLoaded = false
            recoveringFromCrash = false
            session.phase = .failed(offline: false, detail: "The page stopped unexpectedly.")
            session.progress = 1
            return
        }
        recoveringFromCrash = true
        webView.reload()
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        if Site.isInApp(url) {
            webView.load(URLRequest(url: Site.httpsURL(url)))
        } else if Site.shouldOpenOutside(url) {
            UIApplication.shared.open(url)
        }
        return nil
    }

    // MARK: Downloads

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let name = CalendarFiles.safeFilename(suggestedFilename.isEmpty ? "trip.ics" : suggestedFilename)
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("ics-\(UUID().uuidString)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(name)
            downloadURL = url
            completionHandler(url)
        } catch {
            completionHandler(nil)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloadURL,
              let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        session.presentCalendar(filename: url.lastPathComponent, text: text, existingFile: url)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadURL = nil
    }

    /// Installed in the page, not in the website. It catches the .ics blob the planner
    /// creates for Apple Calendar, and adds "Open a different trip" under Sign out.
    private static let pageScript = #"""
    (function () {
      if (window.__disneyTripNative) return;
      window.__disneyTripNative = true;

      function bridge(name) {
        var webkit = window.webkit;
        if (!webkit || !webkit.messageHandlers) return null;
        return webkit.messageHandlers[name] || null;
      }

      document.addEventListener("click", function (event) {
        var node = event.target;
        if (!node || !node.closest) return;
        var link = node.closest("a[download]");
        if (!link) return;
        var href = link.href || "";
        if (href.indexOf("blob:") !== 0) return;
        var name = link.getAttribute("download") || "trip.ics";
        if (!/\.ics$/i.test(name)) return;
        var calendar = bridge("calendarFile");
        if (!calendar) return;
        event.preventDefault();
        event.stopPropagation();
        fetch(href).then(function (response) {
          return response.text();
        }).then(function (text) {
          calendar.postMessage({ filename: name, text: text });
        }).catch(function () {});
      }, true);

      var scheduled = false;
      function installChangeTrip() {
        if (document.getElementById("native-change-trip")) return;
        var signout = document.querySelector('[data-act="signout"]');
        if (!signout || !signout.parentNode || !signout.parentNode.parentNode) return;
        var wrap = document.createElement("div");
        wrap.id = "native-change-trip";
        var button = document.createElement("button");
        button.type = "button";
        button.className = "btn ghost small";
        button.textContent = "Open a different trip";
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          var change = bridge("changeTrip");
          if (change) change.postMessage("");
        });
        wrap.appendChild(button);
        signout.parentNode.parentNode.insertBefore(wrap, signout.parentNode.nextSibling);
      }

      function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
          scheduled = false;
          installChangeTrip();
        });
      }

      var root = document.documentElement;
      if (root) {
        new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
      }
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", schedule);
      } else {
        schedule();
      }
    })();
    """#
}

private final class ScriptBridge: NSObject, WKScriptMessageHandler {
    weak var owner: TripWebCoordinator?

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        let name = message.name
        let body = message.body
        DispatchQueue.main.async { [weak owner] in
            owner?.handleScript(name: name, body: body)
        }
    }
}

struct LoadFailureView: View {
    var offline: Bool
    var detail: String
    var onRetry: () -> Void
    var onSafari: () -> Void
    var onChangeTrip: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Image(systemName: offline ? "wifi.slash" : "exclamationmark.triangle")
                    .font(.system(size: 44))
                    .foregroundStyle(Color.accentColor)
                    .accessibilityHidden(true)
                    .padding(.top, 24)
                Text(offline ? "You're offline" : "Can't open the trip")
                    .font(.title2.bold())
                    .accessibilityAddTraits(.isHeader)
                Text(offline
                     ? "The first time you open the trip, the phone needs a connection. After that, a weak signal is enough for most of the plan."
                     : "Check the connection and try again.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if !detail.isEmpty {
                    Text(detail)
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button("Try again", action: onRetry)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                Button("Open in Safari", action: onSafari)
                Button("Change trip", action: onChangeTrip)
            }
            .padding(28)
            .frame(maxWidth: 480)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("LaunchBackground").ignoresSafeArea())
    }
}

#Preview("Offline") {
    LoadFailureView(offline: true, detail: "", onRetry: {}, onSafari: {}, onChangeTrip: {})
}
