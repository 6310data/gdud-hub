import "server-only";
/**
 * The soldier card's read models (mockup screen 09). Like data.ts, everything runs in the
 * caller's `withUser` transaction: a soldier the user doesn't cover comes back as null.
 */
import type { AuditEntry, Day } from "@gdud/core";
import { and, asc, eq, schema, sql, type Tx } from "@gdud/db";
import { memberArriving } from "./data";

const { people, doch1Members: members, doch1Days: days } = schema;

export interface SoldierVM {
  personId: string;
  name: string;
  personalNumber: string | null;
  phone: string | null;
  roleTitle: string | null;
  unitId: string;
  inReport: boolean;
  callUpOn: Day | null;
  releasedOn: Day | null;
  /** false = marked not arriving (listed on no day) */
  arriving: boolean;
  dmhCategory: string | null;
  arrivalForecast: string | null;
  enlistmentStatus: string | null;
  hasDisc: boolean | null;
  notes: string | null;
  locationId: string | null;
}

export async function loadSoldier(tx: Tx, roundId: string, personId: string): Promise<SoldierVM | null> {
  const [r] = await tx
    .select({
      personId: members.personId,
      name: people.fullName,
      personalNumber: people.personalNumber,
      phone: people.phone,
      roleTitle: people.roleTitle,
      unitId: people.unitId,
      inReport: members.inReport,
      callUpOn: members.callUpOn,
      releasedOn: members.releasedOn,
      arriving: memberArriving,
      dmhCategory: members.dmhCategory,
      arrivalForecast: members.arrivalForecast,
      enlistmentStatus: members.enlistmentStatus,
      hasDisc: members.hasDisc,
      notes: members.notes,
      locationId: members.locationId,
    })
    .from(members)
    .innerJoin(people, eq(people.id, members.personId))
    .where(and(eq(members.roundId, roundId), eq(members.personId, personId)));
  return r ?? null;
}

/** Every day of the soldier in the round: day → statusId. */
export async function loadSoldierDays(tx: Tx, roundId: string, personId: string): Promise<Map<Day, string>> {
  const rows = await tx
    .select({ day: days.day, statusId: days.statusId })
    .from(days)
    .where(and(eq(days.roundId, roundId), eq(days.personId, personId)))
    .orderBy(asc(days.day));
  return new Map(rows.map((r) => [r.day, r.statusId]));
}

/**
 * The values already used in the round for a free-text member field — the edit sheet suggests
 * them (the sheet's lists: סטטוס גיוס, צפי הגעה, תפקיד לדמ״ח).
 */
export async function loadFieldValues(tx: Tx, roundId: string): Promise<{ enlistment: string[]; arrival: string[]; dmh: string[] }> {
  const distinct = async (col: typeof members.enlistmentStatus | typeof members.arrivalForecast | typeof members.dmhCategory) =>
    (await tx.selectDistinct({ v: col }).from(members).where(and(eq(members.roundId, roundId), sql`${col} is not null`)))
      .map((r) => r.v!)
      .sort((a, b) => a.localeCompare(b, "he"));
  const [enlistment, arrival, dmh] = await Promise.all([distinct(members.enlistmentStatus), distinct(members.arrivalForecast), distinct(members.dmhCategory)]);
  return { enlistment, arrival, dmh };
}

export interface LogRowVM extends AuditEntry {
  at: Date;
  actor: string | null;
}

/** The soldier's change log, newest first (app.doch1_person_log: their days, round fields, people row). */
export async function loadSoldierLog(tx: Tx, roundId: string, personId: string, limit = 60): Promise<LogRowVM[]> {
  type Row = { at: string | Date; actor: string | null; table_name: string; action: string; before: unknown; after: unknown };
  const res = await tx.execute<Row>(sql`select * from app.doch1_person_log(${roundId}::uuid, ${personId}::uuid, ${limit})`);
  const rows = (Array.isArray(res) ? res : (res as unknown as { rows: Row[] }).rows) as Row[];
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : typeof v === "string" ? (JSON.parse(v) as Record<string, unknown>) : null);
  return rows.map((r) => ({ at: new Date(r.at), actor: r.actor, table: r.table_name, action: r.action, before: obj(r.before), after: obj(r.after) }));
}
