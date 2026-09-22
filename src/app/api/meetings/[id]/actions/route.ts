import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getItem, parseMeta, updateItem } from "@/domain/items";
import { MeetingError } from "@/domain/meetings/errors";
import { createTask, listTasks } from "@/domain/tasks";
import { errorResponse, parseId, serializeTask } from "@/lib/api";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** The row's own title wins: the person is allowed to reword what the model proposed. */
const AcceptActionBody = z.object({ index: z.number().int().min(0), title: z.string().min(1) }).strict();

interface MeetingMeta {
  summary?: { proposed_actions?: { title: string; notes: string }[] };
  acceptedActions?: number[];
}

/**
 * Accept one proposed action. The task is born in the meeting's own home and remembers the
 * meeting it came from, and the index is recorded so the row stays marked across a reload.
 */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  try {
    const id = parseId((await ctx.params).id);
    const parsed = AcceptActionBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const { index, title } = parsed.data;

    const db = getDb();
    const item = getItem(db, id);
    if (!item) throw new MeetingError(`Meeting ${id} not found`, 404);
    if (item.type !== "meeting") throw new MeetingError("Only a meeting proposes actions", 400);

    const meta = parseMeta<MeetingMeta>(item);
    const action = meta.summary?.proposed_actions?.[index];
    if (!action) throw new MeetingError(`Meeting ${id} has no proposed action ${index}`, 404);

    // A second click, a stale tab or a retry must not grow a second task: an index already
    // accepted answers with the task it made.
    if (meta.acceptedActions?.includes(index)) {
      const made = listTasks(db, { sourceItemId: item.id, status: "all" });
      const newest = made.reduce<(typeof made)[number] | undefined>((a, b) => (a && a.id > b.id ? a : b), undefined);
      const existing = made.find((t) => t.title === action.title || t.title === title) ?? newest;
      if (existing) return NextResponse.json({ task: serializeTask(existing) }, { status: 200 });
    }

    const task = createTask(db, { title, notes: action.notes, containerId: item.containerId, sourceItemId: item.id });
    const accepted = [...new Set([...(meta.acceptedActions ?? []), index])].sort((a, b) => a - b);
    updateItem(db, id, { meta: { ...meta, acceptedActions: accepted } as Record<string, unknown> });

    return NextResponse.json({ task: serializeTask(task) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
