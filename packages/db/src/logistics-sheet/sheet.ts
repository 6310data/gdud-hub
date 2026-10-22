/**
 * The old logistics Google Sheet: tab names, the row shape every reader produces, and the
 * cell-level helpers the diff uses. Sheet layouts: the header of references/logistics/Code.gs.
 * Every tab has one header row.
 */
import type { Condition } from "@gdud/core";

export const SHEET_NAMES = {
  dropdowns: "Dropdowns",
  kit: "תקן ציוד משלים",
  serials: "טבלת צ",
  people: "אלפון גדודי",
  assignments: "גדודי",
  storage: "אפסון",
} as const;
export type SheetKey = keyof typeof SHEET_NAMES;
export const SHEET_KEYS = Object.keys(SHEET_NAMES) as SheetKey[];

/** A data row: its row number in the sheet (the header is row 1) and the raw cells. */
export interface SheetRow {
  row: number;
  cells: string[];
}
export type Sheets = Partial<Record<SheetKey, SheetRow[]>>;

/** Trimmed cell (1-based column, as in Code.gs); a failed VLOOKUP ("#N/A") counts as empty. */
export function cell(r: SheetRow, col: number): string {
  const v = (r.cells[col - 1] ?? "").trim();
  return v === "#N/A" ? "" : v;
}

export const nameKey = (s: string): string => s.replace(/\s+/g, " ").trim();

/** 'טבלת צ' status → condition. "חתום" is derived from 'גדודי' now, so it maps to the armory state. */
export function statusToCondition(status: string): Condition | undefined {
  const s = nameKey(status);
  if (s === "" || s === "חתום" || s.includes("תקין")) return "ok";
  if (s.includes("תקול")) return "broken";
  if (s.includes("חטיבה")) return "brigade";
  return undefined;
}

/** Sheet display dates: dd/MM/yyyy [HH:mm[:ss]] (also . or - separators) or yyyy-MM-dd [HH:mm[:ss]]. Local time. */
export function parseSheetDate(text: string): Date | undefined {
  const t = text.trim();
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  const parts = dmy ? [dmy[3], dmy[2], dmy[1], dmy[4], dmy[5], dmy[6]] : ymd ? ymd.slice(1, 7) : undefined;
  if (!parts) return undefined;
  const [y, mo, d, h, mi, s] = parts.map((p) => Number(p ?? 0)) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi, s);
  const valid =
    date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && h < 24 && mi < 60 && s < 60;
  return valid ? date : undefined;
}
