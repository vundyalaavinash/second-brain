import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { completedToday, getFocusSettings, runningFocus, startFocus } from "@/domain/focus";
import { getTask } from "@/domain/tasks";
import { localDay } from "@/domain/activity";
import { crossSite, errorResponse, forbidden, serializeFocusRun } from "@/lib/api";
import { StartFocusBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const db = getDb();
    const now = new Date();
    const run = runningFocus(db, now);
    const task = run ? getTask(db, run.taskId) : undefined;
    return NextResponse.json({
      run: run ? serializeFocusRun(run, task?.title ?? "") : null,
      settings: getFocusSettings(db),
      completedToday: completedToday(db, localDay(now.toISOString())),
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
    const task = getTask(db, run.taskId);
    return NextResponse.json(serializeFocusRun(run, task?.title ?? ""), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
