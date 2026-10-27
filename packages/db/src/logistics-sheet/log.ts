/**
 * The old sheet's 'לוג' tab: תאריך | תפקיד | פעולה | שם מלא | פריט | צ | הערות | קישור
 * (log_() in references/logistics/Code.gs). Its rows become logistics_events, so the history the
 * sheet kept stays readable in the app. Rows are only ever added, never changed or removed.
 */
import { createHash } from "node:crypto";
import type { EventKind } from "@gdud/core";
import { nameKey } from "./sheet";

export const LOG_COL = { at: 1, actor: 2, action: 3, name: 4, item: 5, serial: 6, notes: 7, link: 8 } as const;

/** The sheet's action text → the app's event kind. Anything else is kept as "legacy". */
const ACTION_KIND: Record<string, EventKind> = {
  "החתמה": "sign",
  "זיכוי": "return",
  "זיכוי (העברה)": "transfer",
  "טופס ציוד חתום": "holdings_form",
  "שינוי סטטוס": "condition",
  "עדכון הערה": "notes",
  "הוספת צ׳": "serials_add",
  "הוספת צ'": "serials_add",
  "מחיקת צ׳": "serial_remove",
  "מחיקת צ'": "serial_remove",
  "הוספת פריט": "item_add",
  "עדכון תקן": "kit",
  "חייל חדש": "person_add",
  "עדכון חייל": "person_update",
  "מחיקת חייל": "person_remove",
  "אפסון": "store",
  "הוצאה מאפסון": "release",
};

export function logKind(action: string): EventKind {
  return ACTION_KIND[nameKey(action)] ?? "legacy";
}

/** Soldier rows (חייל חדש / עדכון חייל) keep the personal number in the צ column. */
export const PERSON_KINDS: ReadonlySet<EventKind> = new Set(["person_add", "person_update", "person_remove"]);

/**
 * Identifies a row by its content, plus how many identical rows came before it (two rows can be
 * identical: same minute, same action). Row numbers aren't used: they move when rows are deleted.
 */
export function logRowKey(cells: readonly string[], occurrence: number): string {
  return createHash("sha256")
    .update(JSON.stringify([...cells, occurrence]))
    .digest("hex");
}

export const isHttpsLink = (v: string) => /^https:\/\/\S+$/.test(v);
