import EventKit
import Foundation

struct EventPayload: Encodable {
    var externalId: String
    var title: String
    var startsAt: String
    var endsAt: String
    var attendees: Int
    var hasCallLink: Bool
}

final class CalendarReader {
    private let store = EKEventStore()
    private(set) var granted = false
    private let iso = ISO8601DateFormatter()
    private let callRe = try! NSRegularExpression(pattern: "(zoom\\.us|meet\\.google\\.com|teams\\.microsoft\\.com|webex\\.com)", options: .caseInsensitive)

    func requestAccess() {
        let sem = DispatchSemaphore(value: 0)
        if #available(macOS 14.0, *) {
            store.requestFullAccessToEvents { ok, _ in self.granted = ok; sem.signal() }
        } else {
            store.requestAccess(to: .event) { ok, _ in self.granted = ok; sem.signal() }
        }
        _ = sem.wait(timeout: .now() + 30)
    }

    /// Today's and tomorrow's timed events.
    func upcoming(now: Date = Date()) -> [EventPayload] {
        guard granted else { return [] }
        let cal = Foundation.Calendar.current
        let start = cal.startOfDay(for: now)
        let end = cal.date(byAdding: .day, value: 2, to: start)!
        let pred = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        return store.events(matching: pred).filter { !$0.isAllDay }.map { e in
            let text = [e.location, e.url?.absoluteString, e.notes].compactMap { $0 }.joined(separator: " ")
            let hasCall = callRe.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
            return EventPayload(
                externalId: e.eventIdentifier ?? "\(e.calendarItemIdentifier)-\(iso.string(from: e.startDate))",
                title: e.title ?? "",
                startsAt: iso.string(from: e.startDate),
                endsAt: iso.string(from: e.endDate),
                attendees: e.attendees?.count ?? 0,
                hasCallLink: hasCall)
        }
    }
}
