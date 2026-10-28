import "server-only";
/**
 * מחלקת קשר read models. Every loader takes the caller's `withUser` transaction, so what comes back
 * is already filtered by RLS: every member reads the צ׳, quantities and תקן; holders, reports and
 * log rows only for the companies they cover.
 */
import {
  byHe,
  checkStatus,
  placement,
  warehouseStock,
  type CheckStatus,
  type KesherCondition,
  type KesherItemKind,
  type KesherKitLine,
  type KesherLocation,
  type UnitNode,
} from "@gdud/core";
import { and, asc, desc, eq, inArray, isNotNull, ne, schema, sql, type Tx } from "@gdud/db";
import { unitsById } from "@/lib/logistics/data";

const { people, kesherItems: items, kesherKitItems: kits, kesherSerials: serials, kesherHolders: holders } = schema;
const { kesherStock: stock, kesherSettings: settings, kesherChecks: checks, kesherCheckLines: checkLines } = schema;
const { kesherVehicleStock: vehicleStock, kesherEyeChecks: eyeChecks } = schema;

export interface KItem {
  id: string;
  name: string;
  kind: KesherItemKind;
  category: string | null;
  /** מלאי כללי */
  brigadeQty: number | null;
  /** bulk: how many of the warehouse's are תקול */
  brokenQty: number;
}
export interface KPerson {
  id: string;
  name: string;
  companyId: string | null;
  platoonName: string | null;
  active: boolean;
}
export interface KHolder {
  unitId: string;
  signer: KPerson | null;
  signerRole: string | null;
  holder: KPerson | null;
  holderRole: string | null;
  frame: string | null;
}
export interface KSerial {
  id: string;
  serial: string;
  itemId: string;
  itemName: string;
  location: KesherLocation;
  unitId: string | null;
  condition: KesherCondition;
  vehicle: string | null;
  notes: string | null;
  /** only when the user covers the company */
  holder: KHolder | null;
}
export interface KCheck {
  id: string;
  unitId: string;
  at: Date;
  reporterName: string | null;
  total: number;
  found: number;
  note: string | null;
}
export interface LastSeen {
  at: Date;
  found: boolean;
}

/** A vehicle of דוח 1's list (app.kesher_vehicles()), with the standby teams of the active round that have it. */
export interface KVehicle {
  id: string;
  number: string;
  kind: string | null;
  state: string;
  active: boolean;
  standby: string | null;
}

export interface KesherData {
  items: KItem[];
  itemsById: Map<string, KItem>;
  /** without the צ׳ returned to the brigade (loadKesher's `returned` option adds them) */
  serials: KSerial[];
  /**
   * `${itemId}|${unitId ?? ""}` → qty (no row = 0). The warehouse (unitId null) is computed:
   * מלאי כללי − the companies − the vehicles (warehouseStock in @gdud/core), תקול included.
   */
  stock: Map<string, number>;
  /** what the warehouse can sign out of a ציוד משלים item: its quantity without the תקול */
  available(itemId: string): number;
  /** vehicle id → item id → qty */
  vehicleStock: Map<string, Map<string, number>>;
  /** parent item name → its תקן */
  kits: Map<string, KesherKitLine[]>;
  staleDays: number;
  /** a check older than this is yellow on the צ׳ table, older than alertDays red */
  warnDays: number;
  alertDays: number;
}

export const stockKey = (itemId: string, unitId: string | null) => `${itemId}|${unitId ?? ""}`;

/** A soldier who no longer counts as this company's: removed from the list, or moved to another company. */
export const leftCompany = (p: KPerson | null, unitId: string) => Boolean(p && (!p.active || p.companyId !== unitId));

