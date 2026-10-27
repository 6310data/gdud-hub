/**
 * A Google Sheet downloaded as .xlsx (קובץ → הורדה → Microsoft Excel), read in memory. Shared by
 * the logistics and kesher imports; each maps the tabs it knows. The caller drops the bytes afterwards.
 * Cached values only: formulas are never evaluated.
 */
import readXlsxFile from "read-excel-file/node";

/** One tab: its name and every row (header rows included) as display text. */
export interface WorkbookTab {
  name: string;
  rows: string[][];
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
 * as UTC, so dates are formatted from the UTC fields: dd/MM/yyyy [HH:mm].
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

/** Every tab of the workbook, in order. Throws SheetFileError for anything that isn't xlsx. */
export async function readWorkbook(data: Uint8Array): Promise<WorkbookTab[]> {
  let workbook: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    workbook = await readXlsxFile(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  } catch (e) {
    throw new SheetFileError({ cause: e });
  }
  return workbook.map(({ sheet, data: rows }) => ({ name: sheet, rows: rows.map((r) => r.map(cellText)) }));
}
