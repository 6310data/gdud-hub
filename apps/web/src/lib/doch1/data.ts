import "server-only";
/**
 * דוח 1 read models. Every loader takes the caller's `withUser` transaction, so what comes
 * back is already filtered by RLS (a platoon commander sees their platoon).
 */
import { byHe, placement, type Day, type ReportMember, type StatusDef, type UnitNode } from "@gdud/core";
import { and, asc, eq, inArray, schema, type Tx } from "@gdud/db";

const { people, doch1Rounds: rounds, doch1RoundCompanies: roundCompanies, doch1Statuses: statuses } = schema;
const { doch1Members: members, doch1Days: days } = schema;

export interface RoundVM {
  id: string;
  name: string;
  startsOn: Day;
  endsOn: Day;
  callUpOn: Day | null;
  /** "HH:MM" Israel time */
  lockAt: string;
  reminderAt: string;
  sendAt: string;
}

const hhmm = (t: string) => t.slice(0, 5);

export function toRoundVM(r: typeof rounds.$inferSelect): RoundVM {
  return {
    id: r.id,
    name: r.name,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    callUpOn: r.callUpOn,
    lockAt: hhmm(r.lockAt),
    reminderAt: hhmm(r.reminderAt),
    sendAt: hhmm(r.sendAt),
  };
}

export async function loadActiveRound(tx: Tx): Promise<RoundVM | null> {
  const [r] = await tx.select().from(rounds).where(eq(rounds.active, true)).limit(1);
  return r ? toRoundVM(r) : null;
}

export function toStatusDef(s: typeof statuses.$inferSelect): StatusDef {
  return {
    id: s.id,
    name: s.name,
    color: s.color,
    displayGroup: s.displayGroup,
    sheetValue: s.sheetValue,
    sortOrder: s.sortOrder,
    active: s.active,
    countsInSadak: s.countsInSadak,
    countsAsPresent: s.countsAsPresent,
    homeDay: s.homeDay,
    orgDay: s.orgDay,
    generalDay: s.generalDay,
    offDuty: s.offDuty,
    acrossBorder: s.acrossBorder,
    needsOutpost: s.needsOutpost,
  };
}

/**
 * Statuses of the round by sort order. Counting a day always passes `includeInactive`, so days
 * that point at a replaced status version still count by the flags they had; pickers use active ones.
 */
export async function loadStatuses(tx: Tx, roundId: string, opts: { includeInactive?: boolean } = {}): Promise<StatusDef[]> {
  const rows = await tx
    .select()
    .from(statuses)
    .where(opts.includeInactive ? eq(statuses.roundId, roundId) : and(eq(statuses.roundId, roundId), eq(statuses.active, true)))
    .orderBy(asc(statuses.sortOrder), asc(statuses.name));
  return rows.map(toStatusDef);
}

export interface MemberVM extends ReportMember {
  name: string;
  roleTitle: string | null;
  platoonName: string | null;
  /** the soldier's own unit (platoon or company) */
  unitId: string;
  sheetTab: string | null;
  sheetRow: number | null;
}

export interface RoundCompanyVM {
  unitId: string;
  active: boolean;
  appFrom: Day | null;
}

export async function loadRoundCompanies(tx: Tx, roundId: string): Promise<RoundCompanyVM[]> {
  return tx
    .select({ unitId: roundCompanies.unitId, active: roundCompanies.active, appFrom: roundCompanies.appFrom })
    .from(roundCompanies)
    .where(eq(roundCompanies.roundId, roundId));
}

/** Round members in the active round companies (company / platoon from the soldier's current unit), by name. */
export async function loadMembers(tx: Tx, roundId: string, units: UnitNode[]): Promise<MemberVM[]> {
  const byId = new Map(units.map((u) => [u.id, u]));
  const activeCompanies = new Set((await loadRoundCompanies(tx, roundId)).filter((c) => c.active).map((c) => c.unitId));
  const rows = await tx
    .select({
      personId: members.personId,
      inReport: members.inReport,
      sheetTab: members.sheetTab,
      sheetRow: members.sheetRow,
      name: people.fullName,
      roleTitle: people.roleTitle,
      unitId: people.unitId,
    })
    .from(members)
    .innerJoin(people, eq(people.id, members.personId))
    .where(eq(members.roundId, roundId));
  const out: MemberVM[] = [];
  for (const r of rows) {
    const { company, platoon } = placement(r.unitId, byId);
    if (!company || !activeCompanies.has(company.id)) continue;
    out.push({
      personId: r.personId,
      companyId: company.id,
      platoonId: platoon?.id ?? null,
      platoonName: platoon?.name ?? null,
      inReport: r.inReport,
      name: r.name,
      roleTitle: r.roleTitle,
      unitId: r.unitId,
      sheetTab: r.sheetTab,
      sheetRow: r.sheetRow,
    });
  }
  return out.sort((a, b) => byHe(a.name, b.name));
}

/** day → (personId → statusId) for the given days (optionally only these soldiers). */
export async function loadDays(
  tx: Tx,
  roundId: string,
  list: Day[],
  opts: { personIds?: readonly string[] } = {},
): Promise<Map<Day, Map<string, string>>> {
  const out = new Map<Day, Map<string, string>>(list.map((d) => [d, new Map()]));
  if (!list.length || opts.personIds?.length === 0) return out;
  const rows = await tx
    .select({ personId: days.personId, day: days.day, statusId: days.statusId })
    .from(days)
    .where(
      and(
        eq(days.roundId, roundId),
        inArray(days.day, list),
        opts.personIds ? inArray(days.personId, [...opts.personIds]) : undefined,
      ),
    );
  for (const r of rows) out.get(r.day)?.set(r.personId, r.statusId);
  return out;
}

/** Members under `unitId` (the unit itself or any unit below it). */
export function membersUnder<T extends Pick<MemberVM, "unitId">>(list: readonly T[], unitId: string, units: readonly UnitNode[]): T[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  return list.filter((m) => {
    const seen = new Set<string>();
    let cur: string | null | undefined = m.unitId;
    while (cur && !seen.has(cur)) {
      if (cur === unitId) return true;
      seen.add(cur);
      cur = byId.get(cur)?.parentId;
    }
    return false;
  });
}

/** Round members per company (any company, active in the round or not). */
export async function countMembersByCompany(tx: Tx, roundId: string, units: UnitNode[]): Promise<Map<string, number>> {
  const byId = new Map(units.map((u) => [u.id, u]));
  const rows = await tx
    .select({ unitId: people.unitId })
    .from(members)
    .innerJoin(people, eq(people.id, members.personId))
    .where(eq(members.roundId, roundId));
  const out = new Map<string, number>();
  for (const r of rows) {
    const company = placement(r.unitId, byId).company;
    if (company) out.set(company.id, (out.get(company.id) ?? 0) + 1);
  }
  return out;
}
