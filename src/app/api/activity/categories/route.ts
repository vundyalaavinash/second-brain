import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { listCategories } from "@/domain/activity";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(listCategories(getDb()));
  } catch (err) {
    return errorResponse(err);
  }
}
