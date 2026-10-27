/**
 * מחלקת קשר: constants, labels and pure helpers shared by the database schema, the sheet import
 * and the UI. No I/O here. Spec: docs/superpowers/specs/2026-10-27-kesher-design.md.
 */

/** Device types with a צ׳ (710, אולר …) are `serial`; ציוד משלים (batteries, antennas …) is `bulk`. */
export const KESHER_ITEM_KINDS = ["serial", "bulk"] as const;
export type KesherItemKind = (typeof KESHER_ITEM_KINDS)[number];

/** Where a צ׳ is: the battalion warehouse, a company, or nowhere (ללא שיוך). */
export const KESHER_LOCATIONS = ["warehouse", "company", "none"] as const;
export type KesherLocation = (typeof KESHER_LOCATIONS)[number];

export const KESHER_LOCATION_LABEL: Record<KesherLocation, string> = {
  warehouse: "במחסן",
  company: "בפלוגה",
  none: "ללא שיוך",
};

export const KESHER_EVENT_KINDS = [
  "sign",
  "credit",
  "intake",
  "assign",
  "stock_edit",
  "serial_edit",
  "kit_edit",
  "check",
  "import",
  /** a row of the old sheet's יומן whose action text isn't recognised */
  "legacy",
] as const;
export type KesherEventKind = (typeof KESHER_EVENT_KINDS)[number];

export const KESHER_EVENT_LABEL: Record<KesherEventKind, string> = {
  sign: "החתמה",
  credit: "זיכוי",
  intake: "קליטה ראשונית",
  assign: "שיוך בפלוגה",
  stock_edit: "עדכון מלאי",
  serial_edit: "תיקון צ׳",
  kit_edit: "עדכון תקן",
  check: "דוח צ׳",
  import: "ייבוא מהגיליון",
  legacy: "פעולה מהגיליון",
};

/** The warehouse's name in the sheet (פיזור צ כללי column E, כללי headers). */
export const KESHER_WAREHOUSE = "במחסן";

/* ── תקן ציוד משלים ───────────────────────────────────────────────────────── */

export interface KesherKitLine {
  item: string;
  qty: number;
}

/** How deep a תקן cascades (a kit item with a kit of its own, e.g. מגבר). */
export const KIT_DEPTH = 4;

/**
 * The ציוד משלים that goes with `counts` (parent item → how many), following the תקן in cascade:
 * a kit line whose item has its own תקן adds that too, up to KIT_DEPTH levels (so a cycle stops).
 */
export function expandKit(
  counts: ReadonlyMap<string, number>,
  kits: ReadonlyMap<string, readonly KesherKitLine[]>,
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (item: string, qty: number, depth: number) => {
    out.set(item, (out.get(item) ?? 0) + qty);
    if (depth < KIT_DEPTH) for (const k of kits.get(item) ?? []) add(k.item, qty * k.qty, depth + 1);
  };
  for (const [parent, n] of counts) for (const k of kits.get(parent) ?? []) add(k.item, n * k.qty, 1);
  return out;
}

/* ── דוח צ׳ status ───────────────────────────────────────────────────────── */

export type CheckStatusKind = "none" | "missing" | "stale" | "ok";
export interface CheckStatus {
  kind: CheckStatusKind;
  /** צ׳ not found in the last report */
  missing: number;
  /** whole days since the last report */
  days: number;
}

const DAY_MS = 86_400_000;

/** The overview chip: לא הוגש / N לא נמצאו / ישן · N ימים / תקין. Missing wins over stale. */
export function checkStatus(
  last: { at: Date; total: number; found: number } | null,
  now: Date,
  staleDays: number,
): CheckStatus {
  if (!last) return { kind: "none", missing: 0, days: 0 };
  const days = Math.max(0, Math.floor((now.getTime() - last.at.getTime()) / DAY_MS));
  const missing = Math.max(0, last.total - last.found);
  if (missing) return { kind: "missing", missing, days };
  if (days > staleDays) return { kind: "stale", missing, days };
  return { kind: "ok", missing, days };
}

/* ── the old sheet's יומן חתימות ──────────────────────────────────────────── */

/**
 * The old app's action text → event kind. It wrote "אתר — החתמה", "אתר — זיכוי (מלאי חלקי)",
 * "אתר — שיוך בפלוגה", "אתר — קליטה ראשונית", with " · תאריך dd/MM/yyyy" when backdated
 * (Code.js.txt: _logRowsAt). Rows typed before the site have the bare words.
 */
export function kesherLogKind(action: string): { kind: KesherEventKind; backdated: boolean } {
  const t = action.replace(/\s+/g, " ").trim();
  const backdated = /·\s*תאריך/.test(t);
  const kind: KesherEventKind = t.includes("קליטה")
    ? "intake"
    : t.includes("שיוך")
      ? "assign"
      : t.includes("זיכוי")
        ? "credit"
        : t.includes("החתמה")
          ? "sign"
          : "legacy";
  return { kind, backdated };
}
