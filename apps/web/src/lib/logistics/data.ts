import "server-only";
/**
 * Logistics read models. Every loader takes the caller's `withUser` transaction, so
 * what comes back is already filtered by RLS (a company-scoped user sees their company).
 */
import {
  byHe,
  countStock,
  placement,
  type Condition,
  type KitLine,
  type StockCounts,
  type UnitNode,
} from "@gdud/core";
import { and, asc, desc, eq, isNull, schema, sql, type Tx } from "@gdud/db";

const { people, logisticsItems: items, logisticsKitItems: kitItems, logisticsSerials: serials } = schema;
const { logisticsAssignments: assignments, logisticsStorage: storage, logisticsForms: forms } = schema;

/* ── people ──────────────────────────────────────────────────────────────── */

export interface PersonVM {
  id: string;
  name: string;
  personalNumber: string | null;
  phone: string | null;
  roleTitle: string | null;
  unitId: string;
  companyId: string | null;
  companyName: string | null;
  platoonId: string | null;
  platoonName: string | null;
  active: boolean;
}

export const unitsById = (units: readonly UnitNode[]): Map<string, UnitNode> => new Map(units.map((u) => [u.id, u]));

export function toPersonVM(p: typeof people.$inferSelect, byId: ReadonlyMap<string, UnitNode>): PersonVM {
  const { company, platoon } = placement(p.unitId, byId);
  return {
    id: p.id,
    name: p.fullName,
    personalNumber: p.personalNumber,
    phone: p.phone,
    roleTitle: p.roleTitle,
    unitId: p.unitId,
    companyId: company?.id ?? null,
    companyName: company?.name ?? null,
    platoonId: platoon?.id ?? null,
    platoonName: platoon?.name ?? null,
    active: p.active,
  };
}

export async function loadPeople(tx: Tx, units: readonly UnitNode[], opts: { includeInactive?: boolean } = {}) {
  const byId = unitsById(units);
  const rows = await tx
    .select()
    .from(people)
    .where(opts.includeInactive ? undefined : eq(people.active, true))
    .orderBy(asc(people.fullName));
  return rows.map((p) => toPersonVM(p, byId));
}

export async function loadPerson(tx: Tx, units: readonly UnitNode[], id: string): Promise<PersonVM | null> {
  const [p] = await tx.select().from(people).where(eq(people.id, id)).limit(1);
  return p ? toPersonVM(p, unitsById(units)) : null;
}

/** Display line: "פלסר · מחלקה 2" */
export const personPlace = (p: Pick<PersonVM, "companyName" | "platoonName">): string =>
  [p.companyName, p.platoonName].filter(Boolean).join(" · ");

/* ── catalogue & serials ─────────────────────────────────────────────────── */

export interface ItemVM {
  id: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  sku: string | null;
  kit: KitLine[];
}

export async function loadItems(tx: Tx): Promise<ItemVM[]> {
  const [rows, kit] = await Promise.all([
    tx.select().from(items),
    tx.select().from(kitItems).orderBy(asc(kitItems.sortOrder), asc(kitItems.name)),
  ]);
  return rows
    .map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      subcategory: i.subcategory,
      sku: i.sku,
      kit: kit.filter((k) => k.itemId === i.id).map((k) => ({ name: k.name, qty: k.qty })),
    }))
    .sort((a, b) => byHe(a.name, b.name));
}

