import EventKit
import Foundation

let VERSION = "1.0.0"
let SAMPLE_INTERVAL: TimeInterval = 5
let CALENDAR_INTERVAL: TimeInterval = 300
let RETRY_INTERVAL: TimeInterval = 30
let AFK_SECONDS: Double = 180
let MAX_BUFFER = 12 * 60 * 60 / 5  // 12 hours of heartbeats
let EXCLUDED_APP_ID = "excluded"

struct Heartbeat: Encodable {
    var at: String
    var afk: Bool?
    var appId: String?
    var appName: String?
    var title: String?
    var url: String?
    var idleSeconds: Double?
    var paused: Bool?
    var helper: HelperInfo?
}
struct HelperInfo: Encodable { var version: String; var permissions: Permissions }
struct CalendarBody: Encodable { var events: [EventPayload]; var window: CalendarWindow; var calendarsSeen: Int? }

let args = CommandLine.arguments
let once = args.contains("--once")
var serverURL = URL(string: "http://127.0.0.1:3141")!
if let i = args.firstIndex(of: "--server"), i + 1 < args.count, let u = URL(string: args[i + 1]) { serverURL = u }

let dataDir = ProcessInfo.processInfo.environment["SB_DATA_DIR"]
    ?? ("\(NSHomeDirectory())/Library/Application Support/second-brain")
let tokenPath = "\(dataDir)/activity-token"

let sampler = Sampler()
let calendar = CalendarReader()
let encoder = JSONEncoder()

func log(_ s: String) { FileHandle.standardError.write("[sb-activity] \(s)\n".data(using: .utf8)!) }

func currentPermissions() -> Permissions {
    Permissions(accessibility: sampler.accessibilityTrusted, calendar: calendar.granted, automation: sampler.automation)
}

if once {
    sampler.promptAccessibility()
    calendar.requestAccess()
    let s = sampler.sample()
    let p = currentPermissions()
    struct Out: Encodable { var sample: Sample; var permissions: Permissions }
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    print(String(data: try! encoder.encode(Out(sample: s, permissions: p)), encoding: .utf8)!)
    exit(p.accessibility && p.calendar ? 0 : 2)
}

guard let token = try? String(contentsOfFile: tokenPath, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty else {
    log("no token at \(tokenPath); run scripts/brain.sh setup")
    exit(1)
}
let client = Client(base: serverURL, token: token)

sampler.promptAccessibility()
calendar.requestAccess()

var buffer: [Data] = []
var exclusions = HeartbeatResponse.Exclusions(apps: [], domains: [])
var paused = false
var lastCalendar = Date.distantPast
var lastRetry = Date.distantPast
var lastHelperInfo = Date.distantPast
var lastPausedPing = Date.distantPast
/// Set when macOS reports a calendar change; the next tick (at most 5 s later) reposts.
var calendarChanged = false

func excluded(_ s: Sample) -> Bool {
    if let id = s.appId, exclusions.apps.contains(id) { return true }
    guard let u = s.url, let host = URL(string: u)?.host?.lowercased() else { return false }
    let h = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    return exclusions.domains.contains { p in
        let p = p.lowercased()
        if p.hasPrefix("*.") { return h.hasSuffix(String(p.dropFirst(1))) }
        return h == p || h.hasSuffix("." + p)
    }
}

func flush() {
    while let first = buffer.first {
        guard let (status, body) = client.post("/api/activity/heartbeat", json: first) else { return }
        if status >= 500 {
            log("server error \(status), keeping \(buffer.count) heartbeat(s)")
            return
        }
        buffer.removeFirst()
        if status == 200, let r = try? JSONDecoder().decode(HeartbeatResponse.self, from: body) {
            exclusions = r.exclusions
            paused = r.paused
        } else if status == 401 {
            log("server rejected the token (401)")
        }
    }
}

func tick() {
    let now = Date()
    let s = sampler.sample(now: now)
    var hb = Heartbeat(at: s.at, idleSeconds: s.idleSeconds)
    if now.timeIntervalSince(lastHelperInfo) > 60 {
        hb.helper = HelperInfo(version: VERSION, permissions: currentPermissions())
        lastHelperInfo = now
    }
    if paused {
        // One light heartbeat a minute keeps "last seen" fresh and notices when recording resumes.
        if now.timeIntervalSince(lastPausedPing) < 60 { return }
        lastPausedPing = now
        hb.paused = true
    } else if s.idleSeconds >= AFK_SECONDS {
        hb.afk = true
    } else if excluded(s) {
        // Drop the sample locally; a placeholder app id lets the server close the previous session.
        hb.appId = EXCLUDED_APP_ID
        hb.appName = "Excluded"
    } else {
        hb.appId = s.appId
        hb.appName = s.appName
        hb.title = s.title
        hb.url = s.url
    }
    if let data = try? encoder.encode(hb) {
        buffer.append(data)
        if buffer.count > MAX_BUFFER { buffer.removeFirst(buffer.count - MAX_BUFFER) }
    }
    if buffer.count == 1 || now.timeIntervalSince(lastRetry) >= RETRY_INTERVAL {
        flush()
        if !buffer.isEmpty { lastRetry = now }
    }
    // Without calendar access there is nothing to say about the window: an empty payload
    // would tell the server every event in it had vanished, so nothing is posted at all.
    if calendar.granted, calendarChanged || now.timeIntervalSince(lastCalendar) >= CALENDAR_INTERVAL {
        calendarChanged = false
        lastCalendar = now
        let body = CalendarBody(events: calendar.upcoming(now: now), window: calendar.window(now: now), calendarsSeen: calendar.calendarsSeen)
        if let data = try? encoder.encode(body) { _ = client.post("/api/activity/calendar", json: data) }
    }
}

/// Held for the process's life so the calendar-change subscription stays alive.
let calendarObserver = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: nil, queue: .main) { _ in
    // The store hands back cached objects until it is reset, so the next fetch would miss the change.
    calendar.reset()
    calendarChanged = true
}

log("started, server \(serverURL), data \(dataDir)")
let timer = Timer(timeInterval: SAMPLE_INTERVAL, repeats: true) { _ in tick() }
RunLoop.main.add(timer, forMode: .common)
tick()
RunLoop.main.run()
