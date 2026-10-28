import "server-only";
/**
 * The מחלקת קשר notification job, run by the cron endpoint (/api/doch1/cron) after דוח 1's jobs.
 * A trusted server job: it reads across all companies with systemDb() and never takes user input
 * (the endpoint checks CRON_SECRET first). Sending never happens inside a user's request.
 *
 *   missing  a דוח צ׳ filed in the app that didn't find something → every battalion kesher admin:
 *            "דוח צ׳ · <company> · N לא נמצאו" (when notifyMissing is on; marked notified either way)
 *   daily    at kesher_settings.reminderHour (Israel time), once a day → the kesher users of each
 *            company whose last דוח צ׳ is older than checkStaleDays, or that never filed one
 *
 * Payloads carry company names and counts only — never a soldier's name or a צ׳ number.
 */
import { israelClock, israelToday } from "@gdud/core";
import { and, eq, inArray, isNull, schema, sql, systemDb } from "@gdud/db";
import { sendPush, type PushPayload } from "@/lib/doch1/push";

const { units, appUsers, memberships, doch1PushSubscriptions: subs } = schema;
const { kesherChecks: checks, kesherSettings: settings, kesherSerials: serials } = schema;

const DAY_MS = 86_400_000;
/** a report older than this when the job first sees it is marked, not pushed (the job was down / first run) */
const MISSING_MAX_AGE_MS = 2 * DAY_MS;
const ADMIN_ROLES = ["admin", "master_admin"];
const TITLE = "מחלקת קשר";

export interface KesherNotifyResult {
  /** reports with צ׳ not found that were pushed to the admins */
  missing: number;
  /** company reminders sent (one per user and company) */
  reminders: number;
  /** dead subscriptions removed */
  gone: number;
}

type Db = ReturnType<typeof systemDb>;
type Sub = typeof subs.$inferSelect;

/** The push subscriptions of these users, by user. */
async function subsOf(db: Db, userIds: readonly string[]): Promise<Map<string, Sub[]>> {
  const out = new Map<string, Sub[]>();
  if (!userIds.length) return out;
  for (const s of await db.select().from(subs).where(inArray(subs.userId, [...new Set(userIds)]))) out.set(s.userId, [...(out.get(s.userId) ?? []), s]);
  return out;
}

async function deliver(list: readonly Sub[], payload: PushPayload, gone: Set<string>): Promise<boolean> {
  let ok = false;
  for (const s of list) {
    if (gone.has(s.id)) continue;
    const r = await sendPush(s, payload);
    if (r === "ok") ok = true;
    if (r === "gone") gone.add(s.id);
  }
  return ok;
}

export async function runKesherNotifyJob(now: Date): Promise<KesherNotifyResult> {
  const db = systemDb();
  const result: KesherNotifyResult = { missing: 0, reminders: 0, gone: 0 };
  const [cfg] = await db.select().from(settings).limit(1);
  const gone = new Set<string>();
  const unitName = async (ids: readonly string[]) =>
    new Map(ids.length ? (await db.select({ id: units.id, name: units.name }).from(units).where(inArray(units.id, [...new Set(ids)]))).map((u) => [u.id, u.name]) : []);

  /* missing: claim the app-filed reports with צ׳ not found (notified_at first, so a parallel run skips them) */
  const claimed = await db
    .update(checks)
    .set({ notifiedAt: now })
    .where(and(isNull(checks.notifiedAt), isNull(checks.sheetKey), sql`${checks.found} < ${checks.total}`))
    .returning({ unitId: checks.unitId, at: checks.at, total: checks.total, found: checks.found });
  const fresh = claimed.filter((c) => now.getTime() - c.at.getTime() <= MISSING_MAX_AGE_MS);
  if ((cfg?.notifyMissing ?? true) && fresh.length) {
    const admins = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(appUsers, eq(appUsers.id, memberships.userId))
      .where(and(eq(memberships.module, "kesher"), inArray(memberships.role, ADMIN_ROLES), isNull(memberships.unitId), eq(appUsers.active, true)));
    const adminSubs = await subsOf(
      db,
      admins.map((a) => a.userId),
    );
    if (adminSubs.size) {
      const names = await unitName(fresh.map((c) => c.unitId));
      for (const c of fresh) {
        const payload = { title: TITLE, body: `דוח צ׳ · ${names.get(c.unitId) ?? "פלוגה"} · ${c.total - c.found} לא נמצאו`, url: `/kesher/companies/${c.unitId}` };
        for (const list of adminSubs.values()) await deliver(list, payload, gone);
        result.missing++;
      }
    }
  }

  /* daily: from the reminder hour on, once a day — today is claimed on the settings row before sending */
  const hour = Number(israelClock(now).slice(0, 2));
  if (cfg && cfg.reminderHour !== null && hour >= cfg.reminderHour) {
    const today = israelToday(now);
    const taken = await db
      .update(settings)
      .set({ reminderSentOn: today })
      .where(sql`${settings.reminderSentOn} is distinct from ${today}::date`)
      .returning({ id: settings.id });
    if (taken.length) {
      // companies with צ׳ on them (nothing to check otherwise), their last report, and their kesher users
      const [onCompany, lastRows, users] = await Promise.all([
        db
          .selectDistinct({ unitId: serials.unitId })
          .from(serials)
          .where(and(eq(serials.location, "company"), sql`${serials.unitId} is not null`)),
        db
          .select({ unitId: checks.unitId, at: sql<Date>`max(${checks.at})`.mapWith(checks.at) })
          .from(checks)
          .groupBy(checks.unitId),
        db
          .select({ userId: memberships.userId, unitId: memberships.unitId })
          .from(memberships)
          .innerJoin(appUsers, eq(appUsers.id, memberships.userId))
          .innerJoin(units, eq(units.id, memberships.unitId))
          .where(and(eq(memberships.module, "kesher"), eq(units.kind, "company"), eq(units.active, true), eq(appUsers.active, true))),
      ]);
      const last = new Map(lastRows.map((r) => [r.unitId, r.at]));
      const due = new Map<string, number | null>(); // company → days since the last report (null = never)
      for (const { unitId } of onCompany) {
        if (!unitId) continue;
        const at = last.get(unitId);
        const days = at ? Math.max(0, Math.floor((now.getTime() - at.getTime()) / DAY_MS)) : null;
        if (days === null || days > cfg.checkStaleDays) due.set(unitId, days);
      }
      const targets = users.filter((u): u is { userId: string; unitId: string } => Boolean(u.unitId && due.has(u.unitId)));
      if (targets.length) {
        const [userSubs, names] = await Promise.all([
          subsOf(
            db,
            targets.map((t) => t.userId),
          ),
          unitName(targets.map((t) => t.unitId)),
        ]);
        for (const t of targets) {
          const list = userSubs.get(t.userId);
          if (!list) continue;
          const days = due.get(t.unitId);
          const name = names.get(t.unitId) ?? "פלוגה";
          const body = days === null || days === undefined ? `דוח צ׳ · ${name} · לא הוגש דוח צ׳` : `דוח צ׳ · ${name} · עברו ${days} ימים מהבדיקה האחרונה`;
          if (await deliver(list, { title: TITLE, body, url: `/kesher/check?unit=${t.unitId}` }, gone)) result.reminders++;
        }
      }
    }
  }

  if (gone.size) await db.delete(subs).where(inArray(subs.id, [...gone]));
  result.gone = gone.size;
  return result;
}
