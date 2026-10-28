import "server-only";
/**
 * שבצ״ק and standby read models. Like data.ts, every loader runs in the caller's `withUser`
 * transaction: a company user gets every team (names, vehicles, holders) but only the members
 * RLS lets them see — the soldiers of their own units, plus everyone on a team they edit.
 */
import {
  availableStatusIds,
  byHe,
  placement,
  teamReadiness,
  type DayStatuses,
  type LocationKind,
  type Readiness,
  type StandbyLevel,
  type StatusDef,
  type UnitNode,
  type VehicleState,
} from "@gdud/core";
import { asc, eq, inArray, schema, type Tx } from "@gdud/db";
import type { Session } from "@/lib/session";

const { people, doch1Locations: locations, doch1Vehicles: vehicles, doch1StandbyTypes: types } = schema;
const { doch1StandbyTeams: teams, doch1StandbyHolders: holders, doch1StandbyMembers: teamMembers } = schema;

export interface LocationVM {
  id: string;
  name: string;
  kind: LocationKind;
  sortOrder: number;
  active: boolean;
}

export interface VehicleVM {
  id: string;
  number: string;
  /** the company it belongs to; null = battalion */
  unitId: string | null;
  kind: string | null;
  state: VehicleState;
  notes: string | null;
  active: boolean;
}

export interface StandbyTypeVM {
  id: string;
  name: string;
  level: StandbyLevel;
  size: number | null;
  requiredRoles: string[];
  sortOrder: number;
  active: boolean;
}

export interface TeamMemberVM {
  personId: string;
  role: string | null;
  /** null = a soldier of a unit the user doesn't see (people RLS) */
  name: string | null;
  unitId: string | null;
}

export interface TeamVM {
  id: string;
  name: string;
  /** the company that owns it (its only holder); null = battalion */
  unitId: string | null;
  typeId: string | null;
  locationId: string | null;
  vehicleId: string | null;
  active: boolean;
  sortOrder: number;
  holderIds: string[];
  members: TeamMemberVM[];
}

export async function loadLocations(tx: Tx, roundId: string): Promise<LocationVM[]> {
  const rows = await tx.select().from(locations).where(eq(locations.roundId, roundId)).orderBy(asc(locations.sortOrder), asc(locations.name));
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind as LocationKind, sortOrder: r.sortOrder, active: r.active }));
}

export async function loadVehicles(tx: Tx): Promise<VehicleVM[]> {
  const rows = await tx.select().from(vehicles).orderBy(asc(vehicles.number));
  return rows.map((r) => ({ id: r.id, number: r.number, unitId: r.unitId, kind: r.kind, state: r.state as VehicleState, notes: r.notes, active: r.active }));
}

export async function loadStandbyTypes(tx: Tx, roundId: string): Promise<StandbyTypeVM[]> {
  const rows = await tx.select().from(types).where(eq(types.roundId, roundId)).orderBy(asc(types.sortOrder), asc(types.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    level: r.level as StandbyLevel,
    size: r.size,
    requiredRoles: r.requiredRoles,
    sortOrder: r.sortOrder,
    active: r.active,
  }));
}

/** Every team of the round with its holders and the members the user may see, by sort order then name. */
export async function loadTeams(tx: Tx, roundId: string): Promise<TeamVM[]> {
  const rows = await tx.select().from(teams).where(eq(teams.roundId, roundId));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [hs, ms] = await Promise.all([
    tx.select().from(holders).where(inArray(holders.teamId, ids)),
    tx
      .select({ teamId: teamMembers.teamId, personId: teamMembers.personId, role: teamMembers.role, sortOrder: teamMembers.sortOrder, name: people.fullName, unitId: people.unitId })
      .from(teamMembers)
      .leftJoin(people, eq(people.id, teamMembers.personId))
      .where(inArray(teamMembers.teamId, ids))
      .orderBy(asc(teamMembers.sortOrder), asc(teamMembers.createdAt)),
  ]);
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      unitId: r.unitId,
      typeId: r.typeId,
      locationId: r.locationId,
      vehicleId: r.vehicleId,
      active: r.active,
      sortOrder: r.sortOrder,
      holderIds: hs.filter((h) => h.teamId === r.id).map((h) => h.unitId),
      members: ms.filter((m) => m.teamId === r.id).map((m) => ({ personId: m.personId, role: m.role, name: m.name, unitId: m.unitId })),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || byHe(a.name, b.name));
}

/**
 * Companies whose שבצ״ק the user looks at: battalion-wide → every active round company;
 * otherwise the companies of their doch1 scopes (a platoon commander → their platoon's company).
 */
export function standbyCompanies(s: Pick<Session, "user" | "units">, scopes: ReadonlyArray<string | null>, roundCompanyIds: readonly string[]): UnitNode[] {
  const byId = new Map(s.units.map((u) => [u.id, u]));
  const ids = scopes.includes(null)
    ? roundCompanyIds
    : scopes.map((u) => (u ? placement(u, byId).company?.id : undefined)).filter((u): u is string => !!u && roundCompanyIds.includes(u));
  return [...new Set(ids)]
    .map((id) => byId.get(id))
    .filter((u): u is UnitNode => !!u)
    .sort((a, b) => a.sortOrder - b.sortOrder || byHe(a.name, b.name));
}

export interface TeamStatusVM extends TeamVM {
  readiness: Readiness;
  /** holders' names, "אגם + מסייעת" */
  holders: string;
  location: LocationVM | null;
  vehicle: VehicleVM | null;
  type: StandbyTypeVM | null;
}

/** Readiness of each team for the day, with its names resolved. */
export function withReadiness(
  list: readonly TeamVM[],
  ctx: { day: DayStatuses; statuses: readonly StatusDef[]; units: readonly UnitNode[]; locations: readonly LocationVM[]; vehicles: readonly VehicleVM[]; types: readonly StandbyTypeVM[] },
): TeamStatusVM[] {
  const available = availableStatusIds(ctx.statuses);
  const unitName = new Map(ctx.units.map((u) => [u.id, u.name]));
  return list.map((t) => {
    const type = ctx.types.find((x) => x.id === t.typeId) ?? null;
    const vehicle = ctx.vehicles.find((v) => v.id === t.vehicleId) ?? null;
    return {
      ...t,
      type,
      vehicle,
      location: ctx.locations.find((l) => l.id === t.locationId) ?? null,
      holders: t.holderIds.map((id) => unitName.get(id) ?? "").filter(Boolean).join(" + "),
      readiness: teamReadiness({
        members: t.members,
        size: type?.size ?? null,
        requiredRoles: type?.requiredRoles ?? [],
        vehicleState: vehicle?.state ?? null,
        day: ctx.day,
        available,
      }),
    };
  });
}
