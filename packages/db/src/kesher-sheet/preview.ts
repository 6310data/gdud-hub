/**
 * Client-safe pieces of the kesher sheet import (no database, no Node APIs): user-facing messages
 * and the labels of the change kinds. Exported as `@gdud/db/kesher-sheet/preview`.
 */

export const MSG = {
  noSoldier: "החייל לא נמצא ברשימת דוח 1 של הפלוגה — יש להוסיף אותו בדוח 1 או לתקן את השם בגיליון",
  /** a close fit was linked: the line shows the candidates to change it */
  guessed: (name: string) => `בגיליון "${name}" — התאמה משוערת לרשימת דוח 1, בדקו את החייל`,
  unsure: (name: string, company: string) => `"${name}" לא נמצא בדיוק ב${company} — בחרו את החייל המתאים`,
  noCompany: (name: string) => `הפלוגה "${name}" לא קיימת — יש להוסיף אותה בניהול מערכת`,
  itemDiffers: "סוג המכשיר שונה מהאפליקציה — לתיקון ידני",
  sheetWins: "הגיליון הוא הרשומה: שינוי שנעשה רק באפליקציה (למשל חותם חדש) יופיע כאן כ״ישתנה״ בחזרה לערך שבגיליון. בטלו את הסימון כדי להשאיר את הערך שבאפליקציה.",
} as const;

/** Change kind → the chip in the preview (kinds not listed show their group). */
export const KIND_LABEL: Record<string, string> = {
  "item.add": "פריט חדש",
  "item.brigade": "מלאי כללי",
  "serial.update": "מיקום / פרטים",
  "serial.delete": "מחיקה",
  "signer.set": "חותם על הפלוגה",
  "holder.set": "שיוך בפלוגה",
  "stock.set": "כמויות",
  "kit.add": "תקן",
  "kit.qty": "תקן",
  "kit.remove": "הסרה מהתקן",
  "log.add": "היסטוריה",
  "checks.add": "דוחות צ׳",
  info: "לידיעה",
};
