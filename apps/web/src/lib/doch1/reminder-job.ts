import "server-only";
/**
 * The דוח 1 reminder job, run every few minutes by the cron endpoint (/api/doch1/cron).
 * A trusted server job: it reads across all companies with systemDb() — the only systemDb()
 * use in the module. It never takes user input; the endpoint checks CRON_SECRET first.
 *
 *   daily    at the round's reminder time (until the lock), once per user per day: users with a
 *            doch1 company_user / platoon_commander membership get "<unit> · חסרים N דיווחים להיום"
 *   request  "תזכורת" from the overview: the same message to that company's users, right away
 *   arrival  "תזכורת" on the planning screen: "<company> · חסר צפי הגעה ל־N חיילים" to that
 *            company's users (runArrivalReminders; works with or without an active round)
 */
import {
  arrivalReminderMessages,
  inService,
  isDue,
  israelClock,
  israelToday,
  reminderMessages,
  type ReminderMessage,
  type ReminderRecipient,
} from "@gdud/core";
import { and, eq, inArray, isNull, schema, systemDb } from "@gdud/db";
import { memberArriving } from "./data";
import { sendPush } from "./push";

const { units, people, appUsers, memberships } = schema;
const { doch1Rounds: rounds, doch1RoundCompanies: roundCompanies, doch1Members: members, doch1Days: days } = schema;
const { doch1PushSubscriptions: subs, doch1ReminderRequests: requests, doch1ReminderLog: log } = schema;

const REMINDER_ROLES = ["company_user", "platoon_commander"];

export interface ReminderJobResult {
  /** users who got the daily reminder */
  daily: number;
  /** reminder requests handled */
  requests: number;
  /** dead subscriptions removed */
  gone: number;
}

type Db = ReturnType<typeof systemDb>;
type Sub = typeof subs.$inferSelect;

/** Unit → parent, and "is `unitId` at or under `ancestor`?". */
function tree(rows: ReadonlyArray<{ id: string; parentId: string | null; kind: string; name: string }>) {
  const byId = new Map(rows.map((u) => [u.id, u]));
  const lineage = (unitId: string): string[] => {
    const out: string[] = [];
    for (let cur: string | null | undefined = unitId; cur && !out.includes(cur); cur = byId.get(cur)?.parentId) out.push(cur);
    return out;
  };
  return { byId, lineage };
}

async function deliver(db: Db, list: readonly Sub[], msg: ReminderMessage, gone: Set<string>): Promise<boolean> {
  let ok = false;
  for (const s of list) {
    const r = await sendPush(s, { title: msg.title, body: msg.body, url: msg.url });
    if (r === "ok") ok = true;
    if (r === "gone") gone.add(s.id);
  }
  return ok;
}

export async function runReminderJob(now: Date): Promise<ReminderJobResult> {
  const db = systemDb();
  const result: ReminderJobResult = { daily: 0, requests: 0, gone: 0 };
  const [round] = await db.select().from(rounds).where(eq(rounds.active, true)).limit(1);
  if (!round) return result;
  const today = israelToday(now);

  const unitRows = await db.select({ id: units.id, parentId: units.parentId, kind: units.kind, name: units.name }).from(units);
  const { byId, lineage } = tree(unitRows);
  const activeCompanies = new Set(
    (await db.select().from(roundCompanies).where(and(eq(roundCompanies.roundId, round.id), eq(roundCompanies.active, true)))).map((c) => c.unitId),
  );
  const inRound = (unitId: string) => lineage(unitId).some((u) => activeCompanies.has(u));

  /* who reports, and has at least one subscribed browser */
  const roleRows = await db
    .select({ userId: memberships.userId, unitId: memberships.unitId })
    .from(memberships)
    .innerJoin(appUsers, eq(appUsers.id, memberships.userId))
    .where(and(eq(memberships.module, "doch1"), inArray(memberships.role, REMINDER_ROLES), eq(appUsers.active, true)));
  const scoped = roleRows.filter((r): r is { userId: string; unitId: string } => !!r.unitId && inRound(r.unitId));
  if (!scoped.length) return result;
  const subRows = await db.select().from(subs).where(inArray(subs.userId, [...new Set(scoped.map((r) => r.userId))]));
  const subsByUser = new Map<string, Sub[]>();
  for (const s of subRows) subsByUser.set(s.userId, [...(subsByUser.get(s.userId) ?? []), s]);
  const recipients: ReminderRecipient[] = scoped
    .filter((r) => subsByUser.has(r.userId))
    .map((r) => ({ userId: r.userId, scopeUnitId: r.unitId, scopeName: byId.get(r.unitId)?.name ?? "" }));
  if (!recipients.length) return result;

  /* missing reports today, counted into every unit above the soldier */
  const memberRows = await db
    .select({ personId: members.personId, inReport: members.inReport, callUpOn: members.callUpOn, releasedOn: members.releasedOn, arriving: memberArriving, unitId: people.unitId })
    .from(members)
    .innerJoin(people, eq(people.id, members.personId))
    .where(eq(members.roundId, round.id));
  const reported = new Set(
    (await db.select({ personId: days.personId }).from(days).where(and(eq(days.roundId, round.id), eq(days.day, today)))).map((d) => d.personId),
  );
  const missingByUnit = new Map<string, number>();
  for (const m of memberRows) {
    if (!m.inReport || !inService(m, today) || reported.has(m.personId) || !inRound(m.unitId)) continue;
    for (const u of lineage(m.unitId)) missingByUnit.set(u, (missingByUnit.get(u) ?? 0) + 1);
  }
  const gone = new Set<string>();

  /* daily: before the lock only; the unique (round, day, user) log row is claimed before sending */
  const clock = israelClock(now);
  if (isDue(now, round.reminderAt, false) && clock < round.lockAt.slice(0, 5)) {
    const byUser = new Map<string, ReminderRecipient[]>();
    for (const r of recipients) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
    for (const [userId, scopes] of byUser) {
      const msgs = reminderMessages(scopes, missingByUnit);
      const missing = msgs.reduce((n, m) => n + m.missing, 0);
      const claimed = await db
        .insert(log)
        .values({ roundId: round.id, day: today, kind: "daily", userId, unitId: scopes[0]!.scopeUnitId, missing, ok: true })
        .onConflictDoNothing()
        .returning({ id: log.id });
      if (!claimed.length || !msgs.length) continue; // already handled today, or nothing missing
      let ok = false;
      for (const msg of msgs) ok = (await deliver(db, subsByUser.get(userId)!, msg, gone)) || ok;
      if (!ok) await db.update(log).set({ ok: false }).where(eq(log.id, claimed[0]!.id));
      result.daily++;
    }
  }

  /* requests from the overview */
  const open = await db
    .select()
    .from(requests)
    .where(and(eq(requests.roundId, round.id), eq(requests.kind, "report"), isNull(requests.processedAt)));
  for (const req of open) {
    // mark first, so a parallel run doesn't send it twice
    const taken = await db
      .update(requests)
      .set({ processedAt: now })
      .where(and(eq(requests.id, req.id), isNull(requests.processedAt)))
      .returning({ id: requests.id });
    if (!taken.length) continue;
    result.requests++;
    if (israelToday(req.createdAt) !== today) continue; // a stale request (the job was down): drop it
    const targets = recipients.filter((r) => lineage(r.scopeUnitId).includes(req.unitId));
    for (const msg of reminderMessages(targets, missingByUnit)) {
      const ok = await deliver(db, subsByUser.get(msg.userId)!, msg, gone);
      await db.insert(log).values({ roundId: round.id, day: today, kind: "request", userId: msg.userId, unitId: msg.unitId, missing: msg.missing, ok });
    }
  }

  if (gone.size) await db.delete(subs).where(inArray(subs.id, [...gone]));
  result.gone = gone.size;
  return result;
}

