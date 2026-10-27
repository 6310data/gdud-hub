/**
 * Planning the next round: comparing the battalion's soldier list with last round's roster,
 * and how far the companies got with צפי הגעה.
 * Spec: docs/superpowers/specs/2026-10-27-doch1-round-planning-design.md.
 */
import type { ArrivalEffect } from "./counting";
import { canonicalName, normalizePersonalNumber } from "./normalize";

/** A row of the battalion's file (the אלפון layout), as read; `line` is the file's row number. */
export interface RosterRow {
  line: number;
  personalNumber: string;
  fullName: string;
  /** company and platoon text as written in the file; the caller maps them to units */
  company: string;
  platoon: string;
  phone: string | null;
  /** תפקיד בפועל */
  role: string | null;
}

/** A row whose number and unit are known. */
export type ResolvedRow = Omit<RosterRow, "personalNumber"> & { personalNumber: string; unitId: string };

/** A soldier the app already has (people row). */
export interface RosterMember {
  personId: string;
  personalNumber: string | null;
  fullName: string;
  unitId: string;
  phone: string | null;
  role: string | null;
}

export type RosterField = "name" | "unit" | "phone" | "role";

export interface RosterMatch {
  row: ResolvedRow;
  member: RosterMember;
  /** fields where the file differs; a blank value in the file is not a difference */
  fields: RosterField[];
}

export interface RosterDiff {
  /** not in the app at all */
  added: ResolvedRow[];
  /** in the app, not in the base round */
  returning: RosterMatch[];
  /** in the base round, with differences */
  changed: RosterMatch[];
  unchanged: Array<{ row: ResolvedRow; member: RosterMember }>;
  /** in the base round, not in the file (לא ברשימת הגדוד) */
  missing: RosterMember[];
  /** rows left out: bad number, a soldier twice, an unknown company or platoon */
  problems: Array<{ line: number; message: string }>;
}

const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");

function differences(row: ResolvedRow, member: RosterMember): RosterField[] {
  const fields: RosterField[] = [];
  if (row.fullName.trim() && canonicalName(row.fullName) !== canonicalName(member.fullName)) fields.push("name");
  if (row.unitId !== member.unitId) fields.push("unit");
  if (digits(row.phone) && digits(row.phone) !== digits(member.phone)) fields.push("phone");
  if (row.role?.trim() && row.role.trim() !== (member.role ?? "").trim()) fields.push("role");
  return fields;
}

/**
 * Compare the battalion's list with the base round (`base`: its members; on a re-run, the
 * planning round's members too). `known` = every soldier in the app by personal number.
 * `unitOf` maps a row's company / platoon text to a unit, or null when it is unknown.
 */
export function diffRoster(input: {
  rows: readonly RosterRow[];
  base: readonly RosterMember[];
  known: ReadonlyMap<string, RosterMember>;
  unitOf: (row: RosterRow) => string | null;
}): RosterDiff {
  const diff: RosterDiff = { added: [], returning: [], changed: [], unchanged: [], missing: [], problems: [] };
  const baseByNumber = new Map(input.base.filter((m) => m.personalNumber).map((m) => [m.personalNumber!, m]));
  const firstLine = new Map<string, number>();
  const matched = new Set<string>();

  for (const r of input.rows) {
    const personalNumber = normalizePersonalNumber(r.personalNumber);
    if (!personalNumber) {
      diff.problems.push({ line: r.line, message: `מספר אישי חסר או שגוי: "${r.personalNumber}"` });
      continue;
    }
    const seen = firstLine.get(personalNumber);
    if (seen !== undefined) {
      diff.problems.push({ line: r.line, message: `מספר אישי ${personalNumber} מופיע פעמיים בקובץ (גם בשורה ${seen})` });
      continue;
    }
    firstLine.set(personalNumber, r.line);
    const unitId = input.unitOf(r);
    if (!unitId) {
      diff.problems.push({ line: r.line, message: `פלוגה / מחלקה לא מוכרת: ${[r.company, r.platoon].filter(Boolean).join(" / ")}` });
      continue;
    }
    const row: ResolvedRow = { ...r, personalNumber, unitId };
    const inBase = baseByNumber.get(personalNumber);
    if (inBase) {
      matched.add(inBase.personId);
      const fields = differences(row, inBase);
      if (fields.length) diff.changed.push({ row, member: inBase, fields });
      else diff.unchanged.push({ row, member: inBase });
      continue;
    }
    const known = input.known.get(personalNumber);
    if (known) diff.returning.push({ row, member: known, fields: differences(row, known) });
    else diff.added.push(row);
  }

  diff.missing = input.base.filter((m) => !matched.has(m.personId));
  return diff;
}

export interface PlanningCounts {
  total: number;
  arriving: number;
  notArriving: number;
  /** צפי הגעה not filled yet */
  blank: number;
}

/** צפי הגעה progress per company, and for the battalion under "all". */
export function planningProgress(members: ReadonlyArray<{ companyId: string; arrival: ArrivalEffect | null }>): Map<string, PlanningCounts> {
  const out = new Map<string, PlanningCounts>();
  const bump = (key: string, arrival: ArrivalEffect | null) => {
    const c = out.get(key) ?? { total: 0, arriving: 0, notArriving: 0, blank: 0 };
    c.total++;
    if (arrival === "arriving") c.arriving++;
    else if (arrival === "not_arriving") c.notArriving++;
    else c.blank++;
    out.set(key, c);
  };
  for (const m of members) {
    bump(m.companyId, m.arrival);
    bump("all", m.arrival);
  }
  if (!out.has("all")) out.set("all", { total: 0, arriving: 0, notArriving: 0, blank: 0 });
  return out;
}
