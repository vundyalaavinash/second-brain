import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { finishFocus, focusWhere } from "@/domain/focus";
import { getTask } from "@/domain/tasks";
import { crossSite, errorResponse, forbidden, parseId, serializeFocusRun } from "@/lib/api";
import { FinishFocusBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Finishes a run and answers it together with `where` — the machine's own record of where it
 * was during it — so the client needs no second request to show it. */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    const id = parseId((await ctx.params).id);
    // A body that is not JSON at all reads as null rather than throwing here, so it fails the
    // schema the same way any other bad body does instead of leaking a raw SyntaxError as a 500.
    const body = FinishFocusBody.parse(await req.json().catch(() => null));
    const db = getDb();
    const run = finishFocus(db, id, body.outcome);
    const task = getTask(db, run.taskId);
    return NextResponse.json({ run: serializeFocusRun(run, task?.title ?? ""), where: focusWhere(db, run) });
  } catch (err) {
    return errorResponse(err);
  }
}
