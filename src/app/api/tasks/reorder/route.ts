import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { reorderTasks } from "@/domain/tasks";
import { errorResponse, serializeTasks } from "@/lib/api";
import { ReorderTasksBody } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = ReorderTasksBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const tasks = serializeTasks(db, reorderTasks(db, parsed.data.containerId, parsed.data.ids));
    return NextResponse.json({ tasks });
  } catch (err) {
    return errorResponse(err);
  }
}
