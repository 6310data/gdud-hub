import type { Condition, EventKind, KitLine } from "@gdud/core";
import type { SheetKey } from "./sheet";

/** How a preview groups a line: new in the sheet, will change, only in the app, couldn't read. */
export type LineGroup = "new" | "change" | "appOnly" | "error";
export const LINE_GROUPS: readonly LineGroup[] = ["new", "change", "appOnly", "error"];

/** One write. Items and serials that are new in the same import are referenced by name / serial. */
export type ChangeOp =
  | { t: "item.add"; name: string; category: string | null; subcategory: string | null; sku: string | null }
  | { t: "item.update"; itemId: string; category: string | null; subcategory: string | null; sku: string | null }
  | { t: "serial.add"; serial: string; itemName: string; category: string | null; condition: Condition }
  | { t: "serial.condition"; serialId: string; condition: Condition }
  | { t: "serial.delete"; serialId: string }
  | { t: "kit.add"; itemName: string; name: string; qty: number; sortOrder: number }
  | { t: "kit.remove"; kitItemId: string }
  | { t: "assignment.add"; serial: string; personId: string; notes: string | null; kit: KitLine[] }
  | { t: "assignment.transfer"; assignmentId: string; serial: string; personId: string; notes: string | null; kit: KitLine[] }
  | { t: "assignment.kit"; assignmentId: string; kit: KitLine[] }
  | { t: "assignment.return"; assignmentId: string }
  /** dates are ISO strings */
  | { t: "storage.add"; personId: string; serial: string | null; itemName: string; storedAt: string; releasedAt: string | null }
  | { t: "storage.release"; storageId: string; releasedAt: string }
  /** every 'לוג' row the app doesn't have yet, as one line */
  | { t: "log.add"; events: LogEventRow[] };
export type OpKind = ChangeOp["t"];

/** One old 'לוג' row as a logistics_events row (`at` is an ISO string). */
export interface LogEventRow {
  at: string;
  kind: EventKind;
  sheetActor: string | null;
  personId: string | null;
  personName: string | null;
  item: string | null;
  serial: string | null;
  details: string | null;
  sheetLink: string | null;
  sheetKey: string;
}
export type LineKind = OpKind | "error";

export interface ChangeLine {
  /** `${sheet}:${kind}:${key}` — key = normalised צ׳ / item name / item|kit name / storage key; errors use the row */
  id: string;
  sheet: SheetKey;
  /** sheet row; null for lines that exist only in the app */
  row: number | null;
  group: LineGroup;
  kind: LineKind;
  item: string | null;
  serial: string | null;
  personName: string | null;
  /** Hebrew display text, e.g. "תקין" → "תקול" */
  before: string | null;
  after: string | null;
  /** error reason or note */
  message: string | null;
  selectable: boolean;
  defaultOn: boolean;
  /** ids of lines that must be applied first */
  dependsOn: string[];
  /** null for errors and for app-only lines that can't be removed */
  op: ChangeOp | null;
}

export interface SheetDiff {
  lines: ChangeLine[];
  /** rows per tab that matched the app with no difference (not listed) */
  identical: Partial<Record<SheetKey, number>>;
  fingerprint: string;
}

/** What the browser gets: no ids of app rows, no dependency graph. */
export type PreviewLine = Omit<ChangeLine, "op" | "dependsOn">;

export function toPreview(line: ChangeLine): PreviewLine {
  const { op: _op, dependsOn: _deps, ...rest } = line;
  return rest;
}
