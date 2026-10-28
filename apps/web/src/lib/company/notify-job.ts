import "server-only";
/**
 * The ניהול פלוגה notification job, run by the cron endpoint (/api/doch1/cron) after the other
 * departments' jobs. A trusted server job: it reads across all companies with systemDb() and never
 * takes user input (the endpoint checks CRON_SECRET first). Sending never happens inside a request.
 *
 *   join      a new join request               → the company admins covering the soldier: "בקשת הצטרפות חדשה"
 *   joined    an approved join request         → the soldier's account: "הבקשה שלך אושרה"
 *   change    a new name / תפקיד request         → the company admins and the platoon commander covering
 *                                                 the soldier (not the soldier): "בקשת עדכון פרטים"
 *   renamed   an approved name change          → the דוח 1 and kesher users covering the company:
 *                                                 "שם של חייל עודכן בפלוגה" (they fix their sheets)
 *   signed    an internal signing (החתמה פנימית) → the receiver's account: "נרשם עליך ציוד בהחתמה פנימית"
 *
 * Each row is claimed (notified_at / decision_notified_at) before sending, so a parallel run skips it;
 * rows older than two days when first seen are marked, not pushed. Payloads never carry a soldier's
 * name, a personal number or a צ׳.
 */
import { lineage, toParentMap, type UnitParents } from "@gdud/core";
import { and, eq, inArray, isNull, schema, systemDb } from "@gdud/db";
import { sendPush, type PushPayload } from "@/lib/doch1/push";

const { units, appUsers, memberships, doch1PushSubscriptions: subs } = schema;
const { companyJoinRequests: joins, companyProfileRequests: changes, companySignings: signings } = schema;

const MAX_AGE_MS = 2 * 86_400_000;
const TITLE = "ניהול פלוגה";

export interface CompanyNotifyResult {
  /** notifications delivered (to at least one device), by kind */
  join: number;
  joined: number;
  change: number;
  renamed: number;
  signed: number;
  /** dead subscriptions removed */
  gone: number;
}

type Db = ReturnType<typeof systemDb>;
type Sub = typeof subs.$inferSelect;
type Member = { userId: string; module: string; role: string; unitId: string | null };

async function subsOf(db: Db, userIds: readonly string[]): Promise<Map<string, Sub[]>> {
  const out = new Map<string, Sub[]>();
  if (!userIds.length) return out;
  for (const s of await db.select().from(subs).where(inArray(subs.userId, [...new Set(userIds)]))) out.set(s.userId, [...(out.get(s.userId) ?? []), s]);
  return out;
}

/** Users holding one of `roles` in `module` on `unitId` or above it (same rule as has_role()). */
function covering(all: readonly Member[], module: string, roles: readonly string[], unitId: string, parents: UnitParents): string[] {
  const up = new Set(lineage(unitId, parents));
  return all
    .filter((m) => m.module === module && (roles.includes(m.role) || (m.role === "master_admin" && roles.includes("admin"))) && (m.unitId === null || up.has(m.unitId)))
    .map((m) => m.userId);
}

/** The company above a unit. */
function companyOf(unitId: string, parents: UnitParents, kinds: ReadonlyMap<string, string>): string | null {
  return lineage(unitId, parents).find((id) => kinds.get(id) === "company") ?? null;
}

