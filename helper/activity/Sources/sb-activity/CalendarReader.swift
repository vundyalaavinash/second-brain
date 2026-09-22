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

final class CalendarReader {
    private let store = EKEventStore()
    private(set) var granted = false
    private let iso = ISO8601DateFormatter()
    /// A whole meeting-provider link, so the server can offer a Join button.
    private let joinRe = try! NSRegularExpression(
        pattern: "https?://\\S*(zoom\\.us|meet\\.google\\.com|teams\\.microsoft\\.com|webex\\.com)\\S*", options: .caseInsensitive)
    private let callRe = try! NSRegularExpression(pattern: "(zoom\\.us|meet\\.google\\.com|teams\\.microsoft\\.com|webex\\.com)", options: .caseInsensitive)

    /// How many event calendars this Mac exposes; 0 means nothing is set up yet.
    var calendarsSeen: Int { granted ? store.calendars(for: .event).count : 0 }

    func requestAccess() {
        let sem = DispatchSemaphore(value: 0)
        if #available(macOS 14.0, *) {
            store.requestFullAccessToEvents { ok, _ in self.granted = ok; sem.signal() }
        } else {
            store.requestAccess(to: .event) { ok, _ in self.granted = ok; sem.signal() }
        }
        _ = sem.wait(timeout: .now() + 30)
    }

    private func firstMatch(_ re: NSRegularExpression, in text: String) -> String? {
        guard let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), let r = Range(m.range, in: text) else { return nil }
        return String(text[r])
    }

    private func statusName(_ status: EKEventStatus) -> String {
        switch status {
        case .confirmed: return "accepted"
        case .tentative: return "tentative"
        case .canceled: return "declined"
        default: return "none"
        }
    }

    /// Events from 30 days back to 60 days ahead, all-day ones included.
    func upcoming(now: Date = Date()) -> [EventPayload] {
        guard granted else { return [] }
        let cal = Foundation.Calendar.current
        let start = cal.date(byAdding: .day, value: -30, to: cal.startOfDay(for: now))!
        let end = cal.date(byAdding: .day, value: 60, to: now)!
        let pred = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        return store.events(matching: pred).map { e in
            let notes = String((e.notes ?? "").prefix(4000))
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
                calendarTitle: e.calendar.title)
        }
    }
}
