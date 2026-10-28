import "server-only";
/**
 * Shared by the actions that move equipment (moves.ts, stock.ts, vehicles.ts): what is signed out
 * of each ציוד משלים item, the warehouse it leaves, and the date of a backdated move.
 *
 * The warehouse is never stored: it is מלאי כללי (kesher_items.brigade_qty) minus what the companies
 * (kesher_stock rows with a unit) and the vehicles (kesher_vehicle_stock) hold; of it, broken_qty is
 * תקול and can't be signed out.
 */
import { z } from "zod";
import { addDays, israelToday, warehouseStock } from "@gdud/core";
import { and, eq, inArray, isNotNull, schema, type Tx } from "@gdud/db";
import { UserError } from "@/lib/action-result";

const { kesherItems: items, kesherStock: stock, kesherVehicleStock: vehicleStock } = schema;

/** item id → what the companies and the vehicles hold of it. */
export async function signedQty(tx: Tx, itemIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!itemIds.length) return out;
  const [companies, vehicles] = await Promise.all([
    tx.select({ itemId: stock.itemId, qty: stock.qty }).from(stock).where(and(inArray(stock.itemId, [...itemIds]), isNotNull(stock.unitId))),
    tx.select({ itemId: vehicleStock.itemId, qty: vehicleStock.qty }).from(vehicleStock).where(inArray(vehicleStock.itemId, [...itemIds])),
  ]);
  for (const r of [...companies, ...vehicles]) out.set(r.itemId, (out.get(r.itemId) ?? 0) + r.qty);
  return out;
}

export interface BulkItem {
  id: string;
  name: string;
  brigadeQty: number | null;
  brokenQty: number;
  /** in the warehouse, תקול included */
  warehouse: number;
  /** in the warehouse and תקין: what can be signed out */
  available: number;
}

/**
 * The ציוד משלים items of a move, locked for the transaction (two החתמות of the same item wait for
 * each other, so neither signs out what the other just took). Throws on an unknown or non-bulk item.
 */
export async function lockBulk(tx: Tx, itemIds: readonly string[]): Promise<Map<string, BulkItem>> {
  const ids = [...new Set(itemIds)];
  if (!ids.length) return new Map();
  const rows = await tx
    .select({ id: items.id, name: items.name, kind: items.kind, brigadeQty: items.brigadeQty, brokenQty: items.brokenQty })
    .from(items)
    .where(inArray(items.id, ids))
    .orderBy(items.id)
    .for("update");
  if (rows.length !== ids.length) throw new UserError("אחד הפריטים לא נמצא — רעננו את הדף");
  const signed = await signedQty(tx, ids);
  const out = new Map<string, BulkItem>();
  for (const r of rows) {
    if (r.kind !== "bulk") throw new UserError(`"${r.name}" אינו ציוד משלים`);
    const w = warehouseStock(r.brigadeQty, signed.get(r.id) ?? 0, r.brokenQty);
    out.set(r.id, { id: r.id, name: r.name, brigadeQty: r.brigadeQty, brokenQty: r.brokenQty, warehouse: w.qty, available: w.available });
  }
  return out;
}

/** Add `delta` to a company's quantity of an item (the row is created on first use). Never below 0. */
export async function addCompanyStock(tx: Tx, itemId: string, unitId: string, delta: number, label: string): Promise<void> {
  if (!delta) return;
  const where = and(eq(stock.itemId, itemId), eq(stock.unitId, unitId));
  const [row] = await tx.select({ id: stock.id, qty: stock.qty }).from(stock).where(where);
  const next = (row?.qty ?? 0) + delta;
  if (next < 0) throw new UserError(`${label}: לפלוגה יש רק ${row?.qty ?? 0}`);
  if (row) await tx.update(stock).set({ qty: next }).where(eq(stock.id, row.id));
  else await tx.insert(stock).values({ itemId, unitId, qty: next });
}

/** A company's quantities of some items. */
export async function companyQty(tx: Tx, unitId: string, itemIds: readonly string[]): Promise<Map<string, number>> {
  if (!itemIds.length) return new Map();
  const rows = await tx
    .select({ itemId: stock.itemId, qty: stock.qty })
    .from(stock)
    .where(and(eq(stock.unitId, unitId), inArray(stock.itemId, [...itemIds])));
  return new Map(rows.map((r) => [r.itemId, r.qty]));
}

/** The oldest day a move may be dated back to. */
const BACKDATE_DAYS = 365;

/** yyyy-mm-dd (Israel day) of the move; blank = now. */
export const moveDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "תאריך לא תקין")
  .nullish()
  .transform((s) => s || null);

/**
 * When a move happened: today (or no date) → now; an earlier day → that day at noon, marked
 * "רטרואקטיבי" in the יומן. A future day, or one more than a year back, is refused.
 */
export function moveAt(day: string | null, now = new Date()): { at: Date; backdated: boolean } {
  const today = israelToday(now);
  if (!day || day === today) return { at: now, backdated: false };
  if (day > today) throw new UserError("תאריך עתידי — אפשר לרשום רק פעולה שכבר קרתה");
  if (day < addDays(today, -BACKDATE_DAYS)) throw new UserError("התאריך רחוק מדי (עד שנה אחורה)");
  return { at: new Date(`${day}T10:00:00Z`), backdated: true };
}

/** A soldier's name (any the caller may see), for the יומן. */
export async function personName(tx: Tx, personId: string | null): Promise<string | null> {
  if (!personId) return null;
  const [p] = await tx.select({ name: schema.people.fullName }).from(schema.people).where(eq(schema.people.id, personId));
  return p?.name ?? null;
}

/** "3 × סוללה" */
export const qtyText = (qty: number, name: string) => `${qty} × ${name}`;
