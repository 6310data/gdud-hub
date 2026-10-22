/**
 * Parse the round sheet "דוח 1 - סבב <n>" (layout: references/doch1/sheet-structure.md).
 * Columns are found by header text, never by position, so the old פלתצ layout and
 * renamed headers still work. Sheet template knowledge (tab and header names) lives here only.
 */
import { canonicalName, cellText, normalizePersonalNumber, isDay, type Day } from "@gdud/core";
import type { Cell, SheetGrid } from "./read";

export interface ParsedRow {
  sheetRow: number;
  personalNumber: string;
  firstName: string;
  lastName: string;
  platoonText: string;
  roleTitle: string;
  dmhCategory: string;
  phone: string;
  arrivalForecast: string;
  callUpOn: Day | null;
  enlistmentStatus: string;
  hasDisc: boolean | null;
  notes: string;
  /** every date column; "" = empty cell; numeric 0 → "0" */
  days: Map<Day, string>;
}

export interface ParsedTab {
  tabName: string;
  /** canonicalName(tabName) */
  key: string;
  /** hidden in the workbook (e.g. an old company's tab) */
  hidden: boolean;
  rows: ParsedRow[];
  firstDay: Day;
  lastDay: Day;
}

export type StatusGroup = "present" | "general" | "home" | "org" | "notCounted";

export interface StatusGroupHint {
  value: string;
  groups: StatusGroup[];
}

export interface ParsedSheet {
  tabs: ParsedTab[];
  statusHints: StatusGroupHint[];
  roundStart: Day | null;
  roundEnd: Day | null;
  warnings: string[];
}

const HEADER_ROW = 3;
const FIRST_DATA_ROW = 4;

type Field = "personalNumber" | "firstName" | "lastName" | "platoon" | "role" | "dmh" | "phone" | "arrival" | "callUp" | "enlistment" | "disc" | "notes";

const HEADER_ALIASES: Record<Field, string[]> = {
  personalNumber: ["מספר אישי"],
  firstName: ["שם פרטי"],
  lastName: ["שם משפחה"],
  platoon: ["מסגרת"],
  role: ["תפקיד בפועל", "תקן"],
  dmh: ["תפקיד לדמח"],
  phone: ["טלפון"],
  arrival: ["סטטוס הגעה על פי צפי גיוס"],
  callUp: ["תאריך גיוס על פי צפי גיוס", "תאריך גיוס"],
  enlistment: ["סטטוס גיוס"],
  disc: ["דיסקית"],
  notes: ["הערות"],
};
const ALIAS_TO_FIELD = new Map<string, Field>(
  Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) => aliases.map((a) => [canonicalName(a), field as Field] as const)),
);

const DROPDOWNS_TAB = "dropdowns";
const DROPDOWNS_HEADER_ROW = 2;
/**
 * Dropdowns row-2 group headers → status flags hint. Order = order of `groups` in a hint.
 * The export writes them as "סטטוס שנספר", "סטטוס כללי", …; the bare word is accepted too.
 */
const STATUS_GROUP_HEADERS: Array<[string, StatusGroup]> = [
  ["שנספר", "present"],
  ["כללי", "general"],
  ["רענון", "home"],
  ["התארגנות", "org"],
  ["שלא נספר", "notCounted"],
];
const STATUS_GROUP_HEADER_PREFIX = "סטטוס";
/** Named ranges תחילת_תאריך = Dropdowns!L1, סוף_תאריך = Dropdowns!N1 (0-based columns). */
const ROUND_START_COL = 11;
const ROUND_END_COL = 13;

const MS_PER_DAY = 86_400_000;

/** A header/cell date as a day. Exports keep dates at UTC midnight; round to the nearest day. */
function dateToDay(v: Date): Day {
  return new Date(Math.round(v.getTime() / MS_PER_DAY) * MS_PER_DAY).toISOString().slice(0, 10);
}

/** exceljs can hand back an Invalid Date for a malformed cell. */
function isValidDate(v: unknown): v is Date {
  return v instanceof Date && !Number.isNaN(v.getTime());
}

/** "06.09.2026" / "6/9/2026" / a Date → Day. */
function toDay(v: Cell | undefined): Day | null {
  if (v instanceof Date) return isValidDate(v) ? dateToDay(v) : null;
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(cellText(v));
  if (!m) return null;
  const day = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return isDay(day) ? day : null;
}

function headerKey(v: Cell | undefined): string {
  return canonicalName(cellText(v));
}

function discValue(v: Cell | undefined): boolean | null {
  const s = cellText(v);
  if (s === "יש") return true;
  if (s === "אין") return false;
  return null;
}

interface Layout {
  fields: Partial<Record<Field, number>>;
  dayCols: Array<{ col: number; day: Day }>;
}

