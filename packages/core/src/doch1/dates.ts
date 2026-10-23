/**
 * דוח 1 days and the lock rule. A "day" is an Israel calendar date as `YYYY-MM-DD`;
 * "today" and "now" are always Asia/Jerusalem, whatever zone the server runs in.
 * Day arithmetic works on UTC dates so it never depends on the server's zone.
 */

export const DOCH1_TZ = "Asia/Jerusalem";

/** `YYYY-MM-DD` */
export type Day = string;

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: DOCH1_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const clockFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: DOCH1_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/** The Israel calendar date of `now`. */
export function israelToday(now: Date): Day {
  const p = dayFormat.formatToParts(now);
  return `${part(p, "year")}-${part(p, "month")}-${part(p, "day")}`;
}

/** The Israel wall-clock time of `now`, `HH:MM` (24h). */
export function israelClock(now: Date): string {
  const p = clockFormat.formatToParts(now);
  return `${part(p, "hour")}:${part(p, "minute")}`;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in exact `YYYY-MM-DD` form. */
export function isDay(v: unknown): v is Day {
  if (typeof v !== "string") return false;
  const m = DAY_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v;
}

function toUtc(day: Day): Date {
  const m = DAY_RE.exec(day);
  if (!m) throw new Error(`invalid day: ${day}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function addDays(day: Day, n: number): Day {
  const d = toUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, inclusive; `[]` when `to < from`. */
export function dayRange(from: Day, to: Day): Day[] {
  const out: Day[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * May this user write `day` now? Admin: always. Future days: always. Today: until the
 * lock time (Israel clock). Past days: never. Same rule as app.doch1_day_open() in
 * packages/db/migrations/0005_doch1_security.sql — keep them in sync.
 */
export function isDayWritable(a: { day: Day; now: Date; lockAt: string; isAdmin: boolean }): boolean {
  if (a.isAdmin) return true;
  const today = israelToday(a.now);
  if (a.day > today) return true;
  if (a.day < today) return false;
  return israelClock(a.now) < a.lockAt.slice(0, 5);
}

const WEEKDAY_LETTERS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

/** "יום ב׳ 19.10" */
export function hebrewDayLabel(day: Day): string {
  const d = toUtc(day);
  return `יום ${WEEKDAY_LETTERS[d.getUTCDay()]} ${day.slice(8, 10)}.${day.slice(5, 7)}`;
}
