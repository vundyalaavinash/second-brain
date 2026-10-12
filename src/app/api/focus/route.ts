import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { completedToday, getFocusSettings, runningFocus, startFocus } from "@/domain/focus";
import { breakState } from "@/domain/focus/break";
import { getTask } from "@/domain/tasks";
import { localDay } from "@/domain/activity";
import { crossSite, errorResponse, forbidden, serializeFocusRun } from "@/lib/api";
import { StartFocusBody } from "@/lib/validation";
import type { FocusSettingsDTO } from "@/lib/dto";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const db = getDb();
    const now = new Date();
    const run = runningFocus(db, now);
    const task = run?.taskId != null ? getTask(db, run.taskId) : undefined;
    const settings: FocusSettingsDTO = getFocusSettings(db);
    return NextResponse.json({
      run: run ? serializeFocusRun(run, task?.title ?? "") : null,
      settings,
      completedToday: completedToday(db, localDay(now.toISOString())),
      // Carried on the same payload every focus-aware surface already polls, so the pomodoro pane
      // and the break offer cannot disagree about whether a break is running.
      break: breakState(db, now),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    // A body that is not JSON at all reads as null rather than throwing here, so it fails the
    // schema the same way any other bad body does instead of leaking a raw SyntaxError as a 500.
    const body = StartFocusBody.parse(await req.json().catch(() => null));
    const db = getDb();
    const run = startFocus(db, body);
    const task = run.taskId != null ? getTask(db, run.taskId) : undefined;
    return NextResponse.json(serializeFocusRun(run, task?.title ?? ""), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
