import EventKit
import Foundation

struct EventPayload: Encodable {
    var externalId: String
    var title: String
    var startsAt: String
    var endsAt: String
    var attendees: Int
    var hasCallLink: Bool
    var organizer: String
    var attendeeNames: [String]
    var location: String
    var joinUrl: String?
    var notes: String
    var allDay: Bool
    var status: String
    var calendarTitle: String
}

/// The local-day range `[from, to)` a payload speaks for, so the server can drop what vanished.
struct CalendarWindow: Encodable {
    var from: String
    var to: String
}

final class CalendarReader {
    private let store = EKEventStore()
    private(set) var granted = false
    private let iso = ISO8601DateFormatter()
    /// A whole meeting-provider link. The character class matches the server's, so a link in
    /// `<a href="...">Click</a>` does not swallow the quote and the markup after it.
    private let joinRe = try! NSRegularExpression(
        pattern: "https?://[^\\s<>\"')]*(zoom\\.us|meet\\.google\\.com|teams\\.microsoft\\.com|webex\\.com)[^\\s<>\"')]*",
        options: .caseInsensitive)
    private let callRe = try! NSRegularExpression(pattern: "(zoom\\.us|meet\\.google\\.com|teams\\.microsoft\\.com|webex\\.com)", options: .caseInsensitive)

    /// How many calendar accounts this Mac exposes, ignoring the built-in local ones; nil until access is granted.
    var calendarsSeen: Int? {
        guard granted else { return nil }
        return store.calendars(for: .event).filter { cal in
            guard let type = cal.source?.sourceType else { return false }
            return type != .local
        }.count
    }

    func requestAccess() {
        let sem = DispatchSemaphore(value: 0)
        if #available(macOS 14.0, *) {
            store.requestFullAccessToEvents { ok, _ in self.granted = ok; sem.signal() }
        } else {
            store.requestAccess(to: .event) { ok, _ in self.granted = ok; sem.signal() }
        }
        _ = sem.wait(timeout: .now() + 30)
    }

    /// Drops cached objects so the next fetch sees what changed.
    func reset() {
        store.reset()
    }

    private func firstMatch(_ re: NSRegularExpression, in text: String) -> String? {
        guard let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), let r = Range(m.range, in: text) else { return nil }
        return String(text[r])
    }

    /// Trims to `max` UTF-16 units — the length the server counts — without splitting a surrogate pair.
    private func capped(_ s: String, _ max: Int) -> String {
        let units = s.utf16
        guard units.count > max else { return s }
        var cut = units.index(units.startIndex, offsetBy: max)
        while cut > units.startIndex, String.Index(cut, within: s) == nil {
            cut = units.index(before: cut)
        }
        guard let end = String.Index(cut, within: s) else { return "" }
        return String(s[s.startIndex..<end])
    }

    private func statusName(_ status: EKEventStatus) -> String {
        switch status {
        case .confirmed: return "accepted"
        case .tentative: return "tentative"
        case .canceled: return "declined"
        default: return "none"
        }
    }

    private func bounds(_ now: Date) -> (start: Date, end: Date) {
        let cal = Foundation.Calendar.current
        let today = cal.startOfDay(for: now)
        // Whole local days only, so every day in the window is fetched in full.
        return (cal.date(byAdding: .day, value: -30, to: today)!, cal.date(byAdding: .day, value: 61, to: today)!)
    }

    private func dayString(_ date: Date) -> String {
        let c = Foundation.Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// The local days these events speak for: 30 back through 60 ahead, end exclusive.
    func window(now: Date = Date()) -> CalendarWindow {
        let b = bounds(now)
        return CalendarWindow(from: dayString(b.start), to: dayString(b.end))
    }

    /// Every event in the window, all-day ones included.
    func upcoming(now: Date = Date()) -> [EventPayload] {
        guard granted else { return [] }
        let b = bounds(now)
        let pred = store.predicateForEvents(withStart: b.start, end: b.end, calendars: nil)
        return store.events(matching: pred).map { e in
            let notes = capped(e.notes ?? "", 4000)
            let location = e.location ?? ""
            let text = [e.url?.absoluteString, location, notes].compactMap { $0 }.joined(separator: " ")
            let joinUrl = firstMatch(joinRe, in: text)
            let hasCall = joinUrl != nil || firstMatch(callRe, in: text) != nil
            return EventPayload(
                externalId: e.eventIdentifier ?? "\(e.calendarItemIdentifier)-\(iso.string(from: e.startDate))",
                title: e.title ?? "",
                startsAt: iso.string(from: e.startDate),
                endsAt: iso.string(from: e.endDate),
                attendees: e.attendees?.count ?? 0,
                hasCallLink: hasCall,
                organizer: e.organizer?.name ?? "",
                attendeeNames: (e.attendees ?? []).prefix(10).compactMap { $0.name },
                location: location,
                joinUrl: joinUrl,
                notes: notes,
                allDay: e.isAllDay,
                status: statusName(e.status),
                calendarTitle: e.calendar?.title ?? "")
        }
    }
}
