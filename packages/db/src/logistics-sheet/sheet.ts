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

/**
 * The sheet is kept in Israel, so its dates are Israel wall time — whatever zone the server runs
 * in (Vercel: UTC; a developer's laptop: Israel). Every date the import reads or shows goes
 * through this zone, so the same sheet gives the same rows everywhere.
 */
export const SHEET_TIME_ZONE = "Asia/Jerusalem";

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: SHEET_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Israel wall-clock fields of an instant (month 1–12). */
function wallParts(d: Date): [number, number, number, number, number, number] {
  const p = Object.fromEntries(wallClock.formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return [p.year!, p.month!, p.day!, p.hour!, p.minute!, p.second!];
}

/** The instant at which Israel's clock shows this time (month 1–12). */
export function sheetTime(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date {
  const wanted = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = wanted;
  // two rounds settle the zone offset, including on DST change days
  for (let i = 0; i < 2; i++) {
    const [wy, wmo, wd, wh, wmi, ws] = wallParts(new Date(t));
    t += wanted - Date.UTC(wy, wmo - 1, wd, wh, wmi, ws);
  }
  return new Date(t);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The Israel calendar day of an instant, "yyyy-MM-dd" — how אפסון rows are matched. */
export function sheetDay(d: Date): string {
  const [y, mo, day] = wallParts(d);
  return `${y}-${pad2(mo)}-${pad2(day)}`;
}

/** dd/MM/yyyy in Israel time, as the sheet shows dates. */
export function formatSheetDate(d: Date): string {
  const [y, mo, day] = wallParts(d);
  return `${pad2(day)}/${pad2(mo)}/${y}`;
}

/** Sheet display dates: dd/MM/yyyy [HH:mm[:ss]] (also . or - separators) or yyyy-MM-dd [HH:mm[:ss]]. Israel time. */
export function parseSheetDate(text: string): Date | undefined {
  const t = text.trim();
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  const parts = dmy ? [dmy[3], dmy[2], dmy[1], dmy[4], dmy[5], dmy[6]] : ymd ? ymd.slice(1, 7) : undefined;
  if (!parts) return undefined;
  const [y, mo, d, h, mi, s] = parts.map((p) => Number(p ?? 0)) as [number, number, number, number, number, number];
  const day = new Date(Date.UTC(y, mo - 1, d));
  const valid = day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d && h < 24 && mi < 60 && s < 60;
  return valid ? sheetTime(y, mo, d, h, mi, s) : undefined;
}
