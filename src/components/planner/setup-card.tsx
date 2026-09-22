"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { PlannerCalendarDTO } from "@/lib/dto";
import { Button } from "../ui";

/**
 * The nudge shown while the helper can see no calendar: either it has no permission, or it
 * has permission and found nothing. Until it has reported at all there is nothing to fix
 * yet, so that case says so quietly instead of accusing a fresh install of being misconfigured.
 */
export function SetupCard({ calendar }: { calendar: PlannerCalendarDTO }) {
  const [error, setError] = useState<string | null>(null);

  async function openSettings() {
    const res = await fetch("/api/activity/open-settings", { method: "POST" });
    setError(res.ok ? null : "Could not open System Settings");
  }

  if (calendar.calendarsSeen === null) {
    return <p className="text-[12.5px] text-fg-faint m-0">Waiting for the activity helper to report calendars</p>;
  }
  if (calendar.permission && calendar.calendarsSeen > 0) return null;

  return (
    <section className="pane p-4 flex flex-col gap-3">
      <span className="micro">Calendar</span>
      <p className="text-[13.5px] text-fg-muted m-0 max-w-[68ch]">
        No calendars are visible. Add your Microsoft 365 account in System Settings › Internet Accounts with Calendars turned on, then reopen
        this page.
      </p>
      <Button size="sm" icon={ExternalLink} className="self-start" onClick={() => void openSettings()}>
        Open Internet Accounts
      </Button>
      {error && <p className="text-danger text-[12.5px] m-0">{error}</p>}
    </section>
  );
}
