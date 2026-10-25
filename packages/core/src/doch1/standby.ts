/**
 * שבצ״ק and standby: team readiness, swap candidates and the location data checks.
 * Like counting.ts, nothing here knows a status or location name — "available" is the
 * status flag `standbyAvailable`, "outpost" is the location kind, roles are compared by canonicalName.
 */
import type { DayStatuses, StatusDef } from "./counting";
import { canonicalName } from "./normalize";

export const VEHICLE_STATES = ["ok", "service", "broken"] as const;
export type VehicleState = (typeof VEHICLE_STATES)[number];
export const VEHICLE_STATE_LABEL: Record<VehicleState, string> = { ok: "תקין", service: "בטיפול", broken: "תקול" };

export const LOCATION_KINDS = ["outpost", "camp", "outside"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];
export const LOCATION_KIND_LABEL: Record<LocationKind, string> = { outpost: "מוצב", camp: "מחנה", outside: "בחוץ" };

export const STANDBY_LEVELS = ["battalion", "company"] as const;
export type StandbyLevel = (typeof STANDBY_LEVELS)[number];
export const STANDBY_LEVEL_LABEL: Record<StandbyLevel, string> = { battalion: "גדודי", company: "פלוגתי" };

/** Alternatives inside one required role: "מ״פ / סמ״פ" = either. */
const ROLE_ALTERNATIVES = "/";

/** Status ids whose soldiers count as available for standby today. */
export function availableStatusIds(statuses: ReadonlyArray<Pick<StatusDef, "id" | "standbyAvailable">>): Set<string> {
  return new Set(statuses.filter((s) => s.standbyAvailable).map((s) => s.id));
}

/** Does a soldier's role fill a required role (one of its "/" alternatives, spelling-insensitive)? */
export function roleMatches(required: string, role: string | null | undefined): boolean {
  if (!role) return false;
  const have = canonicalName(role);
  return required
    .split(ROLE_ALTERNATIVES)
    .map((r) => canonicalName(r))
    .some((r) => r !== "" && r === have);
}

export interface TeamMemberInput {
  personId: string;
  role: string | null;
}

export interface ReadinessInput {
  members: readonly TeamMemberInput[];
  /** soldiers needed (the standby type's size); null = the team's own member count */
  size: number | null;
  requiredRoles: readonly string[];
  /** null = the team has no vehicle */
  vehicleState: VehicleState | null;
  /** today's statuses */
  day: DayStatuses;
  available: ReadonlySet<string>;
}

export interface Readiness {
  /** members whose status today is an available one */
  available: number;
  total: number;
  needed: number;
  /** required roles no available member fills */
  missingRoles: string[];
  /** has no vehicle, or its vehicle is תקין */
  vehicleOk: boolean;
  /** full: enough available soldiers, every required role, vehicle ok · short: people or roles missing · vehicle: only the vehicle */
  state: "full" | "short" | "vehicle";
}

export function isAvailable(personId: string, day: DayStatuses, available: ReadonlySet<string>): boolean {
  const st = day.get(personId);
  return st !== undefined && available.has(st);
}

/**
 * Required roles not covered by available members. Each member fills one role; the roles
 * with the fewest candidates are filled first, so "מ״פ / סמ״פ" doesn't take the only סמ״פ
 * another role needed.
 */
export function missingRoles(required: readonly string[], roles: ReadonlyArray<string | null>): string[] {
  const free = roles.map((r, i) => ({ r, i }));
  const used = new Set<number>();
  const order = required
    .map((req, idx) => ({ req, idx, n: free.filter((f) => roleMatches(req, f.r)).length }))
    .sort((a, b) => a.n - b.n || a.idx - b.idx);
  const missing = new Set<number>();
  for (const { req, idx } of order) {
    const hit = free.find((f) => !used.has(f.i) && roleMatches(req, f.r));
    if (hit) used.add(hit.i);
    else missing.add(idx);
  }
  return required.filter((_, i) => missing.has(i));
}

export function teamReadiness(t: ReadinessInput): Readiness {
  const availableMembers = t.members.filter((m) => isAvailable(m.personId, t.day, t.available));
  const needed = t.size ?? t.members.length;
  const roles = missingRoles(
    t.requiredRoles,
    availableMembers.map((m) => m.role),
  );
  const vehicleOk = t.vehicleState === null || t.vehicleState === "ok";
  const short = availableMembers.length < needed || roles.length > 0;
  return {
    available: availableMembers.length,
    total: t.members.length,
    needed,
    missingRoles: roles,
    vehicleOk,
    state: short ? "short" : vehicleOk ? "full" : "vehicle",
  };
}

export interface CandidateInput {
  personId: string;
  name: string;
  role: string | null;
  /** already on a standby team this round */
  onTeam: boolean;
}

export interface Candidate extends CandidateInput {
  available: boolean;
  sameRole: boolean;
}

/**
 * Who can replace a team member (mockup 12, "החלפה"): soldiers not on a team, available today
 * first, the same role first, then by name. Unavailable ones are kept (shown, not pickable).
 */
export function swapCandidates<T extends CandidateInput>(
  role: string | null,
  pool: readonly T[],
  day: DayStatuses,
  available: ReadonlySet<string>,
): Array<T & Pick<Candidate, "available" | "sameRole">> {
  return pool
    .filter((c) => !c.onTeam)
    .map((c) => ({ ...c, available: isAvailable(c.personId, day, available), sameRole: !!role && roleMatches(role, c.role) }))
    .sort(
      (a, b) =>
        Number(b.available) - Number(a.available) || Number(b.sameRole) - Number(a.sameRole) || a.name.localeCompare(b.name, "he"),
    );
}

export interface LocatedMember {
  personId: string;
  inReport: boolean;
  /** kind of the soldier's שבצ״ק location; null = not in the שבצ״ק */
  locationKind: LocationKind | null;
}

export interface LocationChecks {
  /** today's status needs an outpost (עזה) but the soldier has no outpost in the שבצ״ק */
  outpostStatusWithoutOutpost: string[];
  /** at an outpost in the שבצ״ק, reported today, and the status is not an outpost one */
  atOutpostOtherStatus: string[];
}

/** The two status ↔ שבצ״ק disagreements the sheet's data control shows (sheet-structure.md, section B). */
export function locationChecks(members: readonly LocatedMember[], day: DayStatuses, statuses: readonly StatusDef[]): LocationChecks {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  const out: LocationChecks = { outpostStatusWithoutOutpost: [], atOutpostOtherStatus: [] };
  for (const m of members) {
    if (!m.inReport) continue;
    const st = byId.get(day.get(m.personId) ?? "");
    if (!st) continue;
    const atOutpost = m.locationKind === "outpost";
    if (st.needsOutpost && !atOutpost) out.outpostStatusWithoutOutpost.push(m.personId);
    if (!st.needsOutpost && atOutpost) out.atOutpostOtherStatus.push(m.personId);
  }
  return out;
}
