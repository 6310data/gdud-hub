/**
 * Normalizing values read from the round's Google Sheet export (see
 * references/doch1/sheet-structure.md, "What the importer must tolerate").
 */

/** Sheet error values and leftovers that mean "nothing here". */
const EMPTY_VALUES = new Set(["#N/A", "#REF!", "#VALUE!", "#DIV/0!", "#NAME?", "#NUM!", "#NULL!", "#ERROR!", "-"]);

/** Trimmed text of a cell; "" for empty cells, sheet errors and "-". Numeric 0 → "0". */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return EMPTY_VALUES.has(s) ? "" : s;
}

/** A key for matching names that are spelled differently: מפל״ג = מפל"ג = מפלג. */
export function canonicalName(s: string): string {
  return s
    .normalize("NFC")
    .replace(/״/g, '"')
    .replace(/׳/g, "'")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const PERSONAL_NUMBER_RE = /^\d{5,9}$/;

/** מספר אישי as a digit string (5–9 digits), from a number, "8123456.0" or " 8123456 "; else null. */
export function normalizePersonalNumber(v: unknown): string | null {
  let s: string;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) return null;
    s = String(v);
  } else if (typeof v === "string") {
    s = v.trim().replace(/\.0+$/, "");
  } else {
    return null;
  }
  return PERSONAL_NUMBER_RE.test(s) ? s : null;
}
