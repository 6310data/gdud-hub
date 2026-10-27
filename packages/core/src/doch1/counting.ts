/**
 * דוח 1 counting. Every number here comes from the status flags and display groups
 * defined in settings — never from a status name — so next round's words need no code change.
 */
import type { Day } from "./dates";

export interface StatusFlags {
  /** נספר בסד״כ */
  countsInSadak: boolean;
  /** sheet group שנספר — presence days */
  countsAsPresent: boolean;
  /** sheet group רענון */
  homeDay: boolean;
  /** sheet group התארגנות */
  orgDay: boolean;
  /** sheet group כללי */
  generalDay: boolean;
  /** not on active duty that day ("0", נפקד) — reported, not missing */
  offDuty: boolean;
  acrossBorder: boolean;
  needsOutpost: boolean;
}

export const STATUS_FLAG_KEYS = [
  "countsInSadak",
  "countsAsPresent",
  "homeDay",
  "orgDay",
  "generalDay",
  "offDuty",
  "acrossBorder",
  "needsOutpost",
] as const satisfies readonly (keyof StatusFlags)[];

/** Did any counting flag change? (Name, color, group and order changes don't need a new version.) */
export function statusFlagsChanged(a: StatusFlags, b: StatusFlags): boolean {
  return STATUS_FLAG_KEYS.some((k) => a[k] !== b[k]);
}

export interface StatusDef extends StatusFlags {
  id: string;
  name: string;
  color: string;
  displayGroup: string;
  sheetValue: string;
  sortOrder: number;
  active: boolean;
  /** available for standby (שבצ״ק readiness); only today counts, so not a versioned flag */
  standbyAvailable?: boolean;
  /** the camp a soldier in this status is at (reports: camp rows count by status); not versioned, like standbyAvailable */
  locationId?: string | null;
}

export interface ReportMember {
  personId: string;
  companyId: string;
  platoonId: string | null;
  inReport: boolean;
}

/** What a צפי הגעה value does (doch1_field_options.effect, field 'arrival'). */
export type ArrivalEffect = "arriving" | "not_arriving";
/** What a סטטוס גיוס value does (doch1_field_options.effect, field 'enlistment'). */
export type EnlistmentEffect = "arrived" | "pending" | "postponed" | "released";

/** A soldier's service in the round (תאריך גיוס / תאריך שחרור, צפי הגעה). */
export interface ServiceDates {
  callUpOn: Day | null;
  releasedOn: Day | null;
  /** false only for a "not arriving" צפי הגעה; a blank one counts as arriving */
  arriving: boolean;
}

/**
 * The likely effect of a סטטוס גיוס value read from the sheet, by its words — what the import gives
 * a new value until the admin changes it in settings. "טרם התייצב" is pending, "התייצב" arrived.
 * Keep in sync with migrations/0022_doch1_enlistment_effects.sql.
 */
export function guessEnlistmentEffect(text: string): EnlistmentEffect {
  if (/טרם|לא\s*התייצב|נפקד|בדרך/.test(text)) return "pending";
  if (/נדח|דחי/.test(text)) return "postponed";
  if (/שוחרר|שחרור|פטור/.test(text)) return "released";
  if (/התייצב|הגיע|נקלט/.test(text)) return "arrived";
  return "pending";
}

/** `arriving` of a member from their צפי הגעה value's effect (null = not filled). */
export function isArriving(effect: ArrivalEffect | null | undefined): boolean {
  return effect !== "not_arriving";
}

/**
 * Is the soldier listed on `day`? From the call-up date through the release date, inclusive,
 * unless marked not arriving. No call-up date, or not arriving = listed on no day: every screen,
 * count and reminder leaves the soldier out.
 */
export function inService(m: ServiceDates, day: Day): boolean {
  return m.arriving && m.callUpOn !== null && m.callUpOn <= day && (m.releasedOn === null || day <= m.releasedOn);
}

/** Is the soldier listed on any day from `from` to `to` (inclusive)? */
export function inServiceBetween(m: ServiceDates, from: Day, to: Day): boolean {
  return m.arriving && m.callUpOn !== null && m.callUpOn <= to && (m.releasedOn === null || from <= m.releasedOn);
}

