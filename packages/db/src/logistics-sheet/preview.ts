/**
 * Client-safe pieces of the logistics sheet import (no database, no Node APIs): user-facing
 * messages, plus the shared upload check and tick bookkeeping (../sheet-import/preview.ts).
 * Exported on its own subpath, `@gdud/db/logistics-sheet/preview`, so browser code can import values from it.
 */
export { carryTicks, checkUploadFile, MAX_FILE_BYTES, XLSX_TYPE } from "../sheet-import/preview";

export const MSG = {
  noSoldier: "החייל לא קיים באפליקציה — יש להוסיף אותו בדוח 1",
  itemDiffers: "סוג הפריט שונה מהאפליקציה — לתיקון ידני",
  inUse: "בשימוש – לא ניתן למחוק",
  inSheet: "מופיע בגיליון (גדודי / אפסון) – לא ניתן למחוק",
  itemNotInDropdowns: "פריט לא היה ב-Dropdowns",
  serialNotInTable: "צ׳ לא היה בטבלת צ",
} as const;
