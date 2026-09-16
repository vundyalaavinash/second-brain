import fs from "node:fs";
import { NextResponse } from "next/server";
import { activityTokenPath } from "./paths";

let cache: { path: string; mtimeMs: number; token: string } | null = null;

export function readHelperToken(): string | null {
  const p = activityTokenPath();
  try {
    const st = fs.statSync(p);
    if (!cache || cache.path !== p || cache.mtimeMs !== st.mtimeMs) {
      cache = { path: p, mtimeMs: st.mtimeMs, token: fs.readFileSync(p, "utf8").trim() };
    }
    return cache.token || null;
  } catch {
    return null;
  }
}

/** 401 response when the bearer token is missing or wrong; null when the request is authorised. */
export function requireHelperToken(req: Request): NextResponse | null {
  const expected = readHelperToken();
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!expected || !given || given !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
