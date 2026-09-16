import AppKit
import ApplicationServices
import Foundation

struct Sample: Encodable {
    var at: String
    var appId: String?
    var appName: String?
    var title: String?
    var url: String?
    var idleSeconds: Double
}

struct Permissions: Encodable {
    var accessibility: Bool
    var calendar: Bool
    var automation: [String: Bool]
}

enum Browser: String, CaseIterable {
    case chrome = "com.google.Chrome"
    case arc = "company.thebrowser.Browser"
    case brave = "com.brave.Browser"
    case edge = "com.microsoft.edgemac"
    case safari = "com.apple.Safari"

    var script: String {
        switch self {
        case .safari:
            return "tell application id \"com.apple.Safari\" to get URL of front document"
        default:
            return "tell application id \"\(rawValue)\" to get URL of active tab of front window"
        }
    }
}

final class Sampler {
    private(set) var automation: [String: Bool] = [:]
    private let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    var accessibilityTrusted: Bool { AXIsProcessTrusted() }

    func promptAccessibility() {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        AXIsProcessTrustedWithOptions(opts)
    }

    func idleSeconds() -> Double {
        // ~0 is kCGAnyInputEventType.
        CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
    }

    func sample(now: Date = Date()) -> Sample {
        var s = Sample(at: iso.string(from: now), idleSeconds: idleSeconds())
        guard let app = NSWorkspace.shared.frontmostApplication else { return s }
        s.appId = app.bundleIdentifier
        s.appName = app.localizedName
        if accessibilityTrusted { s.title = focusedWindowTitle(pid: app.processIdentifier) }
        if let id = app.bundleIdentifier, let browser = Browser(rawValue: id) { s.url = browserURL(browser) }
        return s
    }

    private func focusedWindowTitle(pid: pid_t) -> String? {
        let appEl = AXUIElementCreateApplication(pid)
        var win: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appEl, kAXFocusedWindowAttribute as CFString, &win) == .success, let w = win else { return nil }
        var title: CFTypeRef?
        guard AXUIElementCopyAttributeValue(w as! AXUIElement, kAXTitleAttribute as CFString, &title) == .success else { return nil }
        return title as? String
    }

    private func browserURL(_ b: Browser) -> String? {
        var err: NSDictionary?
        guard let script = NSAppleScript(source: b.script) else { return nil }
        let out = script.executeAndReturnError(&err)
        if let err, let code = err[NSAppleScript.errorNumber] as? Int {
            // -1743 means Automation was denied for this browser; other codes are transient (no window, no document).
            automation[b.rawValue] = code != -1743
            return nil
        }
        automation[b.rawValue] = true
        return out.stringValue
    }
}
