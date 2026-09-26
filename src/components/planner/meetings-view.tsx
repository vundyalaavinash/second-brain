"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import type { MeetingListDTO, MeetingSettingsDTO } from "@/lib/dto";
import { formatDayHeading, todayLocal } from "../activity/format";
import { Button, Chip, IconButton, Input, List } from "../ui";
import { MeetingRow } from "./meeting-row";
import { openMeeting } from "./open-meeting";
import { useRecorder } from "./use-recorder";
import { CalendarFeed } from "./calendar-feed";

const JSON_HEADERS = { "content-type": "application/json" };
const SETTINGS_URL = "/api/settings/meetings";

interface Props {
  today: string;
  meetings: MeetingListDTO[];
  onRefresh?: () => void;
}

/** The local calendar day a meeting starts on. The domain has the same function, but it
 * lives beside the database and would drag drizzle into the client bundle. */
export const dayOf = (iso: string) => todayLocal(new Date(iso));

interface Group {
  key: string;
  label: string;
  meetings: MeetingListDTO[];
}

/** Title, organizer, and attendee names, the three things the spec says the box searches. */
function matches(m: MeetingListDTO, q: string): boolean {
  return [m.title, m.organizer, ...m.attendeeNames].join(" ").toLowerCase().includes(q);
}

function groupByDay(meetings: MeetingListDTO[]): Group[] {
  const groups = new Map<string, MeetingListDTO[]>();
  for (const m of meetings) {
    const day = dayOf(m.startsAt);
    const list = groups.get(day);
    if (list) list.push(m);
    else groups.set(day, [m]);
  }
  return [...groups].map(([key, list]) => ({ key, label: formatDayHeading(key), meetings: list }));
}

