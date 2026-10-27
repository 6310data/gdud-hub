/**
 * The reports screen (mockup 04), counted the way the sheet's דוחות tab counts
 * (references/doch1/sheet-structure.md, "Reports in דוחות"). Like counting.ts, nothing here
 * knows a status, location or category name:
 *   - an outpost row counts by the soldier's שבצ״ק location (today's status is not checked);
 *   - a camp row counts by today's status — the status's location (settings › סטטוסים);
 *   - "עזה" is a status with `needsOutpost`, "not on duty" is `offDuty`, available is `standbyAvailable`;
 *   - דמ״ח columns are the round's categories (settings), matched to the soldier's text by canonical name.
 */
import { inService, type DayStatuses, type ServiceDates, type StatusDef } from "./counting";
import type { Day } from "./dates";
import { canonicalName } from "./normalize";
import { locationChecks, type LocationKind } from "./standby";

/** The R1 column for a blank or unknown דמ״ח category (the sheet: G blank = יתר). */
export const OTHER_CATEGORY = "יתר";

export interface ReportSoldier extends ServiceDates {
  personId: string;
  companyId: string;
  platoonId: string | null;
  inReport: boolean;
  /** מיקום בשבצ״ק; null = not in the שבצ״ק */
  locationId: string | null;
  /** תפקיד לדמ״ח as typed in the sheet / card */
  dmhCategory: string | null;
  /** צפי הגעה */
  arrivalForecast: string | null;
  personalNumber: string | null;
}

export interface ReportCompany {
  id: string;
  name: string;
}

export interface ReportLocation {
  id: string;
  name: string;
  kind: LocationKind;
}

export interface ReportCategory {
  name: string;
  /** listed by name in its own report (מט״בים) */
  listed: boolean;
}

/** A row of the 10א camp report: the soldiers of these units (companies or מסגרות). */
export interface ReportGroup {
  name: string;
  commander: string | null;
  unitIds: readonly string[];
}

export interface ReportInput {
  day: Day;
  soldiers: readonly ReportSoldier[];
  dayStatuses: DayStatuses;
  /** every status of the round, inactive versions too */
  statuses: readonly StatusDef[];
  /** in display order */
  companies: readonly ReportCompany[];
  /** in display order; only outposts and camps are report rows */
  locations: readonly ReportLocation[];
  /** in column order; empty = the categories used in the data, most used first */
  categories: readonly ReportCategory[];
  /** in row order; empty = a row per company */
  groups: readonly ReportGroup[];
}

/* ── helpers ── */

/** Categories the round hasn't configured: the texts in use, most used first (spelling variants merged). */
export function categoriesFromData(texts: ReadonlyArray<string | null>): ReportCategory[] {
  const seen = new Map<string, { name: string; n: number }>();
  for (const t of texts) {
    const key = t ? canonicalName(t) : "";
    if (!key || key === canonicalName(OTHER_CATEGORY)) continue;
    const e = seen.get(key);
    if (e) e.n++;
    else seen.set(key, { name: t!.trim(), n: 1 });
  }
  return [...seen.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "he")).map((e) => ({ name: e.name, listed: false }));
}

/** Index of the soldier's category among `categories`; `categories.length` = יתר (blank or unknown). */
export function categoryIndex(categories: readonly ReportCategory[], text: string | null): number {
  const key = text ? canonicalName(text) : "";
  const i = key ? categories.findIndex((c) => canonicalName(c.name) === key) : -1;
  return i < 0 ? categories.length : i;
}

