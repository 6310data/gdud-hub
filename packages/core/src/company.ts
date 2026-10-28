/**
 * ניהול פלוגה — shared rules (spec: docs/superpowers/specs/2026-10-28-company-design.md).
 * The database checks the same rules (migrations/0027_company_security.sql); these are for the UI.
 */

export const COMPANY_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type CompanyRequestStatus = (typeof COMPANY_REQUEST_STATUSES)[number];

/** The soldier fields a change request can propose (phone is edited directly). */
export const PROFILE_FIELDS = ["full_name", "role_title"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export const PROFILE_FIELD_LABEL: Record<ProfileField, string> = { full_name: "שם מלא", role_title: "תפקיד" };

/** Join attempts allowed per Google account in 24 hours (app.request_join). */
export const JOIN_ATTEMPTS_PER_DAY = 5;

/**
 * An Israeli phone number as stored by app.update_my_phone: digits only, starting with 0
 * (a +972 / 972 prefix becomes 0). Null when it isn't 9–10 digits after that.
 */
export function normalizePhone(v: string): string | null {
  let d = v.replace(/\D/g, "");
  if (d.startsWith("972")) d = `0${d.slice(3)}`;
  return /^0\d{8,9}$/.test(d) ? d : null;
}

/** 0501234567 → 050-1234567 (display only). */
export function formatPhone(v: string | null | undefined): string {
  if (!v) return "";
  const d = v.replace(/\D/g, "");
  if (/^05\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (/^0\d{8}$/.test(d)) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return v;
}

/** A soldier's day in the active round, as app.person_days returns it. */
export interface RoundDay {
  day: string;
  statusName: string;
  color: string;
  present: boolean;
  home: boolean;
  org: boolean;
}

export interface DayCounts {
  present: number;
  home: number;
  org: number;
  other: number;
  /** days after today that already have a status (the plan) — never in the totals */
  planned: number;
}

/**
 * Day counts for אני: days up to and including `today`, by the status flags the day had
 * (נוכח / בית / התארגנות / אחר). Later days count as planned only.
 */
export function countDays(days: readonly RoundDay[], today: string): DayCounts {
  const out: DayCounts = { present: 0, home: 0, org: 0, other: 0, planned: 0 };
  for (const d of days) {
    if (d.day > today) out.planned++;
    else if (d.present) out.present++;
    else if (d.home) out.home++;
    else if (d.org) out.org++;
    else out.other++;
  }
  return out;
}

/**
 * The roles a company admin gives in ניהול פלוגה → הגדרות, and on which level (mirrors
 * app.company_role_allowed in 0031_company_roles_security.sql). Never admin / master_admin.
 */
export const COMPANY_GRANTABLE = [
  { module: "company", role: "platoon_commander", level: "platoon" },
  { module: "doch1", role: "company_user", level: "company" },
  { module: "doch1", role: "platoon_commander", level: "platoon" },
  { module: "doch1", role: "viewer", level: "company" },
  { module: "logistics", role: "company_user", level: "company" },
  { module: "kesher", role: "user", level: "company" },
] as const;
export type CompanyGrantable = (typeof COMPANY_GRANTABLE)[number];

export function isCompanyGrantable(module: string, role: string, level: string): boolean {
  return COMPANY_GRANTABLE.some((g) => g.module === module && g.role === role && g.level === level);
}
