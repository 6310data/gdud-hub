/**
 * Read an .xlsx export into plain grids (values only). Formulas are never evaluated:
 * a formula cell gives its cached result, as the export holds it.
 */
import ExcelJS from "exceljs";

export type Cell = string | number | boolean | Date | null;

/** One worksheet; rows[0] = sheet row 1, cells[0] = column A. */
export interface SheetGrid {
  name: string;
  hidden: boolean;
  rows: Cell[][];
}

const EXCEL_EPOCH_OFFSET_DAYS = 25569; // 1970-01-01 as an Excel (1900) serial
const MS_PER_DAY = 86_400_000;
const DATE_FORMAT_RE = /[dmy]/i;

/** A formula's cached date result can come back as a serial number; the cell's format tells. */
function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY));
}

function toCell(value: unknown, numFmt: string | undefined): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return numFmt && DATE_FORMAT_RE.test(numFmt) && !/^General$/i.test(numFmt) ? serialToDate(value) : value;
  if (typeof value === "object") {
    const v = value as { result?: unknown; richText?: Array<{ text: string }>; text?: unknown; error?: string; formula?: string; sharedFormula?: string };
    if ("formula" in v || "sharedFormula" in v || "result" in v) return toCell(v.result, numFmt);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if (typeof v.error === "string") return v.error;
    if (typeof v.text === "string") return v.text;
  }
  return null;
}

export async function readWorkbook(data: ArrayBuffer | Uint8Array): Promise<SheetGrid[]> {
  const wb = new ExcelJS.Workbook();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  await wb.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as never);
  return wb.worksheets.map((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: Cell[] = [];
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        cells[col - 1] = toCell(cell.value, cell.numFmt);
      });
      rows[rowNumber - 1] = Array.from(cells, (c) => c ?? null);
    });
    return { name: ws.name, hidden: ws.state !== "visible", rows: Array.from(rows, (r) => r ?? []) };
  });
}
