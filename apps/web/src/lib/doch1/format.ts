import type { StatusFlags } from "@gdud/core";

/** Settings labels for the counting flags (what each flag means, not status names). */
export const FLAG_LABEL: Record<keyof StatusFlags, string> = {
  countsInSadak: "נספר בסד״כ",
  countsAsPresent: "יום נוכחות",
  homeDay: "יום בית",
  orgDay: "יום התארגנות",
  generalDay: "נספר בימ״מ",
  offDuty: "לא בשמ״פ",
  acrossBorder: "מעבר לגבול",
  needsOutpost: "דורש מוצב",
};

/** What each value of צפי הגעה / סטטוס גיוס does (settings labels; the values themselves are data). */
export const FIELD_EFFECTS = {
  arrival: [
    { effect: "arriving", label: "מגיע", hint: "רשום בסבב כרגיל" },
    { effect: "not_arriving", label: "לא מגיע", hint: "לא מופיע באף יום של הסבב" },
  ],
  enlistment: [
    { effect: "arrived", label: "התייצב", hint: "נספר באחוז ההתייצבות" },
    { effect: "pending", label: "ממתין", hint: "צפוי ועוד לא הגיע" },
    { effect: "postponed", label: "נדחה", hint: "מבקש תאריך גיוס חדש" },
    { effect: "released", label: "שוחרר", hint: "מבקש תאריך שחרור" },
  ],
} as const;

/** Values offered when a list is still empty (one tap each). */
export const FIELD_SUGGESTIONS = {
  arrival: [
    { name: "מגיע", effect: "arriving" },
    { name: "מגיע חלקית", effect: "arriving" },
    { name: "לא מגיע", effect: "not_arriving" },
  ],
  enlistment: [
    { name: "התייצב", effect: "arrived" },
    { name: "טרם התייצב", effect: "pending" },
    { name: "בדרך", effect: "pending" },
    { name: "פוטנציאל נפקד", effect: "pending" },
    { name: "תאריך גיוס נדחה", effect: "postponed" },
    { name: "שוחרר", effect: "released" },
  ],
} as const;

export const ROUND_STATE_LABEL = { planning: "בתכנון", active: "פעיל", closed: "סגור" } as const;
export const ROUND_STATE_CHIP = { planning: "tz-chip-brigade", active: "tz-chip-ok", closed: "tz-chip-signed" } as const;

/** Chip color of a value by what it does. */
export const EFFECT_CHIP = {
  arriving: "tz-chip-ok",
  not_arriving: "tz-chip-broken",
  arrived: "tz-chip-ok",
  pending: "tz-chip-brigade",
  postponed: "tz-chip-signed",
  released: "tz-chip-signed",
} as const;

/** "19.10.2026" */
export function fmtDay(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;
}

/** `path?…params&day=…`; null (today) drops `day`, so a bookmarked link stays "today". */
export function dayHref(path: string, params: Record<string, string | null | undefined>, day: string | null): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  if (day) q.set("day", day);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
