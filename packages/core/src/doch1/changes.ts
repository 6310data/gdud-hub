/**
 * The soldier card's change log (יומן שינויים): audit rows of one soldier — their days, their
 * round fields and their people row (app.doch1_person_log, migration 0013) — as Hebrew lines.
 */
import type { Day } from "./dates";

export interface AuditEntry {
  table: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface ChangeLookups {
  status: (id: string) => string | undefined;
  location: (id: string) => string | undefined;
  unit: (id: string) => string | undefined;
  /** a צפי הגעה / סטטוס גיוס value's name */
  option: (id: string) => string | undefined;
}

const dm = (day: Day) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const dmy = (day: Day) => `${dm(day)}.${day.slice(0, 4)}`;

/** Fields a person cares about, with how to show a value; the rest (order in the sheet, timestamps) is left out. */
type Show = (v: unknown, l: ChangeLookups) => string;
const text: Show = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const date: Show = (v) => (typeof v === "string" && v ? dmy(v) : "—");
const yesNo: Show = (v) => (v === true ? "יש" : v === false ? "אין" : "—");

const MEMBER_FIELDS: Record<string, { label: string; show: Show }> = {
  in_report: { label: "נספר בדוח", show: (v) => (v ? "כן" : "לא") },
  call_up_on: { label: "תאריך גיוס", show: date },
  released_on: { label: "תאריך שחרור", show: date },
  // the free-text columns before the value lists (0021); kept for older log rows
  enlistment_status: { label: "סטטוס גיוס", show: text },
  arrival_forecast: { label: "צפי הגעה", show: text },
  arrival_option_id: { label: "צפי הגעה", show: (v, l) => (typeof v === "string" ? (l.option(v) ?? "ערך שנמחק") : "—") },
  enlistment_option_id: { label: "סטטוס גיוס", show: (v, l) => (typeof v === "string" ? (l.option(v) ?? "ערך שנמחק") : "—") },
  planned_unit_id: { label: "עובר בסבב הבא ל", show: (v, l) => (typeof v === "string" ? (l.unit(v) ?? "יחידה אחרת") : "—") },
  dmh_category: { label: "תפקיד לדמ״ח", show: text },
  has_disc: { label: "דיסקית", show: yesNo },
  notes: { label: "הערות", show: text },
  location_id: { label: "מיקום בשבצ״ק", show: (v, l) => (typeof v === "string" ? (l.location(v) ?? "מיקום שנמחק") : "—") },
};

const PEOPLE_FIELDS: Record<string, { label: string; show: Show }> = {
  full_name: { label: "שם", show: text },
  personal_number: { label: "מספר אישי", show: text },
  phone: { label: "טלפון", show: text },
  role_title: { label: "תפקיד בפועל", show: text },
  unit_id: { label: "מסגרת", show: (v, l) => (typeof v === "string" ? (l.unit(v) ?? "יחידה אחרת") : "—") },
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function fieldChanges(fields: Record<string, { label: string; show: Show }>, e: AuditEntry, l: ChangeLookups): string[] {
  const out: string[] = [];
  for (const [key, f] of Object.entries(fields)) {
    const was = e.before?.[key];
    const now = e.after?.[key];
    if (same(was, now)) continue;
    out.push(`${f.label}: ${f.show(was, l)} ← ${f.show(now, l)}`);
  }
  return out;
}

/**
 * One audit row as lines of text; [] when nothing a person cares about changed
 * (e.g. only the sheet row order moved).
 */
export function describeChange(e: AuditEntry, l: ChangeLookups): string[] {
  if (e.table === "doch1_days") {
    const row = e.after ?? e.before ?? {};
    const day = typeof row.day === "string" ? dm(row.day) : "?";
    const st = (r: Record<string, unknown> | null) => (typeof r?.status_id === "string" ? (l.status(r.status_id) ?? "סטטוס שנמחק") : "—");
    if (e.action === "insert") return [`${day}: ${st(e.after)}`];
    if (e.action === "delete") return [`${day}: ${st(e.before)} ← ללא סטטוס`];
    return same(e.before?.status_id, e.after?.status_id) ? [] : [`${day}: ${st(e.before)} ← ${st(e.after)}`];
  }
  if (e.table === "doch1_members") {
    if (e.action === "insert") return ["נוסף לסבב"];
    if (e.action === "delete") return ["הוסר מהסבב"];
    return fieldChanges(MEMBER_FIELDS, e, l);
  }
  if (e.table === "people") {
    if (e.action === "insert") return ["נוסף למערכת"];
    if (e.action === "delete") return ["נמחק מהמערכת"];
    return fieldChanges(PEOPLE_FIELDS, e, l);
  }
  return [];
}
