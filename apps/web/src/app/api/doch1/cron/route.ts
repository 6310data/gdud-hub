/**
 * GET /api/doch1/cron — called every 5 minutes by Supabase pg_cron (docs/DOCH1.md). Runs דוח 1's
 * reminder jobs, מחלקת קשר's and ניהול פלוגה's notification jobs, each on its own (one failing doesn't
 * skip the others).
 * Requires `Authorization: Bearer <CRON_SECRET>`; public in proxy.ts because the caller has no session.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runArrivalReminders, runReminderJob } from "@/lib/doch1/reminder-job";
import { runCompanyNotifyJob, type CompanyNotifyResult } from "@/lib/company/notify-job";
import { runKesherNotifyJob, type KesherNotifyResult } from "@/lib/kesher/notify-job";

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

  // each department's job on its own: a failure in one doesn't skip the others
  const now = new Date();
  let doch1: (Awaited<ReturnType<typeof runReminderJob>> & { arrival: Awaited<ReturnType<typeof runArrivalReminders>> }) | null = null;
  try {
    doch1 = { ...(await runReminderJob(now)), arrival: await runArrivalReminders(now) };
  } catch (err) {
    console.error("doch1 reminder job failed", err);
  }
  let kesher: KesherNotifyResult | null = null;
  try {
    kesher = await runKesherNotifyJob(now);
  } catch (err) {
    console.error("kesher notify job failed", err);
  }
  let company: CompanyNotifyResult | null = null;
  try {
    company = await runCompanyNotifyJob(now);
  } catch (err) {
    console.error("company notify job failed", err);
  }
  const failed = !doch1 || !kesher || !company;
  return NextResponse.json(
    { ...(doch1 ?? { error: "doch1 job failed" }), kesher: kesher ?? { error: "job failed" }, company: company ?? { error: "job failed" } },
    { status: failed ? 500 : 200, headers: NO_STORE },
  );
}
