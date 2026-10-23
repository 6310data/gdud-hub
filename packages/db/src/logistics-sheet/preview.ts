/**
 * Client-safe pieces of the sheet import (no database, no Node APIs): user-facing messages,
 * the upload check and the tick bookkeeping of the preview. Exported on its own subpath,
 * `@gdud/db/logistics-sheet/preview`, so browser code can import values from it.
 */

export const MSG = {
  noSoldier: "החייל לא קיים באפליקציה — יש להוסיף אותו בדוח 1",
  itemDiffers: "סוג הפריט שונה מהאפליקציה — לתיקון ידני",
  inUse: "בשימוש – לא ניתן למחוק",
  inSheet: "מופיע בגיליון (גדודי / אפסון) – לא ניתן למחוק",
  itemNotInDropdowns: "פריט לא היה ב-Dropdowns",
  serialNotInTable: "צ׳ לא היה בטבלת צ",
} as const;

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Type and size of an upload, checked before it is sent (browser) and before it is parsed (server). */
export function checkUploadFile(f: { name: string; type: string; size: number }): string | null {
  if (f.size === 0) return "בחרו קובץ";
  if (!/\.xlsx$/i.test(f.name) || (f.type !== "" && f.type !== XLSX_TYPE)) return "יש להעלות קובץ Excel ‏(.xlsx)";
  if (f.size > MAX_FILE_BYTES) return "הקובץ גדול מדי (עד 4MB)";
  return null;
}

/**
 * The ticks for a new preview: a line the previous preview also had keeps the admin's choice
 * (so "הצג שוב" never re-ticks a line they rejected); a line that is new gets its default.
 */
export function carryTicks(
  prev: { lines: readonly { id: string }[]; selected: ReadonlySet<string> } | null,
  next: readonly { id: string; selectable: boolean; defaultOn: boolean }[],
): Set<string> {
  const seen = new Set(prev?.lines.map((l) => l.id) ?? []);
  return new Set(next.filter((l) => l.selectable && (seen.has(l.id) ? prev!.selected.has(l.id) : l.defaultOn)).map((l) => l.id));
}
