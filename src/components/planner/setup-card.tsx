"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { PlannerCalendarDTO } from "@/lib/dto";
import { Button } from "../ui";

/**
 * The nudge shown while the helper can see no calendar: either it was refused calendar
 * access, or it has access and found nothing. Only a helper that has access and has not
 * reported yet waits quietly, so a fresh install is not accused of being misconfigured
 * while a refused one is not left looking like it is still starting up.
 */
export function SetupCard({ calendar }: { calendar: PlannerCalendarDTO }) {
  const [error, setError] = useState<string | null>(null);

  async function openSettings() {
    const res = await fetch("/api/activity/open-settings", { method: "POST" });
    setError(res.ok ? null : "Could not open System Settings");
  }

  if (calendar.permission) {
    if (calendar.calendarsSeen === null) {
      return <p className="text-[12.5px] text-fg-faint m-0">Waiting for the activity helper to report calendars</p>;
    }
    if (calendar.calendarsSeen > 0) return null;
  }

  return (
    <section className="pane p-4 flex flex-col gap-3">
      <span className="micro">Calendar</span>
      {/* Two different faults wear the same card: no access at all, or access and nothing to read. */}
      {calendar.permission ? (
        <p className="text-[13.5px] text-fg-muted m-0 max-w-[68ch]">
          No calendars are visible. Add your Microsoft 365 account in System Settings › Internet Accounts with Calendars turned on, then
          reopen this page.
        </p>
      ) : (
        <p className="text-[13.5px] text-fg-muted m-0 max-w-[68ch]">
          The activity helper has no calendar access. Turn it on in System Settings › Privacy &amp; Security › Calendars, then add your
          Microsoft 365 account in Internet Accounts with Calendars turned on.
        </p>
      )}
      <Button size="sm" icon={ExternalLink} className="self-start" onClick={() => void openSettings()}>
        Open Internet Accounts
      </Button>
      {error && <p className="text-danger text-[12.5px] m-0">{error}</p>}
    </section>
  );
}