/** Field columns and day columns from the header row; null when this is not a day tab. */
function layoutOf(headers: readonly Cell[]): Layout | null {
  const fields: Partial<Record<Field, number>> = {};
  const dayCols: Array<{ col: number; day: Day }> = [];
  let daysEnded = false;
  headers.forEach((h, col) => {
    if (h instanceof Date) {
      // a broken date header is skipped, not taken for the sentinel
      if (!daysEnded && isValidDate(h)) dayCols.push({ col, day: dateToDay(h) });
      return;
    }
    // the first non-date header after the first date is the sentinel ("אבוי למי שנוגע")
    if (dayCols.length && cellText(h)) daysEnded = true;
    const field = ALIAS_TO_FIELD.get(headerKey(h));
    if (field && fields[field] === undefined) fields[field] = col;
  });
  if (fields.personalNumber === undefined || !dayCols.length) return null;
  return { fields, dayCols };
}

function parseTab(grid: SheetGrid, layout: Layout, warnings: string[]): ParsedTab {
  const at = (row: readonly Cell[], field: Field) => {
    const col = layout.fields[field];
    return col === undefined ? undefined : row[col];
  };
  const rows: ParsedRow[] = [];
  for (let i = FIRST_DATA_ROW - 1; i < grid.rows.length; i++) {
    const row = grid.rows[i] ?? [];
    const sheetRow = i + 1;
    const days = new Map<Day, string>(layout.dayCols.map(({ col, day }) => [day, cellText(row[col])]));
    const firstName = cellText(at(row, "firstName"));
    const lastName = cellText(at(row, "lastName"));
    const personalNumber = normalizePersonalNumber(at(row, "personalNumber"));
    if (!personalNumber) {
      // formula-only rows below the roster are empty; a row with a name or a status is a real problem
      if (firstName || lastName || [...days.values()].some(Boolean)) {
        warnings.push(`${grid.name} שורה ${sheetRow}: אין מספר אישי תקין — השורה לא יובאה`);
      }
      continue;
    }
    rows.push({
      sheetRow,
      personalNumber,
      firstName,
      lastName,
      platoonText: cellText(at(row, "platoon")),
      roleTitle: cellText(at(row, "role")),
      dmhCategory: cellText(at(row, "dmh")),
      phone: cellText(at(row, "phone")),
      arrivalForecast: cellText(at(row, "arrival")),
      callUpOn: toDay(at(row, "callUp")),
      enlistmentStatus: cellText(at(row, "enlistment")),
      hasDisc: discValue(at(row, "disc")),
      notes: cellText(at(row, "notes")),
      days,
    });
  }
  return {
    tabName: grid.name,
    key: canonicalName(grid.name),
    hidden: grid.hidden,
    rows,
    firstDay: layout.dayCols[0]!.day,
    lastDay: layout.dayCols[layout.dayCols.length - 1]!.day,
  };
}

function parseDropdowns(grid: SheetGrid): Pick<ParsedSheet, "statusHints" | "roundStart" | "roundEnd"> {
  const headers = grid.rows[DROPDOWNS_HEADER_ROW - 1] ?? [];
  const hints = new Map<string, StatusGroup[]>();
  for (const [header, group] of STATUS_GROUP_HEADERS) {
    const wanted = [canonicalName(header), canonicalName(`${STATUS_GROUP_HEADER_PREFIX} ${header}`)];
    const col = headers.findIndex((h) => wanted.includes(headerKey(h)));
    if (col < 0) continue;
    for (let i = DROPDOWNS_HEADER_ROW; i < grid.rows.length; i++) {
      const value = cellText(grid.rows[i]?.[col]);
      if (!value) break;
      const groups = hints.get(value) ?? [];
      if (!groups.includes(group)) groups.push(group);
      hints.set(value, groups);
    }
  }
  const order = new Map(STATUS_GROUP_HEADERS.map(([, g], i) => [g, i]));
  const row1 = grid.rows[0] ?? [];
  const date = (v: Cell | undefined) => (isValidDate(v) ? dateToDay(v) : null);
  return {
    statusHints: [...hints].map(([value, groups]) => ({ value, groups: groups.sort((a, b) => order.get(a)! - order.get(b)!) })),
    roundStart: date(row1[ROUND_START_COL]),
    roundEnd: date(row1[ROUND_END_COL]),
  };
}

export function parseSheet(grids: readonly SheetGrid[]): ParsedSheet {
  const warnings: string[] = [];
  const tabs: ParsedTab[] = [];
  let dropdowns: Pick<ParsedSheet, "statusHints" | "roundStart" | "roundEnd"> = { statusHints: [], roundStart: null, roundEnd: null };
  for (const grid of grids) {
    if (grid.name.trim().toLowerCase() === DROPDOWNS_TAB) {
      dropdowns = parseDropdowns(grid);
      continue;
    }
    const layout = layoutOf(grid.rows[HEADER_ROW - 1] ?? []);
    if (layout) tabs.push(parseTab(grid, layout, warnings));
  }
  return { tabs, ...dropdowns, warnings };
}
