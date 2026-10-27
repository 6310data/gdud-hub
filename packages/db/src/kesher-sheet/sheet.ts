/**
 * The Google Sheet "פיזור ושליטה מחלקת קשר": which tab is what, where its header is, and the
 * cell helpers the diff uses. The layout, column by column, is in the spec's "Import" section
 * (docs/superpowers/specs/2026-10-27-kesher-design.md).
 */
import { searchKey } from "@gdud/core";
import type { ImportTab } from "../sheet-import/preview";
import { readWorkbook, type WorkbookTab } from "../sheet-import/xlsx";

/** Tabs with a fixed name. Company tabs (one per company, named as the company) are found by layout. */
export const KESHER_TABS = {
  pizur: "פיזור צ כללי",
  general: "כללי",
  kit: "תקן ציוד משלים",
  log: "יומן חתימות",
  reports: "דוחות צ׳",
  checks: "בדיקות צ׳",
} as const;
type FixedKey = keyof typeof KESHER_TABS;

export const KESHER_SHEET_KEYS = ["pizur", "companies", "general", "kit", "log", "reports", "checks"] as const;
export type KesherSheetKey = (typeof KESHER_SHEET_KEYS)[number];

/** How the preview names the company tabs together (they are chosen and shown as one). */
export const COMPANY_TABS_NAME = "גיליונות הפלוגות";

/** Header rows above the data. */
const HEADER_ROWS: Record<FixedKey | "companies", number> = {
  pizur: 1,
  companies: 2,
  general: 2,
  kit: 2,
  log: 1,
  reports: 1,
  checks: 1,
};

/** Tabs that are read by nobody, with the reason shown on the upload step. */
const NOT_IMPORTED: Record<string, string> = {
  "הרשאות אתר": "לא מיובא — ההרשאות עוברות להרשאות של gdud-hub; קודי הגישה והאימיילים לא נשמרים",
  "טופס חתימה": "לא מיובא — טופס שהוא מסך באפליקציה",
  "Copy of טופס חתימה": "לא מיובא — טופס שהוא מסך באפליקציה",
  "טופס קליטה ראשונית": "לא מיובא — טופס שהוא מסך באפליקציה",
  "סינון יומנים": "לא מיובא — סינון שהוא מסך באפליקציה",
  "זיכויים כלליים": "לא מיובא",
  "__דוח_PDF_זמני": "לא מיובא — גיליון זמני",
};

/** A data row: its row number in the sheet and the raw cells. */
export interface SheetRow {
  row: number;
  cells: string[];
}

export interface KesherTab {
  name: string;
  /** the last header row's cells */
  header: string[];
  rows: SheetRow[];
}

export interface KesherSheets {
  pizur?: KesherTab;
  general?: KesherTab;
  kit?: KesherTab;
  log?: KesherTab;
  reports?: KesherTab;
  checks?: KesherTab;
  companies?: KesherTab[];
}

export interface KesherBook {
  tabs: ImportTab<KesherSheetKey>[];
  sheets: KesherSheets;
}

/** Spreadsheet error values (a broken formula) read as an empty cell. */
const ERROR_VALUE = /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!|ERROR!|SPILL!|CALC!)$/;

/** Trimmed cell (1-based column, A = 1); error values are empty. */
export function cell(r: SheetRow, col: number): string {
  const v = (r.cells[col - 1] ?? "").trim();
  return ERROR_VALUE.test(v) ? "" : v;
}

/** Same name, whatever the spaces. */
export const nameKey = (s: string): string => s.replace(/\s+/g, " ").trim();

function toTab(name: string, rows: string[][], headerRows: number): KesherTab {
  return {
    name,
    header: (rows[headerRows - 1] ?? []).map((c) => c.trim()),
    rows: rows
      .slice(headerRows)
      .map((cells, i) => ({ row: i + headerRows + 1, cells }))
      .filter((r) => r.cells.some((c) => c.trim() && !ERROR_VALUE.test(c.trim()))),
  };
}

const FIXED = new Map(Object.entries(KESHER_TABS).map(([k, name]) => [searchKey(name), k as FixedKey]));
const IGNORED = new Map(Object.entries(NOT_IMPORTED).map(([name, why]) => [searchKey(name), why]));

/** A company tab: its second row is a header with צ׳ in column F (Code.js.txt: CO.SER = 6). */
function isCompanyTab(rows: string[][]): boolean {
  return searchKey(rows[1]?.[5] ?? "") === "צ";
}

/** The workbook's tabs → the kesher tabs. Every tab is listed, recognised or not. */
export function bookFromTabs(workbook: readonly WorkbookTab[]): KesherBook {
  const tabs: ImportTab<KesherSheetKey>[] = [];
  const sheets: KesherSheets = {};
  const companies: KesherTab[] = [];
  for (const { name, rows } of workbook) {
    const k = searchKey(name.normalize("NFC"));
    const fixed = FIXED.get(k);
    if (fixed) {
      const tab = toTab(name, rows, HEADER_ROWS[fixed]);
      if (!sheets[fixed]) sheets[fixed] = tab;
      tabs.push({ name, key: fixed, rows: tab.rows.length });
    } else if (IGNORED.has(k)) {
      tabs.push({ name, key: null, rows: 0, note: IGNORED.get(k) });
    } else if (isCompanyTab(rows)) {
      companies.push(toTab(name, rows, HEADER_ROWS.companies));
    } else {
      tabs.push({ name, key: null, rows: 0 });
    }
  }
  if (companies.length) {
    sheets.companies = companies;
    // the company tabs are chosen together, listed after פיזור צ כללי
    const at = tabs.findIndex((t) => t.key === "pizur");
    tabs.splice(at + 1, 0, {
      name: COMPANY_TABS_NAME,
      key: "companies",
      rows: companies.reduce((n, t) => n + t.rows.length, 0),
      note: companies.map((t) => t.name).join(", "),
    });
  }
  return { tabs, sheets };
}

/** The uploaded workbook (throws SheetFileError when it isn't xlsx). */
export async function readKesherBook(data: Uint8Array): Promise<KesherBook> {
  return bookFromTabs(await readWorkbook(data));
}
