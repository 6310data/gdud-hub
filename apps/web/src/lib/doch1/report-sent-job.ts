import "server-only";
/**
 * The "שליחת הדוח" notification job, run by the cron endpoint (/api/doch1/cron) every few minutes.
 * A trusted server job: it reads across all companies with systemDb() and never takes user input (the
 * endpoint checks CRON_SECRET first). Sending never happens inside the request that sent the report.
 *
 *   a sent report → the active דוח 1 admins / master admins covering the unit (battalion-wide or on a unit
 *                   above it), not the sender: "דוח 1" · "פלס״ר שלחה את דוח 1 להיום" (or "ל<יום ב׳ 19.10>")
 *
 * Each row is claimed (notified_at) before sending, so a parallel run skips it; rows older than a day when
 * first seen (the job was down) are marked, not pushed. A report reopened before the run has no row left,
 * so nothing goes out. Payloads carry the unit's name and the day only — never a soldier's name.
 */
import { hebrewDayLabel, israelToday, lineage, toParentMap } from "@gdud/core";
import { and, eq, inArray, isNull, schema, systemDb } from "@gdud/db";
import { sendPush, type PushPayload } from "./push";

const { units, appUsers, memberships, doch1PushSubscriptions: subs, doch1ReportSends: sends } = schema;

const MAX_AGE_MS = 86_400_000;
const TITLE = "דוח 1";
const ADMIN_ROLES = ["admin", "master_admin"];

export interface ReportSentJobResult {
  /** notifications delivered (to at least one device) */
  sent: number;
  /** dead subscriptions removed */
  gone: number;
}

type Sub = typeof subs.$inferSelect;

export async function runReportSentJob(now: Date): Promise<ReportSentJobResult> {
  const db = systemDb();
  const result: ReportSentJobResult = { sent: 0, gone: 0 };

  // claim everything due first
  const claimed = await db
    .update(sends)
    .set({ notifiedAt: now })
    .where(isNull(sends.notifiedAt))
    .returning({ unitId: sends.unitId, day: sends.day, sentBy: sends.sentBy, sentAt: sends.sentAt });
  const due = claimed.filter((r) => now.getTime() - r.sentAt.getTime() <= MAX_AGE_MS);
  if (!due.length) return result;

  const [unitRows, admins] = await Promise.all([
    db.select({ id: units.id, parentId: units.parentId, name: units.name }).from(units),
    db
      .select({ userId: memberships.userId, unitId: memberships.unitId })
      .from(memberships)
      .innerJoin(appUsers, eq(appUsers.id, memberships.userId))
      .where(and(eq(memberships.module, "doch1"), inArray(memberships.role, ADMIN_ROLES), eq(appUsers.active, true))),
  ]);
  const parents = toParentMap(unitRows);
  const names = new Map(unitRows.map((u) => [u.id, u.name]));
  const today = israelToday(now);

  // one push per (user, unit, day): an admin with two memberships covering the unit gets it once
  const outbox = new Map<string, { userId: string; payload: PushPayload }>();
  for (const r of due) {
    const up = new Set(lineage(r.unitId, parents));
    const body = `${names.get(r.unitId) ?? "מסגרת"} שלחה את דוח 1 ${r.day === today ? "להיום" : `ל${hebrewDayLabel(r.day)}`}`;
    for (const a of admins) {
      if (a.userId === r.sentBy || (a.unitId !== null && !up.has(a.unitId))) continue;
      outbox.set(`${a.userId}|${r.unitId}|${r.day}`, { userId: a.userId, payload: { title: TITLE, body, url: `/doch1?day=${r.day}` } });
    }
  }
  const items = [...outbox.values()];
  if (!items.length) return result;

  const userSubs = new Map<string, Sub[]>();
  for (const s of await db.select().from(subs).where(inArray(subs.userId, [...new Set(items.map((o) => o.userId))]))) {
    userSubs.set(s.userId, [...(userSubs.get(s.userId) ?? []), s]);
  }
  const gone = new Set<string>();
  for (const o of items) {
    let ok = false;
    for (const s of userSubs.get(o.userId) ?? []) {
      if (gone.has(s.id)) continue;
      const r = await sendPush(s, o.payload);
      if (r === "ok") ok = true;
      if (r === "gone") gone.add(s.id);
    }
    if (ok) result.sent++;
  }
  if (gone.size) await db.delete(subs).where(inArray(subs.id, [...gone]));
  result.gone = gone.size;
  return result;
}
