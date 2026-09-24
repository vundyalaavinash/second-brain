import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { errorResponse } from "@/lib/api";
import { homePayload } from "@/lib/home";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(homePayload(getDb(), new Date()));
  } catch (err) {
    return errorResponse(err);
  }
}
