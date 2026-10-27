/**
 * Client-safe pieces shared by the sheet imports (no database, no Node APIs): the line groups,
 * the preview line shape, the upload check and the tick bookkeeping. Exported on its own subpath,
 * `@gdud/db/sheet-import/preview`, so browser code can import values from it.
 */

/** How a preview groups a line: new in the sheet, will change, only in the app, couldn't read. */
export type LineGroup = "new" | "change" | "appOnly" | "error";
export const LINE_GROUPS: readonly LineGroup[] = ["new", "change", "appOnly", "error"];

/** A soldier the admin may pick for an ambiguous name (this import only). */
export interface PickChoice {
  id: string;
  label: string;
}

/** One line of a preview, as the browser gets it: no ids of app rows, no dependency graph. */
export interface PreviewLineBase<S extends string = string, K extends string = string> {
  id: string;
  sheet: S;
  /** sheet row; null for lines that exist only in the app */
  row: number | null;
  group: LineGroup;
  kind: K;
  item: string | null;
  serial: string | null;
  personName: string | null;
  before: string | null;
  after: string | null;
  /** error reason or note */
  message: string | null;
  selectable: boolean;
  defaultOn: boolean;
  /** an ambiguous soldier name: the candidates, the key the pick is sent under, and the current pick */
  pick?: { key: string; choices: PickChoice[]; chosen: string | null };
}

/** One tab as the upload step lists it. `key` null = not imported (`note` says why). */
export interface ImportTab<S extends string = string> {
  name: string;
  key: S | null;
  rows: number;
  note?: string;
}

/** What apply returns, whatever the module. */
export interface ApplyResultBase {
  applied: Record<LineGroup, number>;
  blocked: { id: string; reason: string }[];
  /** rows of the sheet's log written as events */
  logEvents: number;
}

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Shared by the import Server Actions and the import screen (which offers "הצג שוב" for it). */
export const STALE_PREVIEW = "האפליקציה השתנתה מאז התצוגה המקדימה — הציגו שוב";
export const BLOCKED_REASON = "תלוי בשורה שלא סומנה";

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
