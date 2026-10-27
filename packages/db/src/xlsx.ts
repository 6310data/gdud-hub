/**
 * Write simple tables to an .xlsx (right-to-left sheets, bold heads and totals). Used for report
 * exports (דוח 1 › דוחות). Values only — no formulas, so nothing in a cell is ever evaluated.
 */
import ExcelJS from "exceljs";

export type XlsxValue = string | number | null;

/** One table on a sheet: an optional title row, the head, the rows and an optional total row. */
export interface XlsxTable {
  title?: string;
  head: string[];
  rows: XlsxValue[][];
  foot?: XlsxValue[];
}

export interface XlsxSheet {
  /** up to 31 characters, no []:*?/\ (Excel's rules) */
  name: string;
  tables: XlsxTable[];
}

const SHEET_NAME_BAD = /[[\]:*?/\\]/g;
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8ECF1" } };

/** A cell a spreadsheet won't read as a formula (=, +, -, @ at the start). */
const safeText = (v: XlsxValue): XlsxValue => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v);

export async function writeWorkbook(sheets: readonly XlsxSheet[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  for (const s of sheets) {
    const base = s.name.replace(SHEET_NAME_BAD, " ").slice(0, 31) || "גיליון";
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base.slice(0, 28)} ${i}`;
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true }] });
    const widths: number[] = [];
    const track = (values: readonly XlsxValue[]) =>
      values.forEach((v, i) => (widths[i] = Math.max(widths[i] ?? 6, Math.min(40, String(v ?? "").length + 2))));
    s.tables.forEach((t, ti) => {
      if (ti > 0) ws.addRow([]);
      if (t.title) ws.addRow([t.title]).font = { bold: true, size: 13 };
      const head = ws.addRow(t.head);
      head.font = { bold: true };
      head.eachCell((c) => (c.fill = HEAD_FILL));
      track(t.head);
      for (const r of t.rows) {
        ws.addRow(r.map(safeText));
        track(r);
      }
      if (t.foot) {
        ws.addRow(t.foot.map(safeText)).font = { bold: true };
        track(t.foot);
      }
    });
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