export async function runCompanyNotifyJob(now: Date): Promise<CompanyNotifyResult> {
  const db = systemDb();
  const result: CompanyNotifyResult = { join: 0, joined: 0, change: 0, renamed: 0, signed: 0, gone: 0 };
  const fresh = (at: Date) => now.getTime() - at.getTime() <= MAX_AGE_MS;

  // claim everything due first
  const [newJoins, approvedJoins, newChanges, renames, newSignings] = await Promise.all([
    db
      .update(joins)
      .set({ notifiedAt: now })
      .where(and(isNull(joins.notifiedAt), eq(joins.status, "pending")))
      .returning({ unitId: joins.unitId, at: joins.createdAt }),
    db
      .update(joins)
      .set({ decisionNotifiedAt: now })
      .where(and(isNull(joins.decisionNotifiedAt), eq(joins.status, "approved")))
      .returning({ authUserId: joins.authUserId, at: joins.decidedAt }),
    db
      .update(changes)
      .set({ notifiedAt: now })
      .where(and(isNull(changes.notifiedAt), eq(changes.status, "pending")))
      .returning({ unitId: changes.unitId, requestedBy: changes.requestedBy, at: changes.updatedAt }),
    db
      .update(changes)
      .set({ decisionNotifiedAt: now })
      .where(and(isNull(changes.decisionNotifiedAt), eq(changes.status, "approved"), eq(changes.field, "full_name")))
      .returning({ unitId: changes.unitId, at: changes.decidedAt }),
    db.update(signings).set({ notifiedAt: now }).where(isNull(signings.notifiedAt)).returning({ toPersonId: signings.toPersonId, at: signings.signedAt }),
  ]);
  const due = {
    join: newJoins.filter((r) => fresh(r.at)),
    joined: approvedJoins.filter((r) => r.at && fresh(r.at)),
    change: newChanges.filter((r) => fresh(r.at)),
    renamed: renames.filter((r) => r.at && fresh(r.at)),
    signed: newSignings.filter((r) => fresh(r.at)),
  };
  if (Object.values(due).every((list) => !list.length)) return result;

  const [unitRows, memberRows, joinedUsers, receivers] = await Promise.all([
    db.select({ id: units.id, parentId: units.parentId, kind: units.kind }).from(units),
    db
      .select({ userId: memberships.userId, module: memberships.module, role: memberships.role, unitId: memberships.unitId })
      .from(memberships)
      .innerJoin(appUsers, eq(appUsers.id, memberships.userId))
      .where(and(inArray(memberships.module, ["company", "doch1", "kesher"]), eq(appUsers.active, true))),
    due.joined.length
      ? db
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(and(inArray(appUsers.authUserId, due.joined.map((r) => r.authUserId)), eq(appUsers.active, true)))
      : Promise.resolve([]),
    due.signed.length
      ? db
          .select({ id: appUsers.id })
          .from(appUsers)
          .where(and(inArray(appUsers.personId, due.signed.map((r) => r.toPersonId)), eq(appUsers.active, true)))
      : Promise.resolve([]),
  ]);
  const parents = toParentMap(unitRows);
  const kinds = new Map(unitRows.map((u) => [u.id, u.kind as string]));

  // one push per (user, kind, link): several requests of a company in one run become one notification
  const outbox = new Map<string, { userId: string; payload: PushPayload; kind: keyof typeof due }>();
  const queue = (userIds: readonly string[], kind: keyof typeof due, body: string, url: string, skip?: string | null) => {
    for (const userId of userIds) if (userId !== skip) outbox.set(`${userId}|${kind}|${url}`, { userId, kind, payload: { title: TITLE, body, url } });
  };
  for (const r of due.join) {
    const company = companyOf(r.unitId, parents, kinds);
    queue(covering(memberRows, "company", ["admin"], r.unitId, parents), "join", "בקשת הצטרפות חדשה", company ? `/company/${company}/settings` : "/company");
  }
  for (const u of joinedUsers) queue([u.id], "joined", "הבקשה שלך אושרה — אפשר להיכנס", "/company/me");
  for (const u of receivers) queue([u.id], "signed", "נרשם עליך ציוד בהחתמה פנימית", "/company/me");
  for (const r of due.change) {
    const company = companyOf(r.unitId, parents, kinds);
    const admins = covering(memberRows, "company", ["admin"], r.unitId, parents);
    const commanders = covering(memberRows, "company", ["platoon_commander"], r.unitId, parents);
    if (company) queue(admins, "change", "בקשת עדכון פרטים", `/company/${company}/settings`, r.requestedBy);
    if (company) queue(commanders.filter((id) => !admins.includes(id)), "change", "בקשת עדכון פרטים", `/company/${company}`, r.requestedBy);
  }
  for (const r of due.renamed) {
    const company = companyOf(r.unitId, parents, kinds) ?? r.unitId;
    queue(covering(memberRows, "doch1", ["admin", "company_user"], company, parents), "renamed", "שם של חייל עודכן בפלוגה — עדכנו את הגיליון", "/doch1");
    queue(covering(memberRows, "kesher", ["admin", "user"], company, parents), "renamed", "שם של חייל עודכן בפלוגה — עדכנו את הגיליון", `/kesher/companies/${company}`);
  }

  const items = [...outbox.values()];
  const userSubs = await subsOf(
    db,
    items.map((o) => o.userId),
  );
  const gone = new Set<string>();
  for (const o of items) {
    let ok = false;
    for (const s of userSubs.get(o.userId) ?? []) {
      if (gone.has(s.id)) continue;
      const r = await sendPush(s, o.payload);
      if (r === "ok") ok = true;
      if (r === "gone") gone.add(s.id);
    }
    if (ok) result[o.kind]++;
  }
  if (gone.size) await db.delete(subs).where(inArray(subs.id, [...gone]));
  result.gone = gone.size;
  return result;
}