/** "Fill צפי הגעה" requests of the round being planned: each request goes once, the same day. */
export async function runArrivalReminders(now: Date): Promise<{ requests: number; gone: number }> {
  const db = systemDb();
  const result = { requests: 0, gone: 0 };
  const [round] = await db.select().from(rounds).where(eq(rounds.state, "planning")).limit(1);
  if (!round) return result;
  const open = await db
    .select()
    .from(requests)
    .where(and(eq(requests.roundId, round.id), eq(requests.kind, "arrival"), isNull(requests.processedAt)));
  if (!open.length) return result;
  const today = israelToday(now);

  const unitRows = await db.select({ id: units.id, parentId: units.parentId, kind: units.kind, name: units.name }).from(units);
  const { byId, lineage } = tree(unitRows);
  // company users fill צפי הגעה for their own soldiers
  const roleRows = await db
    .select({ userId: memberships.userId, unitId: memberships.unitId })
    .from(memberships)
    .innerJoin(appUsers, eq(appUsers.id, memberships.userId))
    .where(and(eq(memberships.module, "doch1"), eq(memberships.role, "company_user"), eq(appUsers.active, true)));
  const scoped = roleRows.filter((r): r is { userId: string; unitId: string } => !!r.unitId);
  const subRows = scoped.length ? await db.select().from(subs).where(inArray(subs.userId, [...new Set(scoped.map((r) => r.userId))])) : [];
  const subsByUser = new Map<string, Sub[]>();
  for (const s of subRows) subsByUser.set(s.userId, [...(subsByUser.get(s.userId) ?? []), s]);
  const recipients: ReminderRecipient[] = scoped
    .filter((r) => subsByUser.has(r.userId))
    .map((r) => ({ userId: r.userId, scopeUnitId: r.unitId, scopeName: byId.get(r.unitId)?.name ?? "" }));

  /* soldiers of the planning round without צפי הגעה, counted into every unit above them */
  const blankByUnit = new Map<string, number>();
  const blank = await db
    .select({ unitId: people.unitId })
    .from(members)
    .innerJoin(people, eq(people.id, members.personId))
    .where(and(eq(members.roundId, round.id), isNull(members.arrivalOptionId)));
  for (const m of blank) for (const u of lineage(m.unitId)) blankByUnit.set(u, (blankByUnit.get(u) ?? 0) + 1);

  const gone = new Set<string>();
  for (const req of open) {
    const taken = await db
      .update(requests)
      .set({ processedAt: now })
      .where(and(eq(requests.id, req.id), isNull(requests.processedAt)))
      .returning({ id: requests.id });
    if (!taken.length) continue;
    result.requests++;
    if (israelToday(req.createdAt) !== today) continue;
    const targets = recipients.filter((r) => lineage(r.scopeUnitId).includes(req.unitId));
    for (const msg of arrivalReminderMessages(targets, blankByUnit)) {
      const ok = await deliver(db, subsByUser.get(msg.userId)!, msg, gone);
      await db.insert(log).values({ roundId: round.id, day: today, kind: "request", userId: msg.userId, unitId: msg.unitId, missing: msg.missing, ok });
    }
  }
  if (gone.size) await db.delete(subs).where(inArray(subs.id, [...gone]));
  result.gone = gone.size;
  return result;
}
