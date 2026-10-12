-- EventKit's `eventIdentifier` is series-level: every occurrence of a recurring event carries the
-- same value. It was used verbatim as `external_id`, so the unique index collapsed a whole series
-- into one row -- and because `item_id` is deliberately left off the sync's upsert, that one row
-- kept pointing at the first occurrence's captured item. Every later occurrence opened the first
-- one's meeting, transcript included.
--
-- The helper now appends the occurrence's own start. Left alone, the next sync would see entirely
-- unfamiliar ids: the window purge would delete these rows and insert new ones, and any meeting
-- already captured against them would lose its calendar link (`calendar_events.item_id`, and the
-- `items.meta.calendarEventId` pointing back). Rewriting the ids here to the exact shape the
-- helper will now send keeps those links.
--
-- The shape matches because `starts_at` is written by the same ISO8601 formatter that builds the
-- id (CalendarReader.swift: `startsAt: iso.string(from: e.startDate)`).
--
-- Only `eventkit` rows are touched. The feed source was already occurrence-scoped, and `outlook`
-- ids change shape too but that source has never been enabled anywhere -- it has no rows to keep,
-- and any that existed would be re-fetched from the cache on the next sync.
--
-- The guard makes this idempotent and protects the old fallback branch's ids, which already ended
-- in their own start date.
UPDATE calendar_events
SET external_id = external_id || '-' || starts_at
WHERE source = 'eventkit'
  AND external_id NOT LIKE '%-' || starts_at;
