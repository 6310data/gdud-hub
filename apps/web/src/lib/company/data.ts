import "server-only";
/**
 * ניהול פלוגה read models. The departments' data comes only through the SECURITY DEFINER functions
 * of 0027_company_security.sql (person_gear / person_days / person_details / company_roster), which
 * return only what the caller may see; the module's own tables are read under RLS.
 */
import { byHe, placement, type ProfileField, type RoundDay, type UnitNode } from "@gdud/core";
import { and, desc, eq, inArray, schema, sql, type Tx } from "@gdud/db";

const { companyJoinRequests: joins, companyProfileRequests: changes, people } = schema;

/** tx.execute() rows: an array on postgres-js, `{ rows }` on PGlite. */
export function rowsOf<T>(res: unknown): T[] {
  return (Array.isArray(res) ? res : (res as { rows: T[] }).rows) as T[];
}

const toDay = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/* ── one soldier (אני) ───────────────────────────────────────────────────── */

export interface PersonDetails {
  id: string;
  fullName: string;
  roleTitle: string | null;
  phone: string | null;
  unitId: string;
  active: boolean;
  /** an active account is linked to the soldier (or invited for them) */
  linked: boolean;
}

export async function loadDetails(tx: Tx, personId: string): Promise<PersonDetails | null> {
  type Row = { id: string; full_name: string; role_title: string | null; phone: string | null; unit_id: string; active: boolean; linked: boolean };
  const [r] = rowsOf<Row>(await tx.execute(sql`select * from app.person_details(${personId}::uuid)`));
  return r ? { id: r.id, fullName: r.full_name, roleTitle: r.role_title, phone: r.phone, unitId: r.unit_id, active: r.active, linked: r.linked } : null;
}

export type GearSource = "logistics" | "kesher" | "company";
export interface GearRow {
  source: GearSource;
  item: string;
  serial: string | null;
  qty: number;
  since: Date | null;
  detail: string | null;
  /** company register: who has it now */
  withName: string | null;
}

export async function loadGear(tx: Tx, personId: string): Promise<GearRow[]> {
  type Row = { source: GearSource; item: string; serial: string | null; qty: number; since: string | Date | null; detail: string | null; with_name: string | null };
  const rows = rowsOf<Row>(await tx.execute(sql`select * from app.person_gear(${personId}::uuid)`));
  return rows
    .map((r) => ({ source: r.source, item: r.item, serial: r.serial, qty: Number(r.qty), since: r.since ? new Date(r.since) : null, detail: r.detail, withName: r.with_name }))
    .sort((a, b) => byHe(a.item, b.item) || byHe(a.serial ?? "", b.serial ?? ""));
}

export interface RoundDays {
  roundName: string;
  startsOn: string;
  endsOn: string;
  days: RoundDay[];
}

/** The soldier's days in the active round; null when no round is active. */
export async function loadDays(tx: Tx, personId: string): Promise<RoundDays | null> {
  type Row = {
    round_name: string;
    starts_on: string | Date;
    ends_on: string | Date;
    day: string | Date | null;
    status_name: string | null;
    color: string | null;
    present: boolean | null;
    home: boolean | null;
    org: boolean | null;
  };
  const rows = rowsOf<Row>(await tx.execute(sql`select * from app.person_days(${personId}::uuid)`));
  const first = rows[0];
  if (!first) return null;
  return {
    roundName: first.round_name,
    startsOn: toDay(first.starts_on),
    endsOn: toDay(first.ends_on),
    days: rows
      .filter((r) => r.day)
      .map((r) => ({ day: toDay(r.day), statusName: r.status_name ?? "", color: r.color ?? "#8e8e93", present: !!r.present, home: !!r.home, org: !!r.org })),
  };
}

export interface OpenChange {
  id: string;
  field: ProfileField;
  newValue: string | null;
}

/** The soldier's open name / תפקיד requests (RLS: their own, or what a commander covers). */
export async function loadOpenChanges(tx: Tx, personId: string): Promise<OpenChange[]> {
  return tx
    .select({ id: changes.id, field: changes.field, newValue: changes.newValue })
    .from(changes)
    .where(and(eq(changes.personId, personId), eq(changes.status, "pending")));
}

/* ── the company ─────────────────────────────────────────────────────────── */

