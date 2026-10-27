/**
 * Read the battalion's soldier list: an .xlsx export (readWorkbook, values only) or a .csv
 * (UTF-8, as Google Sheets and Excel save it). Parsed in memory; the file is never stored.
 */
import { readWorkbook, type Cell, type SheetGrid } from "../doch1-import/read";

/** RFC 4180 rows: quoted fields may hold commas, newlines and doubled quotes. */
export function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => (c === "" ? null : c)));
}

export async function readRosterFile(data: ArrayBuffer | Uint8Array, fileName: string): Promise<SheetGrid[]> {
  if (/\.csv$/i.test(fileName)) {
    const text = new TextDecoder("utf-8").decode(data).replace(/^﻿/, "");
    return [{ name: fileName, hidden: false, rows: parseCsv(text) }];
  }
  return readWorkbook(data);
}