export function MeetingsView({ today, meetings, onRefresh }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Null until the server has answered: a switch that renders before then would render a guess.
  const [settings, setSettings] = useState<MeetingSettingsDTO | null>(null);
  // The switches and the feed link live behind one control; with no meetings at all the panel
  // opens on its own, since connecting a calendar is then the only thing to do here.
  const [settingsOpen, setSettingsOpen] = useState(meetings.length === 0);
  const recorder = useRecorder();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(SETTINGS_URL, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const next = (await res.json()) as MeetingSettingsDTO;
        if (!cancelled) setSettings(next);
      } catch {
        /* offline: the switches stay out of the way rather than lying about the setting */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const shown = q ? meetings.filter((m) => matches(m, q)) : meetings;
  const todays = shown.filter((m) => dayOf(m.startsAt) === today);
  const upcoming = groupByDay(shown.filter((m) => dayOf(m.startsAt) > today));
  const past = groupByDay(shown.filter((m) => dayOf(m.startsAt) < today)).reverse();

  function open(id: number) {
    void (async () => {
      const itemId = await openMeeting(id);
      if (itemId === null) {
        setError("Could not open that meeting");
        return;
      }
      setError(null);
      router.push(`/items/${itemId}`);
    })();
  }

  function setNoRecord(id: number, noRecord: boolean) {
    void (async () => {
      const res = await fetch(`/api/meetings/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ noRecord }) });
      if (!res.ok) {
        setError("Could not save that change");
        return;
      }
      setError(null);
      onRefresh?.();
    })();
  }

  /** Moves the switch under the hand straight away; the answer is what it settles on. */
  function saveSetting(patch: Partial<MeetingSettingsDTO>) {
    const before = settings;
    setSettings((current) => (current ? { ...current, ...patch } : current));
    void (async () => {
      const res = await fetch(SETTINGS_URL, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch) }).catch(() => null);
      if (!res || !res.ok) {
        // The switch goes back to what is actually saved, so the next click patches from the truth.
        setSettings(before);
        setError("Could not save that change");
        return;
      }
      setSettings((await res.json()) as MeetingSettingsDTO);
      setError(null);
    })();
  }

  function rows(list: MeetingListDTO[]) {
    return (
      <List>
        {list.map((m) => (
          <MeetingRow
            key={m.id}
            meeting={m}
            onOpen={() => open(m.id)}
            onNoRecord={(noRecord) => setNoRecord(m.id, noRecord)}
            onRecord={() => recorder.record({ calendarEventId: m.id })}
            blocked={recorder.blocked}
            recordTitle={recorder.title}
          />
        ))}
      </List>
    );
  }

  /** All-day events are a line of names, not rows: nothing on them can be recorded or joined. */
  function allDayLine(list: MeetingListDTO[]) {
    if (list.length === 0) return null;
    return (
      <div className="flex items-center gap-1.5 flex-wrap px-1" aria-label="All day">
        <span className="font-mono text-[11px] text-fg-faint shrink-0">All day</span>
        {list.map((m) => (
          <Chip key={m.id} onClick={() => open(m.id)} title={m.calendarTitle || undefined}>
            {m.title}
          </Chip>
        ))}
      </div>
    );
  }

  function group(label: string, list: MeetingListDTO[], empty?: string) {
    const timed = list.filter((m) => !m.allDay);
    const allDay = list.filter((m) => m.allDay);
    return (
      <section key={label} className="pane p-2 flex flex-col gap-2">
        <span className="micro px-1">{label}</span>
        {allDayLine(allDay)}
        {list.length === 0 ? <p className="text-[13px] text-fg-faint m-0 px-1 pb-1">{empty}</p> : timed.length > 0 && rows(timed)}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          type="search"
          aria-label="Search meetings"
          placeholder="Search meetings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-[320px]"
        />
        <IconButton
          label="Calendar settings"
          icon={Settings2}
          active={settingsOpen}
          aria-expanded={settingsOpen}
          aria-controls="calendar-settings"
          onClick={() => setSettingsOpen((v) => !v)}
        />
        {/* A disabled button takes no pointer events, so the reason hangs on a wrapper. */}
        <span title={recorder.title ?? undefined} className="ml-auto">
          <Button size="sm" onClick={() => recorder.record({ adhoc: true })} disabled={!!recorder.blocked} title={recorder.title ?? undefined}>
            Record now
          </Button>
        </span>
      </div>

      {settingsOpen && (
        <section id="calendar-settings" aria-label="Calendar settings" className="pane p-3 flex flex-col gap-3">
          {settings && (
            <div className="flex items-center gap-2 flex-wrap">
              <Chip
                role="switch"
                aria-checked={settings.autoRecord}
                active={settings.autoRecord}
                onClick={() => saveSetting({ autoRecord: !settings.autoRecord })}
              >
                Record meetings automatically
              </Chip>
              {settings.autoRecord && (
                <Chip
                  role="switch"
                  aria-checked={settings.autoRecordNeedsCallLink}
                  active={settings.autoRecordNeedsCallLink}
                  onClick={() => saveSetting({ autoRecordNeedsCallLink: !settings.autoRecordNeedsCallLink })}
                  className="h-6 px-2 text-[11.5px]"
                >
                  Only with a join link
                </Chip>
              )}
            </div>
          )}
          {/* Design §9.2: 0 releases as soon as a transcript exists, 1-365 keeps that many days
              past the recording's end, and "keep forever" turns the window off entirely. */}
          {settings && settings.audioRetentionDays !== undefined && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] text-fg-faint">Audio retention</span>
              {settings.audioRetentionDays !== null && (
                <>
                  <div className="w-16">
                    <Input
                      key={settings.audioRetentionDays}
                      size="sm"
                      type="number"
                      min={0}
                      max={365}
                      aria-label="Audio retention, in days"
                      defaultValue={settings.audioRetentionDays}
                      onBlur={(e) => {
                        // `Number("")` is 0, not "unset" — an emptied field must not silently
                        // save as "release the audio the moment a transcript exists", the most
                        // destructive value the setting can take. A blank or non-numeric field
                        // reverts to what was last saved rather than committing anything.
                        const raw = e.target.value.trim();
                        const n = Number(raw);
                        if (raw !== "" && Number.isInteger(n) && n >= 0 && n <= 365) saveSetting({ audioRetentionDays: n });
                        else e.target.value = String(settings.audioRetentionDays);
                      }}
                      className="w-full"
                    />
                  </div>
                  <span className="text-[12px] text-fg-faint">days</span>
                </>
              )}
              <Chip
                role="switch"
                aria-checked={settings.audioRetentionDays === null}
                active={settings.audioRetentionDays === null}
                onClick={() => saveSetting({ audioRetentionDays: settings.audioRetentionDays === null ? 7 : null })}
                className="h-6 px-2 text-[11.5px]"
              >
                Keep forever
              </Chip>
            </div>
          )}
          <CalendarFeed onSynced={onRefresh} />
        </section>
      )}

      {/* With nothing to group, the groups are all empty lines saying the same thing: one line
        * says it once. The setup card above the tabs carries the fix when there is one. */}
      {shown.length === 0 ? (
        <p className="text-[13px] text-fg-faint m-0">{q ? "No meetings match that search" : "No meetings in the next 60 days"}</p>
      ) : (
        <>
          {group("Today", todays, "No meetings today")}
          {upcoming.map((g) => group(g.label, g.meetings))}

          <details className="pane p-2">
            <summary className="micro px-1 cursor-pointer focus-ring rounded-sm">Past 30 days</summary>
            <div className="flex flex-col gap-2 pt-2">
              {past.length === 0 ? (
                <p className="text-[13px] text-fg-faint m-0 px-1">Nothing in the past 30 days</p>
              ) : (
                past.map((g) => (
                  <div key={g.key} className="flex flex-col gap-1">
                    <span className="micro px-1">{g.label}</span>
                    {allDayLine(g.meetings.filter((m) => m.allDay))}
                    {g.meetings.some((m) => !m.allDay) && rows(g.meetings.filter((m) => !m.allDay))}
                  </div>
                ))
              )}
            </div>
          </details>
        </>
      )}
      {(error ?? recorder.error) && <p className="text-danger text-[12.5px] m-0">{error ?? recorder.error}</p>}
    </div>
  );
}
