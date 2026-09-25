"use client";

import { useEffect, useState } from "react";
import type { SafetyStatusDTO } from "@/lib/dto";
import { MONTHS } from "./format";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

/** "3 hours ago", "1 minute ago", "just now" -- coarse enough to trust, never the raw instant. */
function timeAgo(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - Date.parse(iso));
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "12 April" from a `YYYY-MM-DD` recovery-point date -- reuses `format.ts`'s own month names
 * rather than a second list that could drift from `formatDayHeading`'s. */
function formatRecoveryDate(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * Turns `SafetyStatusDTO` into design §7's one line: the governing rule is that silence means
 * checked and sound, not unchecked, so every branch here either says the specific thing that is
 * wrong -- naming the command from `docs/superpowers/runbook.md` that addresses it -- or says the
 * one sentence that means nothing needs attention. There is no third, quiet option.
 *
 * Order matters where more than one thing could be true at once: a backup that is known to have
 * failed its own verification is reported before a same-slot integrity problem from a boot check
 * (`verified` and `integrity` can both come from the same recorded check when it was the backup's
 * own -- see `safetyStatus`'s doc comment -- so the more specific, more actionable message wins),
 * and staleness is checked last because a fresh failure already explains itself without it.
 */
export function describeSafety(status: SafetyStatusDTO, now: Date = new Date()): { ok: boolean; text: string } {
  const { lastBackupAt, verified, recoveryPoints, oldest, integrity } = status;

  if (!verified) {
    return { ok: false, text: "The last backup failed to verify. Run npm run verify to see which backups are sound." };
  }

  if (!integrity.ok) {
    const problem = integrity.problems[0] ?? "an unspecified problem";
    return { ok: false, text: `The last integrity check found a problem: ${problem}. Run npm run logs, then npm run verify.` };
  }

  const stale = lastBackupAt === null || now.getTime() - Date.parse(lastBackupAt) > TWO_DAYS_MS;
  if (stale) {
    const text =
      lastBackupAt === null
        ? "No backup has ever run. Run npm run backup to take one now."
        : `The last backup was ${timeAgo(lastBackupAt, now)}. Run npm run backup to take one now.`;
    return { ok: false, text };
  }

  const points = `${recoveryPoints} recovery point${recoveryPoints === 1 ? "" : "s"}`;
  const reach = oldest ? `, back to ${formatRecoveryDate(oldest)}` : "";
  return { ok: true, text: `Backed up ${timeAgo(lastBackupAt!, now)}, verified. ${points}${reach}.` };
}

/**
 * Design §7's one line on the Activity page: fetches its own status so no other page load has to
 * carry it, and reads what the nightly job and boot already recorded rather than checking
 * anything itself -- the read this makes is cheap (see `safetyStatus`), the verification it
 * reports on is not.
 */
export function SafetyLine({ now }: { now?: Date } = {}) {
  const [status, setStatus] = useState<SafetyStatusDTO | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/safety", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as SafetyStatusDTO;
        if (!cancelled) setStatus(json);
      } catch {
        // A failed read of the status line is not itself something to alarm about here -- the
        // line simply stays absent, same as before the fetch completed.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;
  const { ok, text } = describeSafety(status, now);
  return <p className={`m-0 text-[12.5px] ${ok ? "text-fg-muted" : "text-fg"}`}>{text}</p>;
}
