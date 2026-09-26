import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { crossSite, errorResponse, forbidden } from "@/lib/api";

export const dynamic = "force-dynamic";

const run = promisify(execFile);

/**
 * Opens the macOS Calendar app so a person can tell the organiser themselves — see the "Not
 * going" row control's own sentence: this app's decision is a local record, never a reply, and
 * the only outward action anywhere in this feature is a person clicking something in Calendar.
 *
 * `x-apple-calevent://` is not registered on this machine (confirmed: `open` refuses it with
 * `kLSApplicationNotFoundErr`). `ical://ekevent/<id>?method=show&options=more` is claimed by
 * Calendar, but a real `calendarItemIdentifier` and a deliberately bogus one produced identical,
 * unverifiable results when checked by hand — no on-screen difference distinguishes a working
 * deep link from a silently ignored one — so per the fallback this task calls for, this opens
 * the app itself rather than shipping a link nobody can confirm works.
 */
export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    await run("open", ["-a", "Calendar"]);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
