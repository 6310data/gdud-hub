import "server-only";
/**
 * The reports screen's read model (mockup 04), shared by the page and its Excel export. Runs in
 * the caller's `withUser` transaction, so a company user's reports cover the soldiers RLS lets
 * them see — their own company. The counting itself is `buildReports()` in @gdud/core.
 */
import { can } from "@gdud/auth";
import { buildReports, byHe, isDay, israelToday, type Day, type ReportCompany, type ReportGroup, type Reports, type StatusDef } from "@gdud/core";
import { asc, eq, schema, withUser, type Tx } from "@gdud/db";
import type { Session } from "@/lib/session";
import { loadActiveRound, loadDays, loadMembers, loadRoundCompanies, loadStatuses, type MemberVM, type RoundVM } from "./data";
import { loadLocations, type LocationVM } from "./standby";

const { people, doch1Members: members, doch1DmhCategories: categories, doch1ReportGroups: groups } = schema;

export interface DmhCategoryVM {
  id: string;
  name: string;
  listed: boolean;
  sortOrder: number;
}

export interface ReportGroupVM extends ReportGroup {
  id: string;
  sortOrder: number;
}

export async function loadDmhCategories(tx: Tx, roundId: string): Promise<DmhCategoryVM[]> {
  return tx
    .select({ id: categories.id, name: categories.name, listed: categories.listed, sortOrder: categories.sortOrder })
    .from(categories)
    .where(eq(categories.roundId, roundId))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

export async function loadReportGroups(tx: Tx, roundId: string): Promise<ReportGroupVM[]> {
  return tx
    .select({ id: groups.id, name: groups.name, commander: groups.commander, unitIds: groups.unitIds, sortOrder: groups.sortOrder })
    .from(groups)
    .where(eq(groups.roundId, roundId))
    .orderBy(asc(groups.sortOrder), asc(groups.name));
}

/** The round fields the reports need beyond loadMembers: תפקיד לדמ״ח, צפי הגעה, מספר אישי. */
async function loadReportFields(tx: Tx, roundId: string) {
  const rows = await tx
    .select({ personId: members.personId, dmhCategory: members.dmhCategory, personalNumber: people.personalNumber })
    .from(members)
    .innerJoin(people, eq(people.id, members.personId))
    .where(eq(members.roundId, roundId));
  return new Map(rows.map((r) => [r.personId, r]));
}

export interface ReportPerson {
  personId: string;
  name: string;
  personalNumber: string | null;
  company: string;
  platoon: string | null;
  location: string | null;
}

export interface ReportsData {
  round: RoundVM;
  day: Day;
  today: Day;
  companies: ReportCompany[];
  locations: LocationVM[];
  statuses: StatusDef[];
  dayStatuses: Map<string, string>;
  reports: Reports;
  people: Map<string, ReportPerson>;
  /** platoon id → name */
  platoonNames: Map<string, string>;
  /** settings in place (else the reports fall back to the data / a row per company) */
  configured: { categories: boolean; groups: boolean; camps: boolean };
}

/** Load and count the reports of `?day=` (inside the round; default today). null = no active round. */
export async function loadReportsData(s: Session, dayParam: string | undefined): Promise<ReportsData | null> {
  const today = israelToday(new Date());
  const data = await withUser(s.claims, async (tx) => {
    const round = await loadActiveRound(tx);
    if (!round) return null;
    const day = dayParam && isDay(dayParam) && dayParam >= round.startsOn && dayParam <= round.endsOn ? dayParam : today;
    const [roundCompanies, list, fields, statuses, days, locations, cats, grps] = await Promise.all([
      loadRoundCompanies(tx, round.id),
      loadMembers(tx, round.id, s.units),
      loadReportFields(tx, round.id),
      loadStatuses(tx, round.id, { includeInactive: true }),
      loadDays(tx, round.id, [day]),
      loadLocations(tx, round.id),
      loadDmhCategories(tx, round.id),
      loadReportGroups(tx, round.id),
    ]);
    return { round, day, roundCompanies, list, fields, statuses, dayStatuses: days.get(day)!, locations, cats, grps };
  });
  if (!data) return null;

  const unitById = new Map(s.units.map((u) => [u.id, u]));
  const companies: ReportCompany[] = data.roundCompanies
    .filter((c) => c.active && unitById.has(c.unitId) && can(s.user, "doch1", "any", c.unitId, s.parents))
    .map((c) => unitById.get(c.unitId)!)
    .sort((a, b) => a.sortOrder - b.sortOrder || byHe(a.name, b.name))
    .map((u) => ({ id: u.id, name: u.name }));
  const companyIds = new Set(companies.map((c) => c.id));
  const visible: MemberVM[] = data.list.filter((m) => companyIds.has(m.companyId));

  // inactive locations stay only while someone is there (by שבצ״ק or by a status)
  const inUse = new Set([...visible.map((m) => m.locationId), ...data.statuses.map((st) => st.locationId)]);
  const locations = data.locations.filter((l) => l.active || inUse.has(l.id));
  const locationName = new Map(data.locations.map((l) => [l.id, l.name]));

  const reports = buildReports({
    day: data.day,
    soldiers: visible.map((m) => {
      const f = data.fields.get(m.personId);
      return {
        personId: m.personId,
        companyId: m.companyId,
        platoonId: m.platoonId,
        inReport: m.inReport,
        callUpOn: m.callUpOn,
        releasedOn: m.releasedOn,
        arriving: m.arriving,
        locationId: m.locationId,
        dmhCategory: f?.dmhCategory ?? null,
        arrivalOptionId: m.arrivalOptionId,
        personalNumber: f?.personalNumber ?? null,
      };
    }),
    dayStatuses: data.dayStatuses,
    statuses: data.statuses,
    companies,
    locations: locations.map((l) => ({ id: l.id, name: l.name, kind: l.kind })),
    categories: data.cats,
    groups: data.grps,
  });

  const peopleById = new Map<string, ReportPerson>(
    visible.map((m) => [
      m.personId,
      {
        personId: m.personId,
        name: m.name,
        personalNumber: data.fields.get(m.personId)?.personalNumber ?? null,
        company: unitById.get(m.companyId)?.name ?? "",
        platoon: m.platoonName,
        location: m.locationId ? (locationName.get(m.locationId) ?? null) : null,
      },
    ]),
  );
  const platoonNames = new Map(visible.filter((m) => m.platoonId).map((m) => [m.platoonId!, m.platoonName ?? ""]));

  return {
    round: data.round,
    day: data.day,
    today,
    companies,
    locations,
    statuses: data.statuses,
    dayStatuses: data.dayStatuses,
    reports,
    people: peopleById,
    platoonNames,
    configured: {
      categories: data.cats.length > 0,
      groups: data.grps.length > 0,
      camps: data.statuses.some((st) => st.locationId),
    },
  };
}
