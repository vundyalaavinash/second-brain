"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MeetingListDTO } from "@/lib/dto";
import { formatDayHeading, todayLocal } from "../activity/format";
import { Button, Input, List } from "../ui";
import { MeetingRow } from "./meeting-row";
import { openMeeting } from "./open-meeting";

const JSON_HEADERS = { "content-type": "application/json" };
const RECORDING_SOON = "Recording arrives in the next update";

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

  function rows(list: MeetingListDTO[]) {
    return (
      <List>
        {list.map((m) => (
          <MeetingRow key={m.id} meeting={m} onOpen={() => open(m.id)} onNoRecord={(noRecord) => setNoRecord(m.id, noRecord)} />
        ))}
      </List>
    );
  }

  function group(label: string, list: MeetingListDTO[], empty?: string) {
    return (
      <section key={label} className="pane p-2 flex flex-col gap-2">
        <span className="micro px-1">{label}</span>
        {list.length === 0 ? <p className="text-[13px] text-fg-faint m-0 px-1 pb-1">{empty}</p> : rows(list)}
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
        {/* The title is the point of the stub, so it hangs on a wrapper: a disabled button
          * takes no pointer events and would never show it. */}
        <span title={RECORDING_SOON} className="ml-auto">
          <Button size="sm" disabled>
            Record now
          </Button>
        </span>
      </div>

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
                    {rows(g.meetings)}
                  </div>
                ))
              )}
            </div>
          </details>
        </>
      )}
      {error && <p className="text-danger text-[12.5px] m-0">{error}</p>}
    </div>
  );
}
