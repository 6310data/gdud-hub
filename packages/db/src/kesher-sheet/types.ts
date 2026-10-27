import type { KesherEventKind, KesherLocation } from "@gdud/core";
import type { ApplyResultBase, LineGroup, PreviewLineBase } from "../sheet-import/preview";
import type { KesherSheetKey } from "./sheet";

/** Who signed for a צ׳ that lands on a company (null person = name not matched / blank). */
export interface SignerRef {
  personId: string | null;
  role: string | null;
}

/** One write. Items and serials that are new in the same import are referenced by name / number. */
export type ChangeOp =
  | { t: "item.add"; name: string; kind: "serial" | "bulk"; category: string | null; brigadeQty: number | null }
  | { t: "item.brigade"; itemId: string; brigadeQty: number | null }
  | {
      t: "serial.add";
      serial: string;
      itemName: string;
      location: KesherLocation;
      unitId: string | null;
      vehicle: string | null;
      notes: string | null;
      signer: SignerRef | null;
    }
  | {
      t: "serial.update";
      serialId: string;
      location: KesherLocation;
      unitId: string | null;
      vehicle: string | null;
      notes: string | null;
      /** set when the צ׳ lands on another company (its old holder row is dropped by trigger) */
      signer: SignerRef | null;
    }
  | { t: "serial.delete"; serialId: string }
  | { t: "signer.set"; serial: string; personId: string | null; role: string | null }
  | { t: "holder.set"; serial: string; personId: string | null; role: string | null; frame: string | null }
  /** only the cells that change; unitId null = the warehouse */
  | { t: "stock.set"; itemName: string; cells: { unitId: string | null; qty: number }[] }
  | { t: "kit.add"; parentName: string; childName: string; qty: number; sortOrder: number }
  | { t: "kit.qty"; kitId: string; qty: number }
  | { t: "kit.remove"; kitId: string }
  /** every 'יומן חתימות' row the app doesn't have yet, as one line */
  | { t: "log.add"; events: LogEventRow[] }
  /** reports ('דוחות צ׳') and check lines ('בדיקות צ׳') the app doesn't have yet */
  | { t: "checks.add"; checks: CheckRow[]; lines: CheckLineRow[] };
export type OpKind = ChangeOp["t"];
/** Lines that only inform (a warning, an app-only row the import won't touch). */
export type LineKind = OpKind | "error" | "info";

/** One old log row as a kesher_events row (`at` is an ISO string). */
export interface LogEventRow {
  at: string;
  kind: KesherEventKind;
  backdated: boolean;
  unitId: string | null;
  company: string | null;
  personId: string | null;
  personName: string | null;
  personRole: string | null;
  item: string | null;
  serial: string | null;
  qty: number | null;
  details: string | null;
  sheetActor: string | null;
  sheetKey: string;
}

/** A report from 'דוחות צ׳', or a synthetic one for 'בדיקות צ׳' rows without a report. */
export interface CheckRow {
  sheetKey: string;
  unitId: string;
  at: string;
  reporterName: string | null;
  total: number;
  found: number;
  note: string | null;
}
export interface CheckLineRow {
  /** the report it belongs to (new in this import or already in the app) */
  checkKey: string;
  serial: string;
  item: string | null;
  found: boolean;
}

export interface ChangeLine extends PreviewLineBase<KesherSheetKey, LineKind> {
  /** ids of lines that must be applied first */
  dependsOn: string[];
  /** null for errors and information lines */
  op: ChangeOp | null;
}

export interface SheetDiff {
  lines: ChangeLine[];
  /** rows per tab that matched the app with no difference (not listed) */
  identical: Partial<Record<KesherSheetKey, number>>;
  fingerprint: string;
}

/** What the browser gets: no ids of app rows, no dependency graph. */
export type PreviewLine = Omit<ChangeLine, "op" | "dependsOn">;

export function toPreview(line: ChangeLine): PreviewLine {
  const { op: _op, dependsOn: _deps, ...rest } = line;
  return rest;
}

export type ApplyResult = ApplyResultBase;
export type { LineGroup };