/** Serial ids that are signed out right now (battalion-wide, see app.logistics_held_serials). */
export async function loadHeldSerialIds(tx: Tx): Promise<Set<string>> {
  const res = await tx.execute<{ id: string }>(sql`select app.logistics_held_serials() as id`);
  const rows = (Array.isArray(res) ? res : (res as unknown as { rows: { id: string }[] }).rows) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

export interface SerialVM {
  id: string;
  serial: string;
  itemId: string;
  category: string | null;
  condition: Condition;
  held: boolean;
}

export async function loadSerials(tx: Tx, itemId?: string): Promise<SerialVM[]> {
  const [rows, held] = await Promise.all([
    tx
      .select({ id: serials.id, serial: serials.serial, itemId: serials.itemId, category: serials.category, condition: serials.condition })
      .from(serials)
      .where(itemId ? eq(serials.itemId, itemId) : undefined),
    loadHeldSerialIds(tx),
  ]);
  return rows.map((s) => ({ ...s, held: held.has(s.id) })).sort((a, b) => byHe(a.serial, b.serial));
}

export interface StockVM {
  items: ItemVM[];
  serials: SerialVM[];
  counts: Map<string, StockCounts>;
}

export async function loadStock(tx: Tx): Promise<StockVM> {
  const [itemRows, serialRows] = await Promise.all([loadItems(tx), loadSerials(tx)]);
  return { items: itemRows, serials: serialRows, counts: countStock(serialRows) };
}

/* ── holdings ────────────────────────────────────────────────────────────── */

export interface HoldingVM {
  id: string;
  serialId: string;
  serial: string;
  itemId: string;
  itemName: string;
  personId: string;
  notes: string | null;
  kit: KitLine[];
  signedAt: Date;
  signerName: string | null;
  formId: string | null;
}

const holdingCols = {
  id: assignments.id,
  serialId: assignments.serialId,
  serial: serials.serial,
  itemId: serials.itemId,
  itemName: items.name,
  personId: assignments.personId,
  notes: assignments.notes,
  kit: assignments.kit,
  signedAt: assignments.signedAt,
  signerName: assignments.signerName,
  formId: assignments.formId,
};

/** Open assignments the user can see (optionally of one soldier / one serial). */
export async function loadHoldings(tx: Tx, filter: { personId?: string; serialId?: string; itemId?: string } = {}): Promise<HoldingVM[]> {
  const rows = await tx
    .select(holdingCols)
    .from(assignments)
    .innerJoin(serials, eq(serials.id, assignments.serialId))
    .innerJoin(items, eq(items.id, serials.itemId))
    .where(
      and(
        isNull(assignments.returnedAt),
        filter.personId ? eq(assignments.personId, filter.personId) : undefined,
        filter.serialId ? eq(assignments.serialId, filter.serialId) : undefined,
        filter.itemId ? eq(serials.itemId, filter.itemId) : undefined,
      ),
    );
  return rows.sort((a, b) => byHe(a.itemName, b.itemName) || byHe(a.serial, b.serial));
}

/** Past (returned) assignments of one serial, newest first. */
export async function loadSerialHistory(tx: Tx, serialId: string) {
  return tx
    .select({
      id: assignments.id,
      personId: assignments.personId,
      personName: people.fullName,
      signedAt: assignments.signedAt,
      returnedAt: assignments.returnedAt,
      returnedTo: assignments.returnedTo,
      returnNotes: assignments.returnNotes,
    })
    .from(assignments)
    .innerJoin(people, eq(people.id, assignments.personId))
    .where(eq(assignments.serialId, serialId))
    .orderBy(desc(assignments.signedAt))
    .limit(20);
}

/* ── storage (אפסון) ──────────────────────────────────────────────────────── */

export interface StoredVM {
  id: string;
  personId: string;
  serialId: string | null;
  serial: string | null;
  itemName: string;
  storedAt: Date;
  notes: string | null;
}

export async function loadStorage(tx: Tx, filter: { personId?: string } = {}): Promise<StoredVM[]> {
  const rows = await tx
    .select({
      id: storage.id,
      personId: storage.personId,
      serialId: storage.serialId,
      serial: serials.serial,
      itemName: storage.itemName,
      storedAt: storage.storedAt,
      notes: storage.notes,
    })
    .from(storage)
    .leftJoin(serials, eq(serials.id, storage.serialId))
    .where(and(isNull(storage.releasedAt), filter.personId ? eq(storage.personId, filter.personId) : undefined));
  return rows.sort((a, b) => byHe(a.itemName, b.itemName));
}

/* ── forms ───────────────────────────────────────────────────────────────── */

export async function loadPersonForms(tx: Tx, personId: string) {
  return tx
    .select({ id: forms.id, kind: forms.kind, createdAt: forms.createdAt, data: forms.data })
    .from(forms)
    .where(eq(forms.personId, personId))
    .orderBy(desc(forms.createdAt))
    .limit(30);
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

export function groupBy<T, K>(list: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const t of list) {
    const k = key(t);
    const arr = out.get(k);
    if (arr) arr.push(t);
    else out.set(k, [t]);
  }
  return out;
}

/** Companies (active, in tree order) — the columns of the summary and the roster tabs. */
export function companiesOf(units: readonly UnitNode[]): UnitNode[] {
  return units.filter((u) => u.kind === "company" && u.active).sort((a, b) => a.sortOrder - b.sortOrder || byHe(a.name, b.name));
}

export function battalionName(units: readonly UnitNode[]): string {
  return units.find((u) => u.kind === "battalion")?.name ?? "גדוד";
}
