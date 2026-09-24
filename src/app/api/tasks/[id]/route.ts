import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { completeTask, deleteTask, dropTask, getTask, reopenTask, updateTask, TaskError } from "@/domain/tasks";
import { blocksByTask } from "@/domain/blocks";
import { errorResponse, parseId, serializeTask, taskBlockWindow } from "@/lib/api";
import { PatchTaskBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = PatchTaskBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const { status, ...fields } = parsed.data;
    const db = getDb();
    let task = Object.keys(fields).length ? updateTask(db, id, fields) : getTask(db, id);
    if (!task) throw new TaskError(`Task ${id} not found`, 404);
    if (status === "done") task = completeTask(db, id);
    else if (status === "open") task = reopenTask(db, id);
    else if (status === "dropped") task = dropTask(db, id);
    // The same window a list carries: one task's answer is not a place for its whole history.
    return NextResponse.json(serializeTask(task, blocksByTask(db, [id], taskBlockWindow()).get(id) ?? []));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    deleteTask(getDb(), id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