export async function loadKesher(tx: Tx, units: readonly UnitNode[], opts: { returned?: boolean } = {}): Promise<KesherData> {
  const [itemRows, serialRows, holderRows, stockRows, vehicleRows, kitRows, [cfg]] = await Promise.all([
    tx
      .select({ id: items.id, name: items.name, kind: items.kind, category: items.category, brigadeQty: items.brigadeQty, brokenQty: items.brokenQty })
      .from(items)
      .orderBy(asc(items.sortOrder), asc(items.name)),
    tx
      .select({
        id: serials.id,
        serial: serials.serial,
        itemId: serials.itemId,
        location: serials.location,
        unitId: serials.unitId,
        condition: serials.condition,
        vehicle: serials.vehicle,
        notes: serials.notes,
      })
      .from(serials)
      .where(opts.returned ? undefined : ne(serials.location, "brigade")),
    tx.select().from(holders),
    tx.select({ itemId: stock.itemId, unitId: stock.unitId, qty: stock.qty }).from(stock).where(isNotNull(stock.unitId)),
    tx.select({ vehicleId: vehicleStock.vehicleId, itemId: vehicleStock.itemId, qty: vehicleStock.qty }).from(vehicleStock),
    tx.select({ parentItemId: kits.parentItemId, itemId: kits.itemId, qty: kits.qty }).from(kits).orderBy(asc(kits.sortOrder)),
    tx.select().from(settings).limit(1),
  ]);

  const personIds = [...new Set(holderRows.flatMap((h) => [h.signerPersonId, h.holderPersonId]).filter((id): id is string => Boolean(id)))];
  const byUnit = unitsById(units);
  const ppl = new Map<string, KPerson>();
  if (personIds.length) {
    for (const p of await tx.select({ id: people.id, fullName: people.fullName, unitId: people.unitId, active: people.active }).from(people).where(inArray(people.id, personIds))) {
      const { company, platoon } = placement(p.unitId, byUnit);
      ppl.set(p.id, { id: p.id, name: p.fullName, companyId: company?.id ?? null, platoonName: platoon?.name ?? null, active: p.active });
    }
  }
  const person = (id: string | null) => (id ? (ppl.get(id) ?? { id, name: "—", companyId: null, platoonName: null, active: false }) : null);
  const holderBySerial = new Map(
    holderRows.map((h) => [
      h.serialId,
      { unitId: h.unitId, signer: person(h.signerPersonId), signerRole: h.signerRole, holder: person(h.holderPersonId), holderRole: h.holderRole, frame: h.frame },
    ]),
  );

  const itemsById = new Map(itemRows.map((i) => [i.id, i]));
  const kitMap = new Map<string, KesherKitLine[]>();
  for (const k of kitRows) {
    const parent = itemsById.get(k.parentItemId)?.name;
    const child = itemsById.get(k.itemId)?.name;
    if (parent && child) kitMap.set(parent, [...(kitMap.get(parent) ?? []), { item: child, qty: k.qty }]);
  }

  // the warehouse is what is left of מלאי כללי after the companies and the vehicles
  const stockMap = new Map(stockRows.map((r) => [stockKey(r.itemId, r.unitId), r.qty]));
  const signed = new Map<string, number>();
  for (const r of [...stockRows, ...vehicleRows]) signed.set(r.itemId, (signed.get(r.itemId) ?? 0) + r.qty);
  const vehicleStockMap = new Map<string, Map<string, number>>();
  for (const r of vehicleRows) vehicleStockMap.set(r.vehicleId, (vehicleStockMap.get(r.vehicleId) ?? new Map()).set(r.itemId, r.qty));
  const warehouse = new Map<string, ReturnType<typeof warehouseStock>>();
  for (const i of itemRows) {
    if (i.kind !== "bulk") continue;
    const w = warehouseStock(i.brigadeQty, signed.get(i.id) ?? 0, i.brokenQty);
    warehouse.set(i.id, w);
    stockMap.set(stockKey(i.id, null), w.qty);
  }

  return {
    items: itemRows,
    itemsById,
    serials: serialRows
      .map((s) => ({ ...s, itemName: itemsById.get(s.itemId)?.name ?? "", holder: holderBySerial.get(s.id) ?? null }))
      .sort((a, b) => byHe(a.itemName, b.itemName) || a.serial.localeCompare(b.serial, "en", { numeric: true })),
    stock: stockMap,
    available: (itemId) => warehouse.get(itemId)?.available ?? 0,
    vehicleStock: vehicleStockMap,
    kits: kitMap,
    staleDays: cfg?.checkStaleDays ?? 7,
    warnDays: cfg?.eyeWarnDays ?? 3,
    alertDays: cfg?.eyeAlertDays ?? 7,
  };
}

