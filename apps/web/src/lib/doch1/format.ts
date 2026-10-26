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
