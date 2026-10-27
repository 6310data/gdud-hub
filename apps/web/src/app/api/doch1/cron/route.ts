/**
 * GET /api/doch1/cron — called every 5 minutes by Supabase pg_cron (docs/DOCH1.md).
 * Requires `Authorization: Bearer <CRON_SECRET>`; public in proxy.ts because the caller has no session.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runArrivalReminders, runReminderJob } from "@/lib/doch1/reminder-job";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** Constant-time comparison (hashing first makes the lengths equal). */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500, headers: NO_STORE });
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!given || !sameSecret(given, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });

  try {
    const now = new Date();
    const result = await runReminderJob(now);
    const arrival = await runArrivalReminders(now);
    return NextResponse.json({ ...result, arrival }, { headers: NO_STORE });
  } catch (err) {
    console.error("doch1 reminder job failed", err);
    return NextResponse.json({ error: "job failed" }, { status: 500, headers: NO_STORE });
  }
}
