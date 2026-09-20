import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { ITEM_STATUSES, ITEM_TYPES } from "@/db/schema";
import { listItems } from "@/domain/items";
import { captureNote, captureLink } from "@/domain/items/capture";
import { errorResponse, parseContainerParam, serializeItem } from "@/lib/api";

export const dynamic = "force-dynamic";

const NoteBody = z
  .object({
    type: z.literal("note"),
    title: z.string().optional(),
    body: z.string(),
    tags: z.array(z.string()).optional(),
    containerId: z.number().int().positive().nullable().optional(),
  })
  .refine((data) => (data.title?.trim().length ?? 0) > 0 || data.body.trim().length > 0, {
    message: "title or body is required",
    path: ["body"],
  });
const LinkBody = z.object({
  type: z.literal("link"),
  url: z.url(),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
  containerId: z.number().int().positive().nullable().optional(),
  force: z.boolean().optional(),
});
const CreateBody = z.discriminatedUnion("type", [NoteBody, LinkBody]);

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const item = parsed.data.type === "note" ? captureNote(db, parsed.data) : captureLink(db, parsed.data);
    return NextResponse.json(serializeItem(db, item), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

const ListParams = z.object({
  type: z.enum(ITEM_TYPES).optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  types: z.array(z.enum(ITEM_TYPES)).optional(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const typesRaw = url.searchParams.get("types");
    const types = typesRaw
      ? typesRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const parsed = ListParams.safeParse({
      type: url.searchParams.get("type") || undefined,
      status: url.searchParams.get("status") || undefined,
      types,
    });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const { type, status, types: parsedTypes } = parsed.data;
    const tag = url.searchParams.get("tag") ?? undefined;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
    const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
    const containerId = parseContainerParam(url.searchParams.get("container"));
    const includeArchived = url.searchParams.get("archived") === "1";
    const pinned = url.searchParams.get("pinned") === "1" ? true : undefined;
    const db = getDb();
    return NextResponse.json(
      listItems(db, { type, types: parsedTypes, status, tag, limit, offset, containerId, includeArchived, pinned }).map((i) =>
        serializeItem(db, i),
      ),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
