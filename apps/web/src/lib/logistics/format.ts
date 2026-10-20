/** Dates in Israel time, Hebrew style. Safe on server and client (no locale surprises). */
const TZ = "Asia/Jerusalem";

const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const time = (d: Date) => d.toLocaleTimeString("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** 04.10.2026 */
export function fmtDate(v: Date | string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  return d.toLocaleDateString("he-IL", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, ".");
}

/** 04.10.2026 · 10:42 */
export function fmtDateTime(v: Date | string | null | undefined): string {
  if (!v) return "";
  return `${fmtDate(v)} · ${time(new Date(v))}`;
}

/** "היום 10:42" / "אתמול 18:20" / "28.09 18:05" */
export function fmtWhen(v: Date | string | null | undefined, now: Date = new Date()): string {
  if (!v) return "";
  const d = new Date(v);
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey(d) === dayKey(now)) return `היום ${time(d)}`;
  if (dayKey(d) === dayKey(yesterday)) return `אתמול ${time(d)}`;
  const dm = d.toLocaleDateString("he-IL", { timeZone: TZ, day: "2-digit", month: "2-digit" }).replace(/\//g, ".");
  return `${dm} ${time(d)}`;
}

export const fmtCount = (n: number): string => n.toLocaleString("he-IL");
