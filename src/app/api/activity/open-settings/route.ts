import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

const run = promisify(execFile);

/**
 * Whether the request came from a page that is not this app. The route runs a local command,
 * so a page on any other site must not be able to reach it through the browser. A request
 * with no `Origin` header is not a cross-site form post and is let through.
 */
function crossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const { port } = new URL(req.url);
  const suffix = port ? `:${port}` : "";
  return origin !== `http://127.0.0.1${suffix}` && origin !== `http://localhost${suffix}`;
}

/** Opens macOS Internet Accounts settings so a person can add the calendar the helper should read. */
export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    await run("open", ["x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension"]);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