export interface RosterRow {
  id: string;
  fullName: string;
  roleTitle: string | null;
  phone: string | null;
  unitId: string;
  platoonName: string | null;
  statusName: string | null;
  statusColor: string | null;
  gear: number;
  linked: boolean;
}

export async function loadRoster(tx: Tx, unitId: string, units: readonly UnitNode[]): Promise<RosterRow[]> {
  type Row = {
    id: string;
    full_name: string;
    role_title: string | null;
    phone: string | null;
    unit_id: string;
    status_name: string | null;
    status_color: string | null;
    gear: number;
    linked: boolean;
  };
  const byId = new Map(units.map((u) => [u.id, u]));
  const rows = rowsOf<Row>(await tx.execute(sql`select * from app.company_roster(${unitId}::uuid)`));
  return rows
    .map((r) => ({
      id: r.id,
      fullName: r.full_name,
      roleTitle: r.role_title,
      phone: r.phone,
      unitId: r.unit_id,
      platoonName: placement(r.unit_id, byId).platoon?.name ?? null,
      statusName: r.status_name,
      statusColor: r.status_color,
      gear: Number(r.gear),
      linked: r.linked,
    }))
    .sort((a, b) => byHe(a.platoonName ?? "", b.platoonName ?? "") || byHe(a.fullName, b.fullName));
}

export interface JoinRequestRow {
  id: string;
  email: string;
  displayName: string | null;
  personId: string;
  personName: string | null;
  unitId: string;
  createdAt: Date;
}

/** Open join requests the user may decide (RLS: company admins of the soldier's unit). */
export async function loadJoinRequests(tx: Tx, unitIds: readonly string[]): Promise<JoinRequestRow[]> {
  if (!unitIds.length) return [];
  return tx
    .select({
      id: joins.id,
      email: joins.email,
      displayName: joins.displayName,
      personId: joins.personId,
      personName: people.fullName,
      unitId: joins.unitId,
      createdAt: joins.createdAt,
    })
    .from(joins)
    .leftJoin(people, eq(people.id, joins.personId))
    .where(and(eq(joins.status, "pending"), inArray(joins.unitId, [...unitIds])))
    .orderBy(desc(joins.createdAt));
}

export interface ChangeRequestRow {
  id: string;
  personId: string;
  personName: string | null;
  unitId: string;
  field: ProfileField;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
}

/** Open change requests in these units (RLS: the soldier's commanders). */
export async function loadChangeRequests(tx: Tx, unitIds: readonly string[]): Promise<ChangeRequestRow[]> {
  if (!unitIds.length) return [];
  return tx
    .select({
      id: changes.id,
      personId: changes.personId,
      personName: people.fullName,
      unitId: changes.unitId,
      field: changes.field,
      oldValue: changes.oldValue,
      newValue: changes.newValue,
      createdAt: changes.createdAt,
    })
    .from(changes)
    .leftJoin(people, eq(people.id, changes.personId))
    .where(and(eq(changes.status, "pending"), inArray(changes.unitId, [...unitIds])))
    .orderBy(desc(changes.createdAt));
}

/** The unit and every unit below it. */
export function subtreeIds(rootId: string, units: readonly UnitNode[]): string[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i++) for (const u of units) if (u.parentId === out[i]) out.push(u.id);
  return out;
}

/* ── החתמה פנימית ────────────────────────────────────────────────────────── */

export interface RegisterItem {
  kind: "kesher" | "company";
  id: string;
  name: string;
  category: string | null;
  serial: string | null;
  quantity: number;
  available: number;
  nowPersonId: string | null;
  nowName: string | null;
  nowUnitId: string | null;
  openSigningId: string | null;
}

/** What the company can sign internally, with where each piece is now (app.company_register_items). */
export async function loadRegisterItems(tx: Tx, unitId: string): Promise<RegisterItem[]> {
  type Row = {
    kind: "kesher" | "company";
    id: string;
    name: string;
    category: string | null;
    serial: string | null;
    quantity: number;
    available: number;
    now_person_id: string | null;
    now_name: string | null;
    now_unit_id: string | null;
    open_signing_id: string | null;
  };
  const rows = rowsOf<Row>(await tx.execute(sql`select * from app.company_register_items(${unitId}::uuid)`));
  return rows
    .map((r) => ({
      kind: r.kind,
      id: r.id,
      name: r.name,
      category: r.category,
      serial: r.serial,
      quantity: Number(r.quantity),
      available: Number(r.available),
      nowPersonId: r.now_person_id,
      nowName: r.now_name,
      nowUnitId: r.now_unit_id,
      openSigningId: r.open_signing_id,
    }))
    .sort((a, b) => byHe(a.name, b.name) || byHe(a.serial ?? "", b.serial ?? ""));
}

