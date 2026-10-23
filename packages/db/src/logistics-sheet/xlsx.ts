/**
 * The sheet as an .xlsx download (Google Sheets → קובץ → הורדה → Microsoft Excel).
 * Parsed in memory only; the caller drops the bytes afterwards.
 */
import readXlsxFile from "read-excel-file/node";
import { toSheetRows } from "./csv";
import { SHEET_KEYS, SHEET_NAMES, type SheetKey, type Sheets } from "./sheet";

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

/** Anything that isn't a readable xlsx workbook. The message never contains cell values. */
export class SheetFileError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Not a readable xlsx file", options);
    this.name = "SheetFileError";
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A cell as the sheet shows it. xlsx dates carry no zone and the library returns the wall time
 * as UTC, so dates are formatted from the UTC fields: dd/MM/yyyy [HH:mm] (parseSheetDate reads it).
 */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) {
    const date = `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
    const h = v.getUTCHours();
    const m = v.getUTCMinutes();
    return h || m ? `${date} ${pad(h)}:${pad(m)}` : date;
  }
  return String(v);
}

function keyOf(name: string): SheetKey | null {
  const n = name.normalize("NFC").trim();
  return SHEET_KEYS.find((k) => SHEET_NAMES[k] === n) ?? null;
}

export async function readXlsx(data: Uint8Array): Promise<XlsxBook> {
  let workbook: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    workbook = await readXlsxFile(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  } catch (e) {
    throw new SheetFileError({ cause: e });
  }
  const tabs: XlsxTab[] = [];
  const sheets: Sheets = {};
  for (const { sheet: name, data: rows } of workbook) {
    const key = keyOf(name);
    const sheetRows = toSheetRows(rows.map((r) => r.map(cellText)));
    tabs.push({ name, key, rows: sheetRows.length });
    if (key && !sheets[key]) sheets[key] = sheetRows;
  }
  return { tabs, sheets };
}