/** personId → statusId for one day; a missing key = no entry (= missing report). */
export type DayStatuses = ReadonlyMap<string, string>;

export interface GroupCount {
  name: string;
  color: string;
  count: number;
}

export interface Summary {
  /** members counted (inReport) */
  roster: number;
  /** members with any entry */
  reported: number;
  /** inReport members without an entry */
  missing: number;
  /** entries whose status countsInSadak */
  inSadak: number;
  /** entries whose status offDuty */
  offDuty: number;
  /** countsInSadak statuses grouped by displayGroup, ordered by the group's lowest sortOrder; empty groups left out */
  groups: GroupCount[];
  /** reported / roster, 0..1 (1 when roster = 0) */
  completion: number;
}

export function summarize(members: readonly ReportMember[], day: DayStatuses, statuses: readonly StatusDef[]): Summary {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const groups = new Map<string, { color: string; sortOrder: number; count: number }>();
  let roster = 0;
  let reported = 0;
  let inSadak = 0;
  let offDuty = 0;

  for (const m of members) {
    if (!m.inReport) continue;
    roster++;
    const statusId = day.get(m.personId);
    if (statusId === undefined) continue;
    reported++;
    const st = byId.get(statusId);
    if (!st) continue;
    if (st.offDuty) offDuty++;
    if (!st.countsInSadak) continue;
    inSadak++;
    const g = groups.get(st.displayGroup);
    if (!g) groups.set(st.displayGroup, { color: st.color, sortOrder: st.sortOrder, count: 1 });
    else g.count++;
  }

  // a group's color/order come from its lowest-sortOrder status, used or not
  for (const st of statuses) {
    const g = groups.get(st.displayGroup);
    if (st.countsInSadak && g && st.sortOrder < g.sortOrder) {
      g.sortOrder = st.sortOrder;
      g.color = st.color;
    }
  }

  return {
    roster,
    reported,
    missing: roster - reported,
    inSadak,
    offDuty,
    groups: [...groups.entries()]
      .sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[0].localeCompare(b[0], "he"))
      .map(([name, g]) => ({ name, color: g.color, count: g.count })),
    completion: roster === 0 ? 1 : reported / roster,
  };
}

/** In-report members with no entry for the day. */
export function missingMembers<T extends ReportMember>(members: readonly T[], day: DayStatuses): T[] {
  return members.filter((m) => m.inReport && !day.has(m.personId));
}

/** "השלמת חסרים לפי אתמול": today's missing members who had an entry yesterday. */
export function fillFromYesterdayPlan(
  members: readonly ReportMember[],
  today: DayStatuses,
  yesterday: DayStatuses,
): Array<{ personId: string; statusId: string }> {
  const out: Array<{ personId: string; statusId: string }> = [];
  for (const m of missingMembers(members, today)) {
    const statusId = yesterday.get(m.personId);
    if (statusId !== undefined) out.push({ personId: m.personId, statusId });
  }
  return out;
}

export interface DayWrite {
  personId: string;
  day: Day;
  /** null = no entry (delete) */
  statusId: string | null;
}

export const dayKey = (personId: string, day: Day): string => `${personId}|${day}`;

/**
 * Group update: every person × day set to `statusId`. Cells that already hold it are skipped.
 * `undo` restores each written cell (null where there was no entry);
 * `overwritten` counts cells that held a different status.
 * @param existing `${personId}|${day}` → statusId
 */
export function planBulkWrite(
  existing: ReadonlyMap<string, string>,
  personIds: readonly string[],
  days: readonly Day[],
  statusId: string,
): { writes: DayWrite[]; undo: DayWrite[]; overwritten: number } {
  const writes: DayWrite[] = [];
  const undo: DayWrite[] = [];
  let overwritten = 0;
  for (const personId of personIds) {
    for (const day of days) {
      const prev = existing.get(dayKey(personId, day));
      if (prev === statusId) continue;
      writes.push({ personId, day, statusId });
      undo.push({ personId, day, statusId: prev ?? null });
      if (prev !== undefined) overwritten++;
    }
  }
  return { writes, undo, overwritten };
}
