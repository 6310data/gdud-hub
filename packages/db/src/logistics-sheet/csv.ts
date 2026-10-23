import type { SheetRow } from "./sheet";

/** RFC 4180 CSV (what Google Sheets exports): quoted cells, "" escapes, CRLF/LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c !== '"') cell += c;
      else if (src[i + 1] === '"') cell += src[++i];
      else quoted = false;
    } else if (c === '"' && cell === "") quoted = true; // a quote inside a cell (פלנ"ט) is literal
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

/** All rows of one tab (CSV or xlsx) → its data rows (header dropped, blank rows dropped, row numbers kept). */
export function toSheetRows(rows: string[][]): SheetRow[] {
  return rows
    .slice(1)
    .map((cells, i) => ({ row: i + 2, cells }))
    .filter((r) => r.cells.some((c) => c.trim()));
}