export interface SoldierName {
  id: string;
  name: string;
  unitId: string;
}

/** The receiver picker: names of the company's active soldiers (app.company_soldier_names). */
export async function loadSoldierNames(tx: Tx, unitId: string): Promise<SoldierName[]> {
  const rows = rowsOf<{ id: string; full_name: string; unit_id: string }>(await tx.execute(sql`select * from app.company_soldier_names(${unitId}::uuid)`));
  return rows.map((r) => ({ id: r.id, name: r.full_name, unitId: r.unit_id })).sort((a, b) => byHe(a.name, b.name));
}

export interface SigningRow {
  id: string;
  kind: "kesher" | "company";
  item: string;
  serial: string | null;
  quantity: number;
  fromPersonId: string | null;
  fromName: string | null;
  fromUnitId: string | null;
  toPersonId: string;
  toName: string;
  toUnitId: string;
  signedAt: Date;
  signedByName: string | null;
  returnedAt: Date | null;
  returnedByName: string | null;
}

/** The register: open entries, or the history (app.company_register). */
export async function loadRegister(tx: Tx, unitId: string, open: boolean): Promise<SigningRow[]> {
  type Row = {
    id: string;
    kind: "kesher" | "company";
    item: string;
    serial: string | null;
    quantity: number;
    from_person_id: string | null;
    from_name: string | null;
    from_unit_id: string | null;
    to_person_id: string;
    to_name: string;
    to_unit_id: string;
    signed_at: string | Date;
    signed_by_name: string | null;
    returned_at: string | Date | null;
    returned_by_name: string | null;
  };
  const rows = rowsOf<Row>(await tx.execute(sql`select * from app.company_register(${unitId}::uuid, ${open})`));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    item: r.item,
    serial: r.serial,
    quantity: Number(r.quantity),
    fromPersonId: r.from_person_id,
    fromName: r.from_name,
    fromUnitId: r.from_unit_id,
    toPersonId: r.to_person_id,
    toName: r.to_name,
    toUnitId: r.to_unit_id,
    signedAt: new Date(r.signed_at),
    signedByName: r.signed_by_name,
    returnedAt: r.returned_at ? new Date(r.returned_at) : null,
    returnedByName: r.returned_by_name,
  }));
}

/* ── הגדרות → הרשאות ─────────────────────────────────────────────────────── */

export interface AccessRole {
  membershipId: string;
  module: string;
  role: string;
  unitId: string | null;
  editable: boolean;
}
export interface AccessUser {
  userId: string;
  email: string;
  personId: string;
  fullName: string;
  personUnitId: string;
  roles: AccessRole[];
}

/** The company's linked accounts and their roles (app.company_access_list, company admin only). */
export async function loadAccessList(tx: Tx, companyId: string): Promise<AccessUser[]> {
  type Row = {
    user_id: string;
    email: string;
    person_id: string;
    full_name: string;
    person_unit_id: string;
    membership_id: string | null;
    module: string | null;
    role: string | null;
    unit_id: string | null;
    editable: boolean;
  };
  const byUser = new Map<string, AccessUser>();
  for (const r of rowsOf<Row>(await tx.execute(sql`select * from app.company_access_list(${companyId}::uuid)`))) {
    const u = byUser.get(r.user_id) ?? { userId: r.user_id, email: r.email, personId: r.person_id, fullName: r.full_name, personUnitId: r.person_unit_id, roles: [] };
    if (r.membership_id && r.module && r.role) u.roles.push({ membershipId: r.membership_id, module: r.module, role: r.role, unitId: r.unit_id, editable: r.editable });
    byUser.set(r.user_id, u);
  }
  return [...byUser.values()].sort((a, b) => byHe(a.fullName, b.fullName));
}