/** מספר אישי as a comparable key: digits only, no leading zeros; null when there are none. */
export function personalNumberKey(v: string | null): string | null {
  const k = (v ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return k || null;
}

interface Ctx {
  /** listed on the day and counted in the report */
  roster: ReportSoldier[];
  status: (personId: string) => StatusDef | undefined;
  outposts: ReportLocation[];
  camps: ReportLocation[];
  categories: ReportCategory[];
}

function context(input: ReportInput): Ctx {
  const byId = new Map(input.statuses.map((s) => [s.id, s]));
  return {
    roster: input.soldiers.filter((m) => m.inReport && inService(m, input.day)),
    status: (personId) => byId.get(input.dayStatuses.get(personId) ?? ""),
    outposts: input.locations.filter((l) => l.kind === "outpost"),
    camps: input.locations.filter((l) => l.kind === "camp"),
    categories: input.categories.length ? [...input.categories] : categoriesFromData(input.soldiers.map((m) => m.dmhCategory)),
  };
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const addInto = (into: number[], xs: readonly number[]) => xs.forEach((n, i) => (into[i] = (into[i] ?? 0) + n));

/* ── R1: critical roles by company × location (sheet section A) ── */

export interface CriticalRolesRow {
  companyId: string;
  locationId: string;
  /** one per category, then יתר */
  counts: number[];
  total: number;
  acrossBorder: number;
}

export interface CriticalRoles {
  /** category names, then יתר */
  columns: string[];
  /** company × location, rows with nobody left out */
  rows: CriticalRolesRow[];
  total: Omit<CriticalRolesRow, "companyId" | "locationId">;
}

/**
 * An outpost row: soldiers whose שבצ״ק location is that outpost, whatever today's status — all
 * of them across the border (sheet: P = O). A camp row: soldiers whose status today is at that
 * camp; across the border only by the status flag (sheet: 0 for מיוערת).
 */
function criticalRoles(input: ReportInput, ctx: Ctx): CriticalRoles {
  const columns = [...ctx.categories.map((c) => c.name), OTHER_CATEGORY];
  const rows: CriticalRolesRow[] = [];
  for (const c of input.companies) {
    const ofCompany = ctx.roster.filter((m) => m.companyId === c.id);
    for (const loc of input.locations) {
      if (loc.kind === "outside") continue;
      const here = ofCompany.filter((m) => (loc.kind === "outpost" ? m.locationId === loc.id : ctx.status(m.personId)?.locationId === loc.id));
      if (!here.length) continue;
      const counts = columns.map(() => 0);
      for (const m of here) counts[categoryIndex(ctx.categories, m.dmhCategory)]!++;
      const acrossBorder = loc.kind === "outpost" ? here.length : here.filter((m) => ctx.status(m.personId)?.acrossBorder).length;
      rows.push({ companyId: c.id, locationId: loc.id, counts, total: here.length, acrossBorder });
    }
  }
  const counts = columns.map(() => 0);
  for (const r of rows) addInto(counts, r.counts);
  return { columns, rows, total: { counts, total: sum(rows.map((r) => r.total)), acrossBorder: sum(rows.map((r) => r.acrossBorder)) } };
}

/* ── R2: 15א — needs-outpost status by outpost, and the camps (sheet section C) ── */

export interface OutpostRow {
  companyId: string;
  /** needs-outpost status today and at this outpost, one per outpost */
  outposts: number[];
  /** needs-outpost status today */
  needsOutpost: number;
  /** of them, at no outpost in the שבצ״ק */
  noOutpost: number;
  /** status at this camp today, one per camp */
  camps: number[];
  total: number;
}

export interface OutpostReport {
  outposts: ReportLocation[];
  camps: ReportLocation[];
  rows: OutpostRow[];
  total: Omit<OutpostRow, "companyId">;
}

function outpostReport(input: ReportInput, ctx: Ctx): OutpostReport {
  const rows = input.companies.map((c): OutpostRow => {
    const ofCompany = ctx.roster.filter((m) => m.companyId === c.id);
    const needing = ofCompany.filter((m) => ctx.status(m.personId)?.needsOutpost);
    const outposts = ctx.outposts.map((o) => needing.filter((m) => m.locationId === o.id).length);
    const camps = ctx.camps.map((l) => ofCompany.filter((m) => ctx.status(m.personId)?.locationId === l.id).length);
    return { companyId: c.id, outposts, needsOutpost: needing.length, noOutpost: needing.length - sum(outposts), camps, total: needing.length + sum(camps) };
  });
  const total = { outposts: ctx.outposts.map(() => 0), needsOutpost: 0, noOutpost: 0, camps: ctx.camps.map(() => 0), total: 0 };
  for (const r of rows) {
    addInto(total.outposts, r.outposts);
    addInto(total.camps, r.camps);
    total.needsOutpost += r.needsOutpost;
    total.noOutpost += r.noOutpost;
    total.total += r.total;
  }
  return { outposts: ctx.outposts, camps: ctx.camps, rows, total };
}

/* ── R3: 10א — who is at each camp, by report group (sheet section D) ── */

export interface CampRow {
  name: string;
  commander: string | null;
  count: number;
}

export interface CampReport {
  location: ReportLocation;
  rows: CampRow[];
  /** soldiers at the camp whose unit is in no group */
  unassigned: number;
  total: number;
}

/** The group of a soldier: the first that names their מסגרת, else the first that names their company. */
export function groupIndex(groups: readonly ReportGroup[], m: Pick<ReportSoldier, "companyId" | "platoonId">): number {
  const byPlatoon = m.platoonId ? groups.findIndex((g) => g.unitIds.includes(m.platoonId!)) : -1;
  return byPlatoon >= 0 ? byPlatoon : groups.findIndex((g) => g.unitIds.includes(m.companyId));
}

function campReports(input: ReportInput, ctx: Ctx): CampReport[] {
  const groups: ReportGroup[] = input.groups.length ? [...input.groups] : input.companies.map((c) => ({ name: c.name, commander: null, unitIds: [c.id] }));
  return ctx.camps.map((location) => {
    const here = ctx.roster.filter((m) => ctx.status(m.personId)?.locationId === location.id);
    const counts = groups.map(() => 0);
    let unassigned = 0;
    for (const m of here) {
      const i = groupIndex(groups, m);
      if (i < 0) unassigned++;
      else counts[i]!++;
    }
    return { location, rows: groups.map((g, i) => ({ name: g.name, commander: g.commander, count: counts[i]! })), unassigned, total: here.length };
  });
}

/* ── R4: the listed categories (מט״בים) ── */

export interface ListedSoldier {
  personId: string;
  category: string;
  /** null = no report today */
  statusId: string | null;
  available: boolean;
}

function listedSoldiers(ctx: Ctx): ListedSoldier[] {
  const out: ListedSoldier[] = [];
  for (const m of ctx.roster) {
    const cat = ctx.categories[categoryIndex(ctx.categories, m.dmhCategory)];
    if (!cat?.listed) continue;
    const st = ctx.status(m.personId);
    out.push({ personId: m.personId, category: cat.name, statusId: st?.id ?? null, available: !!st?.standbyAvailable });
  }
  return out;
}

/* ── R5: data control per company (sheet section B) ── */

export interface ControlRow {
  companyId: string;
  /** listed and counted */
  rows: number;
  offDuty: number;
  missing: number;
  /** rows − not on duty − missing */
  onDuty: number;
  /** needs-outpost status without an outpost in the שבצ״ק */
  noOutpost: number;
  /** at an outpost with another status */
  atOutpostOther: number;
  /** with a location in the שבצ״ק */
  inShabzak: number;
}

function dataControl(input: ReportInput, ctx: Ctx): ControlRow[] {
  return input.companies.map((c) => {
    const ofCompany = ctx.roster.filter((m) => m.companyId === c.id);
    const reported = ofCompany.filter((m) => input.dayStatuses.has(m.personId));
    const offDuty = reported.filter((m) => ctx.status(m.personId)?.offDuty).length;
    const missing = ofCompany.length - reported.length;
    const checks = locationChecks(ofCompany.map((m) => ({ personId: m.personId, inReport: true, locationKind: kindOf(input, m.locationId) })), input.dayStatuses, input.statuses);
    return {
      companyId: c.id,
      rows: ofCompany.length,
      offDuty,
      missing,
      onDuty: ofCompany.length - offDuty - missing,
      noOutpost: checks.outpostStatusWithoutOutpost.length,
      atOutpostOther: checks.atOutpostOtherStatus.length,
      inShabzak: ofCompany.filter((m) => m.locationId).length,
    };
  });
}

function kindOf(input: ReportInput, locationId: string | null): LocationKind | null {
  return locationId ? (input.locations.find((l) => l.id === locationId)?.kind ?? null) : null;
}

/* ── data checks (spec, phase 4) ── */

export const DATA_CHECKS = [
  "missing",
  "notInShabzak",
  "outpostStatusNoOutpost",
  "atOutpostOtherStatus",
  "shabzakNotInRound",
  "noForecast",
  "duplicateNumber",
  "noNumber",
] as const;
export type DataCheck = (typeof DATA_CHECKS)[number];

export const DATA_CHECK_LABEL: Record<DataCheck, string> = {
  missing: "אין סטטוס היום",
  notInShabzak: "בסד״כ ולא בשבצ״ק",
  outpostStatusNoOutpost: "סטטוס שדורש מוצב בלי מוצב בשבצ״ק",
  atOutpostOtherStatus: "במוצב בשבצ״ק בסטטוס אחר",
  shabzakNotInRound: "בשבצ״ק ולא בדוח היום",
  noForecast: "אין צפי הגעה",
  duplicateNumber: "מספר אישי כפול",
  noNumber: "אין מספר אישי",
};

/**
 * Soldiers each check flags, by personId (each list in the soldiers' input order):
 * - missing — listed today, no report;
 * - notInShabzak — today's status counts in the סד״כ, no שבצ״ק location;
 * - outpostStatusNoOutpost / atOutpostOtherStatus — the status ↔ שבצ״ק disagreements (locationChecks);
 * - shabzakNotInRound — has a שבצ״ק location but isn't in today's report (not called up, released or "לא נספר בדוח");
 * - noForecast — in the report and not released by the day, no צפי הגעה;
 * - duplicateNumber — the same מספר אישי (digits only) on two soldiers; noNumber — none at all.
 */
export function dataChecks(input: ReportInput): Record<DataCheck, string[]> {
  const ctx = context(input);
  const roster = new Set(ctx.roster.map((m) => m.personId));
  const loc = locationChecks(
    ctx.roster.map((m) => ({ personId: m.personId, inReport: true, locationKind: kindOf(input, m.locationId) })),
    input.dayStatuses,
    input.statuses,
  );
  const byNumber = new Map<string, string[]>();
  for (const m of input.soldiers) {
    const k = personalNumberKey(m.personalNumber);
    if (k) byNumber.set(k, [...(byNumber.get(k) ?? []), m.personId]);
  }
  const dup = new Set([...byNumber.values()].filter((ids) => ids.length > 1).flat());
  return {
    missing: ctx.roster.filter((m) => !input.dayStatuses.has(m.personId)).map((m) => m.personId),
    notInShabzak: ctx.roster.filter((m) => !m.locationId && ctx.status(m.personId)?.countsInSadak).map((m) => m.personId),
    outpostStatusNoOutpost: loc.outpostStatusWithoutOutpost,
    atOutpostOtherStatus: loc.atOutpostOtherStatus,
    shabzakNotInRound: input.soldiers.filter((m) => m.locationId && !roster.has(m.personId)).map((m) => m.personId),
    noForecast: input.soldiers
      .filter((m) => m.inReport && (m.releasedOn === null || m.releasedOn >= input.day) && !m.arrivalForecast?.trim())
      .map((m) => m.personId),
    duplicateNumber: input.soldiers.filter((m) => dup.has(m.personId)).map((m) => m.personId),
    noNumber: input.soldiers.filter((m) => !personalNumberKey(m.personalNumber)).map((m) => m.personId),
  };
}

/* ── F: סד״כ per מסגרת ── */

export interface SadakColumns {
  /** the needs-outpost statuses split by outpost, then "ללא מוצב" */
  outposts: ReportLocation[];
  /** one column per status name (versions merged), not needs-outpost and not off duty */
  statuses: Array<{ name: string; ids: string[] }>;
}

export interface SadakRow {
  companyId: string;
  /** null = soldiers at company level (no מסגרת) */
  platoonId: string | null;
  outposts: number[];
  noOutpost: number;
  statuses: number[];
  missing: number;
  /** listed − not on duty */
  total: number;
}

export interface SadakTable {
  columns: SadakColumns;
  rows: SadakRow[];
  total: Omit<SadakRow, "companyId" | "platoonId">;
}

/**
 * Per company, a row per מסגרת: the needs-outpost statuses by שבצ״ק outpost, every other status
 * (an active one, or an inactive version someone has today), missing, total. Off-duty statuses
 * have no column (the sheet's `0`).
 */
function sadakTable(input: ReportInput, ctx: Ctx): SadakTable {
  const used = new Set(ctx.roster.map((m) => input.dayStatuses.get(m.personId)).filter((x): x is string => !!x));
  const named = new Map<string, { ids: string[]; sortOrder: number }>();
  for (const s of input.statuses) {
    if (s.needsOutpost || s.offDuty || (!s.active && !used.has(s.id))) continue;
    const e = named.get(s.name);
    if (e) {
      e.ids.push(s.id);
      e.sortOrder = Math.min(e.sortOrder, s.sortOrder);
    } else named.set(s.name, { ids: [s.id], sortOrder: s.sortOrder });
  }
  const statuses = [...named.entries()].sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[0].localeCompare(b[0], "he")).map(([name, e]) => ({ name, ids: e.ids }));
  const columns: SadakColumns = { outposts: ctx.outposts, statuses };

  const rows: SadakRow[] = [];
  for (const c of input.companies) {
    const ofCompany = ctx.roster.filter((m) => m.companyId === c.id);
    const platoons = [...new Set(ofCompany.map((m) => m.platoonId))];
    for (const platoonId of platoons) {
      const here = ofCompany.filter((m) => m.platoonId === platoonId);
      const needing = here.filter((m) => ctx.status(m.personId)?.needsOutpost);
      const outposts = ctx.outposts.map((o) => needing.filter((m) => m.locationId === o.id).length);
      const statusCounts = statuses.map((col) => here.filter((m) => col.ids.includes(input.dayStatuses.get(m.personId) ?? "")).length);
      const missing = here.filter((m) => !input.dayStatuses.has(m.personId)).length;
      const offDuty = here.filter((m) => ctx.status(m.personId)?.offDuty).length;
      rows.push({
        companyId: c.id,
        platoonId,
        outposts,
        noOutpost: needing.length - sum(outposts),
        statuses: statusCounts,
        missing,
        total: here.length - offDuty,
      });
    }
  }
  const total = { outposts: ctx.outposts.map(() => 0), noOutpost: 0, statuses: statuses.map(() => 0), missing: 0, total: 0 };
  for (const r of rows) {
    addInto(total.outposts, r.outposts);
    addInto(total.statuses, r.statuses);
    total.noOutpost += r.noOutpost;
    total.missing += r.missing;
    total.total += r.total;
  }
  return { columns, rows, total };
}

/* ── everything ── */

export interface ReportSummary {
  /** on duty: listed − not on duty − missing (sheet "שמ״פ") */
  onDuty: number;
  /** R1 total (כ״א מתפקד בגזרה) */
  inSector: number;
  acrossBorder: number;
  camps: Array<{ location: ReportLocation; count: number }>;
  listedAvailable: number;
  listedTotal: number;
}

export interface Reports {
  summary: ReportSummary;
  categories: ReportCategory[];
  criticalRoles: CriticalRoles;
  outposts: OutpostReport;
  camps: CampReport[];
  listed: ListedSoldier[];
  control: ControlRow[];
  checks: Record<DataCheck, string[]>;
  sadak: SadakTable;
}

export function buildReports(input: ReportInput): Reports {
  const ctx = context(input);
  const r1 = criticalRoles(input, ctx);
  const control = dataControl(input, ctx);
  const camps = campReports(input, ctx);
  const listed = listedSoldiers(ctx);
  return {
    summary: {
      onDuty: sum(control.map((c) => c.onDuty)),
      inSector: r1.total.total,
      acrossBorder: r1.total.acrossBorder,
      camps: camps.map((c) => ({ location: c.location, count: c.total })),
      listedAvailable: listed.filter((x) => x.available).length,
      listedTotal: listed.length,
    },
    categories: ctx.categories,
    criticalRoles: r1,
    outposts: outpostReport(input, ctx),
    camps,
    listed,
    control,
    checks: dataChecks(input),
    sadak: sadakTable(input, ctx),
  };
}
