import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { crossSite, errorResponse, forbidden } from "@/lib/api";

export const dynamic = "force-dynamic";

const run = promisify(execFile);

/** Opens macOS Internet Accounts settings so a person can add the calendar the helper should read. */
export async function POST(req: Request): Promise<Response> {
  if (crossSite(req)) return forbidden();
  try {
    await run("open", ["x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension"]);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
