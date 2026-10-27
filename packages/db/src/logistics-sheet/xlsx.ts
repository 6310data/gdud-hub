/**
 * The sheet as an .xlsx download (Google Sheets → קובץ → הורדה → Microsoft Excel), on top of the
 * shared reader (../sheet-import/xlsx.ts). Parsed in memory only; the caller drops the bytes afterwards.
 */
import { readWorkbook } from "../sheet-import/xlsx";
import { toSheetRows } from "./csv";
import { SHEET_KEYS, SHEET_NAMES, type SheetKey, type Sheets } from "./sheet";

export { cellText, SheetFileError } from "../sheet-import/xlsx";

/** One tab of the workbook. `rows` = data rows (header excluded, blank rows dropped). */
export interface XlsxTab {
  name: string;
  key: SheetKey | null;
  rows: number;
}
/** `sheets` holds only the recognised tabs. */
export interface XlsxBook {
  tabs: XlsxTab[];
  sheets: Sheets;
}

function keyOf(name: string): SheetKey | null {
  const n = name.normalize("NFC").trim();
  return SHEET_KEYS.find((k) => SHEET_NAMES[k] === n) ?? null;
}

export async function readXlsx(data: Uint8Array): Promise<XlsxBook> {
  const tabs: XlsxTab[] = [];
  const sheets: Sheets = {};
  for (const { name, rows } of await readWorkbook(data)) {
    const key = keyOf(name);
    const sheetRows = toSheetRows(rows);
    tabs.push({ name, key, rows: sheetRows.length });
    if (key && !sheets[key]) sheets[key] = sheetRows;
  }
  return { tabs, sheets };
}
