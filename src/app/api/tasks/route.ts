import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { createTask, listTasks, projectProgress } from "@/domain/tasks";
import { errorResponse, parseId, serializeTask } from "@/lib/api";
import { TaskBody } from "@/lib/validation";
import { CaptureError } from "@/domain/items/capture";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const sp = new URL(req.url).searchParams;
    const raw = sp.get("container");
    const containerId = raw === null ? undefined : raw === "inbox" ? null : parseId(raw);
    const status = sp.get("status") ?? "open";
    if (!["open", "done", "dropped", "all"].includes(status)) throw new CaptureError("status must be open, done, dropped, or all", 400);
    const db = getDb();
    const tasks = listTasks(db, { containerId, status: status as "open" | "done" | "dropped" | "all" }).map(serializeTask);
    return NextResponse.json(typeof containerId === "number" ? { tasks, progress: projectProgress(db, containerId) } : { tasks });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = TaskBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    return NextResponse.json(serializeTask(createTask(getDb(), parsed.data)), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
