import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { listTagNames } from "@/domain/items";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(listTagNames(getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}