/** דוח 1's vehicles (active first, by number) with their standby teams of the active round. */
export async function loadVehicles(tx: Tx): Promise<KVehicle[]> {
  const rows = await tx.execute<{ id: string; number: string; kind: string | null; state: string; active: boolean; standby: string | null }>(
    sql`select id, number, kind, state, active, standby from app.kesher_vehicles()`,
  );
  return [...rows].sort((a, b) => Number(b.active) - Number(a.active) || a.number.localeCompare(b.number, "en", { numeric: true }));
}

/** "812345 · האמר · חפ״ק מג״ד" */
export const vehicleLabel = (v: KVehicle) => [v.number, v.kind, v.standby].filter(Boolean).join(" · ") + (v.active ? "" : " (לא פעיל)");

export interface EyeCheck {
  at: Date;
  byName: string | null;
}

/** צהוב בעיניים: the newest check of each צ׳. */
export async function loadLastEye(tx: Tx): Promise<Map<string, EyeCheck>> {
  const rows = await tx
    .selectDistinctOn([eyeChecks.serialId], { serialId: eyeChecks.serialId, at: eyeChecks.at, byName: eyeChecks.byName })
    .from(eyeChecks)
    .orderBy(eyeChecks.serialId, desc(eyeChecks.at));
  return new Map(rows.map((r) => [r.serialId, { at: r.at, byName: r.byName }]));
}

export interface KKitLine {
  id: string;
  parentItemId: string;
  itemId: string;
  qty: number;
}

/** The תקן lines with their ids (editing), in display order. */
export async function loadKitLines(tx: Tx): Promise<KKitLine[]> {
  return tx.select({ id: kits.id, parentItemId: kits.parentItemId, itemId: kits.itemId, qty: kits.qty }).from(kits).orderBy(asc(kits.sortOrder), asc(kits.createdAt));
}

/** The newest דוח צ׳ of each company the user covers. */
export async function loadLastChecks(tx: Tx): Promise<Map<string, KCheck>> {
  const rows = await tx
    .selectDistinctOn([checks.unitId], {
      id: checks.id,
      unitId: checks.unitId,
      at: checks.at,
      reporterName: checks.reporterName,
      total: checks.total,
      found: checks.found,
      note: checks.note,
    })
    .from(checks)
    .orderBy(checks.unitId, desc(checks.at));
  return new Map(rows.map((r) => [r.unitId, r]));
}

/** For each צ׳ the user may see a report of: its newest check line ("נראה בעין" or "לא נמצא"). */
export async function loadLastSeen(tx: Tx): Promise<Map<string, LastSeen>> {
  const rows = await tx
    .selectDistinctOn([checkLines.serialId], { serialId: checkLines.serialId, found: checkLines.found, at: checks.at })
    .from(checkLines)
    .innerJoin(checks, eq(checks.id, checkLines.checkId))
    .where(sql`${checkLines.serialId} is not null`)
    .orderBy(checkLines.serialId, desc(checks.at));
  return new Map(rows.map((r) => [r.serialId!, { at: r.at, found: r.found }]));
}

/** The צ׳ a report didn't find. */
export async function loadMissing(tx: Tx, checkId: string): Promise<{ serial: string; item: string | null }[]> {
  return tx
    .select({ serial: checkLines.serial, item: checkLines.item })
    .from(checkLines)
    .where(and(eq(checkLines.checkId, checkId), eq(checkLines.found, false)))
    .orderBy(asc(checkLines.serial));
}

export function companyStatus(last: KCheck | undefined, staleDays: number, now = new Date()): CheckStatus {
  return checkStatus(last ? { at: last.at, total: last.total, found: last.found } : null, now, staleDays);
}

/** Total ציוד משלים quantity on a place (warehouse = null). */
export function placeTotal(data: KesherData, unitId: string | null): number {
  let n = 0;
  for (const i of data.items) if (i.kind === "bulk") n += data.stock.get(stockKey(i.id, unitId)) ?? 0;
  return n;
}

export function groupBy<T, K>(list: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const t of list) {
    const k = key(t);
    out.set(k, [...(out.get(k) ?? []), t]);
  }
  return out;
}
