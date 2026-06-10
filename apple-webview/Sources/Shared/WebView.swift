import SwiftUI
import WebKit
#if os(macOS)
import AppKit
typealias PlatformViewRepresentable = NSViewRepresentable
#else
import UIKit
typealias PlatformViewRepresentable = UIViewRepresentable
#endif

/// A single WKWebView reused across reloads. Cross-platform: the same struct
/// vends an NSView on macOS and a UIView on iOS.
struct WebView: PlatformViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    private func makeWebView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()   // persist cookies/localStorage (session token)
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.load(URLRequest(url: url))
        return web
    }

    #if os(macOS)
    func makeNSView(context: Context) -> WKWebView { makeWebView(context: context) }
    func updateNSView(_ nsView: WKWebView, context: Context) {
        if nsView.url?.absoluteString != url.absoluteString { nsView.load(URLRequest(url: url)) }
    }
    #else
    func makeUIView(context: Context) -> WKWebView { makeWebView(context: context) }
    func updateUIView(_ uiView: WKWebView, context: Context) {
        if uiView.url?.absoluteString != url.absoluteString { uiView.load(URLRequest(url: url)) }
    }
    #endif

    final class Coordinator: NSObject, WKNavigationDelegate {
        let parent: WebView
        init(_ parent: WebView) { self.parent = parent }

        /// Keep app-shell navigation on the configured host; send off-host
        /// links (external sites, OAuth pop-outs, mailto, etc.) to the system
        /// browser instead of loading arbitrary pages inside the wrapper.
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
            let scheme = url.scheme?.lowercased() ?? ""
            let appHost = parent.url.host
            let sameHost = url.host == appHost
            let webScheme = (scheme == "http" || scheme == "https")

            // Allow same-host web navigation and non-web app schemes handled by
            // WebKit internally (about:, blob:, data:).
            if sameHost || !webScheme {
                if !webScheme && scheme != "about" && scheme != "blob" && scheme != "data" {
                    openExternally(url); decisionHandler(.cancel); return
                }
                decisionHandler(.allow); return
            }
            // Off-host http(s) → open in the user's real browser.
            openExternally(url)
            decisionHandler(.cancel)
        }

        private func openExternally(_ url: URL) {
            #if os(macOS)
            _ = NSWorkspace.shared.open(url)
            #else
            UIApplication.shared.open(url)
            #endif
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
            parent.loadError = nil
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
            parent.loadError = error.localizedDescription
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
            parent.loadError = error.localizedDescription
        }
    }
}
