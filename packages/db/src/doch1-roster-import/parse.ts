/**
 * Parse the battalion's soldier list (the אלפון layout: references/doch1/sheet-structure.md,
 * "אלפון"). The header row is found by its "מספר אישי" cell and columns by header text, so a
 * title row above it or another column order still work. Header names live here only.
 */
import { canonicalName, cellText, type Day, type RosterRow } from "@gdud/core";
import { toDay } from "../doch1-import/parse";
import type { Cell, SheetGrid } from "../doch1-import/read";

export interface RosterFileRow extends RosterRow {
  /** צפי הגעה as written ("" = none) */
  arrival: string;
  /** תאריך גיוס from the file, if it has the column */
  callUpOn: Day | null;
}

export interface RosterFile {
  rows: RosterFileRow[];
  warnings: string[];
}

/** A problem with the file itself (message in Hebrew, safe to show as is). */
export class RosterImportError extends Error {}

type Field = "fullName" | "personalNumber" | "firstName" | "lastName" | "company" | "platoon" | "phone" | "role" | "arrival" | "callUp";

const HEADER_ALIASES: Record<Field, string[]> = {
  fullName: ["שם מלא"],
  personalNumber: ["מספר אישי"],
  firstName: ["שם פרטי"],
  lastName: ["שם משפחה"],
  company: ["פלוגה"],
  platoon: ["מחלקה", "מסגרת"],
  phone: ["מספר טלפון", "טלפון"],
  role: ["תפקיד בפועל"],
  arrival: ["צפי הגעה", "סטטוס הגעה על פי צפי גיוס"],
  callUp: ["תאריך גיוס", "תאריך גיוס על פי צפי גיוס"],
};
const ALIAS_TO_FIELD = new Map<string, Field>(
  Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) => aliases.map((a) => [canonicalName(a), field as Field] as const)),
);
/** The header row is looked for in the first rows of a sheet. */
const HEADER_SEARCH_ROWS = 10;

function headerOf(grid: SheetGrid): { index: number; cols: Partial<Record<Field, number>> } | null {
  for (let i = 0; i < Math.min(HEADER_SEARCH_ROWS, grid.rows.length); i++) {
    const cols: Partial<Record<Field, number>> = {};
    (grid.rows[i] ?? []).forEach((h, col) => {
      const field = ALIAS_TO_FIELD.get(canonicalName(cellText(h)));
      if (field && cols[field] === undefined) cols[field] = col;
    });
    if (cols.personalNumber !== undefined) return { index: i, cols };
  }
  return null;
}

export function parseRoster(grids: readonly SheetGrid[]): RosterFile {
  const warnings: string[] = [];
  const candidates = [...grids].sort((a, b) => Number(a.hidden) - Number(b.hidden)).flatMap((g) => {
    const h = headerOf(g);
    return h ? [{ grid: g, ...h }] : [];
  });
  const found = candidates[0];
  if (!found) throw new RosterImportError("לא נמצאה בקובץ שורת כותרת עם ״מספר אישי״.");
  if (found.cols.company === undefined) throw new RosterImportError("לא נמצאה בקובץ עמודת ״פלוגה״.");
  if (candidates.length > 1) warnings.push(`בקובץ כמה לשוניות עם רשימת חיילים; נקראה ״${found.grid.name}״.`);

  const at = (row: readonly Cell[], f: Field): Cell | undefined => (found.cols[f] === undefined ? undefined : row[found.cols[f]!]);
  const text = (row: readonly Cell[], f: Field) => cellText(at(row, f));
  const rows: RosterFileRow[] = [];
  for (let i = found.index + 1; i < found.grid.rows.length; i++) {
    const row = found.grid.rows[i] ?? [];
    const firstName = text(row, "firstName");
    const lastName = text(row, "lastName");
    const personalNumber = text(row, "personalNumber");
    const fullName = text(row, "fullName") || [firstName, lastName].filter(Boolean).join(" ");
    if (!personalNumber && !fullName) continue; // an empty row
    rows.push({
      line: i + 1,
      personalNumber,
      fullName,
      company: text(row, "company"),
      platoon: text(row, "platoon"),
      phone: text(row, "phone") || null,
      role: text(row, "role") || null,
      arrival: text(row, "arrival"),
      callUpOn: toDay(at(row, "callUp") ?? null),
    });
  }
  return { rows, warnings };
}
