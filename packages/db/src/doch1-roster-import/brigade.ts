/**
 * The brigade's list of who showed up on call-up day (יום גיוס), xlsx or csv (readRosterFile). The
 * header row is found by its "מספר אישי" cell and columns by header text; a status column is
 * optional — without one, every row showed up. Compared by compareBrigadeList() in @gdud/core.
 */
import { canonicalName, cellText, type BrigadeRow } from "@gdud/core";
import type { Cell, SheetGrid } from "../doch1-import/read";
import { RosterImportError } from "./parse";

type Field = "personalNumber" | "fullName" | "firstName" | "lastName" | "status";

const HEADER_ALIASES: Record<Field, string[]> = {
  personalNumber: ["מספר אישי", "מ״א", "מ.א", "מ.א."],
  fullName: ["שם מלא", "שם"],
  firstName: ["שם פרטי"],
  lastName: ["שם משפחה"],
  status: ["סטטוס", "סטטוס גיוס", "סטטוס התייצבות", "התייצבות", "התייצב"],
};
const ALIAS_TO_FIELD = new Map<string, Field>(
  Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) => aliases.map((a) => [canonicalName(a), field as Field] as const)),
);
const HEADER_SEARCH_ROWS = 10;

export interface BrigadeFile {
  rows: BrigadeRow[];
  /** the list has a status column */
  hasStatus: boolean;
  warnings: string[];
}

export function parseBrigadeList(grids: readonly SheetGrid[]): BrigadeFile {
  const candidates = [...grids].sort((a, b) => Number(a.hidden) - Number(b.hidden)).flatMap((grid) => {
    for (let i = 0; i < Math.min(HEADER_SEARCH_ROWS, grid.rows.length); i++) {
      const cols: Partial<Record<Field, number>> = {};
      (grid.rows[i] ?? []).forEach((h, col) => {
        const field = ALIAS_TO_FIELD.get(canonicalName(cellText(h)));
        if (field && cols[field] === undefined) cols[field] = col;
      });
      if (cols.personalNumber !== undefined) return [{ grid, index: i, cols }];
    }
    return [];
  });
  const found = candidates[0];
  if (!found) throw new RosterImportError("לא נמצאה בקובץ שורת כותרת עם ״מספר אישי״.");
  const warnings = candidates.length > 1 ? [`בקובץ כמה לשוניות עם רשימת חיילים; נקראה ״${found.grid.name}״.`] : [];

  const text = (row: readonly Cell[], f: Field) => (found.cols[f] === undefined ? "" : cellText(row[found.cols[f]!]));
  const rows: BrigadeRow[] = [];
  let noNumber = 0;
  for (let i = found.index + 1; i < found.grid.rows.length; i++) {
    const row = found.grid.rows[i] ?? [];
    const personalNumber = text(row, "personalNumber");
    const name = text(row, "fullName") || [text(row, "firstName"), text(row, "lastName")].filter(Boolean).join(" ");
    if (!personalNumber) {
      if (name) noNumber++;
      continue;
    }
    rows.push({ line: i + 1, personalNumber, name, status: text(row, "status") });
  }
  if (noNumber) warnings.push(`${noNumber} שורות בלי מספר אישי לא נבדקו.`);
  return { rows, hasStatus: found.cols.status !== undefined, warnings };
}
