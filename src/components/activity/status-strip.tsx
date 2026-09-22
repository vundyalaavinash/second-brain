import type { ReactNode } from "react";
import { Button } from "../ui";
import { formatClock } from "./format";
import type { HelperStateDTO } from "@/lib/dto";

const HELPER_STALE_MS = 120_000;

const SETTINGS_URL: Record<"accessibility" | "calendar", string> = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  calendar: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars",
};

/** Plain helper (not a component): safe to read the clock here. */
function isHelperStale(lastSeen: string, now: number = Date.now()): boolean {
  return now - Date.parse(lastSeen) > HELPER_STALE_MS;
}

function Strip({ level, text, action }: { level: "neutral" | "warn"; text: string; action?: ReactNode }) {
  const cls =
    level === "neutral"
      ? "pane px-3 py-2 text-[13px] flex items-center gap-3"
      : "rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] flex items-center gap-3";
  return (
    <div className={cls}>
      <span className="flex-1 text-fg-muted">{text}</span>
      {action}
    </div>
  );
}

export function StatusStrip({ helper, paused }: { helper: HelperStateDTO; paused: boolean }) {
  if (paused) {
    return <Strip level="neutral" text="Recording is paused." />;
  }

  if (helper.lastSeen === null) {
    return <Strip level="warn" text="The activity helper has not connected yet. Run scripts/brain.sh setup to install it." />;
  }

  if (isHelperStale(helper.lastSeen)) {
    return <Strip level="warn" text={`Not recording since ${formatClock(helper.lastSeen)}. The helper is not running.`} />;
  }

  const rows: ReactNode[] = [];
  const permissions = helper.permissions;
  if (permissions) {
    if (!permissions.accessibility) {
      rows.push(
        <Strip
          key="accessibility"
          level="warn"
          text="Window titles need the Accessibility permission."
          action={
            <Button variant="secondary" size="sm" onClick={() => window.open(SETTINGS_URL.accessibility)}>
              Open settings
            </Button>
          }
        />,
      );
    }
    if (!permissions.calendar) {
      rows.push(
        <Strip
          key="calendar"
          level="warn"
          text="Meeting names need the Calendars permission."
          action={
            <Button variant="secondary" size="sm" onClick={() => window.open(SETTINGS_URL.calendar)}>
              Open settings
            </Button>
          }
        />,
      );
    }
    for (const [appName, granted] of Object.entries(permissions.automation)) {
      if (granted) continue;
      rows.push(
        <Strip
          key={`automation-${appName}`}
          level="warn"
          text={`Browser URLs need Automation permission for ${appName}.`}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.open("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")}
            >
              Open settings
            </Button>
          }
        />,
      );
    }
  }

  if (rows.length === 0) return null;
  return <div className="flex flex-col gap-2">{rows}</div>;
}
