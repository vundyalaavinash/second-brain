import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { safetyStatus } from "@/lib/safety-status";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Design §7's status surface: what the nightly backup and the last integrity check found. Cheap
 * on every call -- see `safetyStatus`'s own doc comment -- so this route runs no check of its own. */
export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(safetyStatus(getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}
