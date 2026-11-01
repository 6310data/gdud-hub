"use server";
/**
 * ציוד על רכבים, battalion kesher admin only (kesher_serials and kesher_vehicle_stock writes are
 * admin-only in 0018 / 0025_kesher_*_security.sql). The vehicle always comes from דוח 1's list
 * (app.kesher_vehicles()):
 *
 *   setVehicle       which צ׳ are mounted on it (the צ׳'s `vehicle` keeps its number). Mounting never
 *                    moves a צ׳ between the warehouse and the companies: a company's vehicle takes only
 *                    the company's צ׳ — warehouse צ׳ are signed to the company first (החתמה with the
 *                    vehicle, moves.ts). `serial_edit` events.
 *   setVehicleStock  its ציוד משלים quantities. On a company's vehicle they are part of the company's
 *                    quantity (app.company_vehicle_stock, 0041); on a battalion vehicle they come out of
 *                    the warehouse, so an increase needs that many תקינים there. `vehicle_stock` events.
 */
import { z } from "zod";
import { and, eq, inArray, schema, sql, withUser } from "@gdud/db";
import { loadVehicles } from "@/lib/kesher/data";
import { actionError, UserError, type ActionOutcome } from "@/lib/action-result";
import { firstIssue, kesherCtx, NO_PERMISSION, revalidateKesher, uuid } from "./common";
import { lockBulk } from "./moves-common";

const { kesherSerials: serials, kesherItems: items, kesherEvents: events, kesherVehicleStock: vehicleStock } = schema;

const ADMIN_ONLY = { error: "רק מנהל קשר גדודי משייך ציוד לרכב." } as const;

const vehicleSchema = z
  .object({
    /** a vehicle of דוח 1's list */
    vehicleId: uuid.nullish(),
    /** put on the vehicle */
    serialIds: z.array(uuid).max(200, "יותר מדי צ׳ בבת אחת").default([]),
    /** take off their vehicle */
    removeIds: z.array(uuid).max(200, "יותר מדי צ׳ בבת אחת").default([]),
  })
  .refine((v) => v.serialIds.length + v.removeIds.length > 0, "לא נבחרו צ׳")
  .refine((v) => !v.serialIds.length || v.vehicleId, "בחרו רכב מהרשימה")
  .refine((v) => !v.serialIds.some((id) => v.removeIds.includes(id)), "צ׳ גם מתווסף וגם מוסר");

export async function setVehicle(input: z.input<typeof vehicleSchema>): Promise<ActionOutcome<{ changed: number }>> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  if (!ctx.access.isAdmin) return ADMIN_ONLY;
  const parsed = vehicleSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { vehicleId, serialIds, removeIds } = parsed.data;
  const { s } = ctx;
  const companyName = new Map(s.units.map((u) => [u.id, u.name]));

  try {
    const changed = await withUser(s.claims, async (tx) => {
      const vehicle = vehicleId ? (await loadVehicles(tx)).find((v) => v.id === vehicleId) : null;
      if (vehicleId && !vehicle) throw new UserError("הרכב לא נמצא ברשימת הרכבים של דוח 1 — רעננו את הדף");
      const target = new Map<string, string | null>([...serialIds.map((id) => [id, vehicle!.number] as const), ...removeIds.map((id) => [id, null] as const)]);
      const rows = await tx
        .select({ id: serials.id, serial: serials.serial, vehicle: serials.vehicle, location: serials.location, unitId: serials.unitId, item: items.name })
        .from(serials)
        .innerJoin(items, eq(items.id, serials.itemId))
        .where(inArray(serials.id, [...target.keys()]));
      if (rows.length !== target.size) throw new UserError("אחד הצ׳ לא נמצא — רעננו את הדף");
      // a company's vehicle takes only the company's צ׳ (the warehouse's are signed to it first)
      const foreign = vehicle?.unitId ? rows.filter((r) => serialIds.includes(r.id) && (r.location !== "company" || r.unitId !== vehicle.unitId)) : [];
      if (foreign.length)
        throw new UserError(foreign.map((r) => `הצ׳ ${r.serial} (${r.item}) לא חתום על ${companyName.get(vehicle!.unitId!) ?? "הפלוגה"} — מחתימים אותו לפלוגה קודם`).join("\n"));
      const todo = rows.filter((r) => r.vehicle !== target.get(r.id));
      if (!todo.length) return 0;
      for (const v of new Set(todo.map((r) => target.get(r.id) ?? null))) {
        const ids = todo.filter((r) => (target.get(r.id) ?? null) === v).map((r) => r.id);
        await tx.update(serials).set({ vehicle: v }).where(inArray(serials.id, ids));
      }
      await tx.insert(events).values(
        todo.map((r) => ({
          kind: "serial_edit" as const,
          unitId: r.unitId,
          company: r.unitId ? (companyName.get(r.unitId) ?? null) : null,
          item: r.item,
          serial: r.serial,
          details: `רכב: ${r.vehicle ?? "ללא"} ← ${target.get(r.id) ?? "ללא"}`,
        })),
      );
      return todo.length;
    });
    revalidateKesher();
    return { ok: true, data: { changed } };
  } catch (e) {
    return { error: actionError(e) };
  }
}

const companyStockSchema = z.object({
  vehicleId: uuid,
  itemId: uuid,
  qty: z.number({ error: "כמות לא תקינה" }).int("כמות שלמה בלבד").min(0, "כמות לא יכולה להיות שלילית").max(9999, "כמות גדולה מדי"),
});

/**
 * שיוך לרכב from a company's ציוד משלים table: anyone covering the company sets an item's quantity on
 * one of the company's vehicles, out of the company's free quantity (app.company_vehicle_stock checks
 * the role, the company and the quantity again and writes the יומן row).
 */
export async function setCompanyVehicleStock(input: z.input<typeof companyStockSchema>): Promise<ActionOutcome<{ changed: number }>> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = companyStockSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { vehicleId, itemId, qty } = parsed.data;

  try {
    await withUser(ctx.s.claims, async (tx) => {
      const vehicle = (await loadVehicles(tx)).find((v) => v.id === vehicleId);
      if (!vehicle?.unitId) throw new UserError("הרכב לא של פלוגה — רעננו את הדף");
      if (!ctx.access.covers(vehicle.unitId)) throw new UserError(NO_PERMISSION.error);
      await tx.execute(sql`select app.company_vehicle_stock(${vehicleId}::uuid, ${itemId}::uuid, ${qty})`);
    });
    revalidateKesher();
    return { ok: true, data: { changed: 1 } };
  } catch (e) {
    return { error: actionError(e) };
  }
}

const vehicleStockSchema = z.object({
  vehicleId: uuid,
  /** the vehicle's new quantities; 0 = none. Items not listed stay as they are. */
  lines: z
    .array(z.object({ itemId: uuid, qty: z.number({ error: "כמות לא תקינה" }).int("כמות שלמה בלבד").min(0, "כמות לא יכולה להיות שלילית").max(9999, "כמות גדולה מדי") }))
    .min(1, "אין מה לשמור")
    .max(200),
});

/**
 * The ציוד משלים on a vehicle. A company's vehicle: out of the company's free quantity (the SQL
 * function checks and logs it). A battalion vehicle: an increase comes out of the warehouse's תקין,
 * a decrease goes back.
 */
export async function setVehicleStock(input: z.input<typeof vehicleStockSchema>): Promise<ActionOutcome<{ changed: number }>> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  if (!ctx.access.isAdmin) return ADMIN_ONLY;
  const parsed = vehicleStockSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { vehicleId, lines } = parsed.data;

  try {
    const changed = await withUser(ctx.s.claims, async (tx) => {
      const vehicle = (await loadVehicles(tx)).find((v) => v.id === vehicleId);
      if (!vehicle) throw new UserError("הרכב לא נמצא ברשימת הרכבים של דוח 1 — רעננו את הדף");
      const current = await tx.select({ itemId: vehicleStock.itemId, qty: vehicleStock.qty, unitId: vehicleStock.unitId }).from(vehicleStock).where(eq(vehicleStock.vehicleId, vehicleId));
      if (vehicle.unitId) {
        const before = new Map(current.map((r) => [r.itemId, r.qty]));
        // one item lock per call, always in the same order (two saves never wait on each other)
        const todo = lines.filter((l) => (before.get(l.itemId) ?? 0) !== l.qty).sort((a, b) => a.itemId.localeCompare(b.itemId));
        for (const l of todo) await tx.execute(sql`select app.company_vehicle_stock(${vehicleId}::uuid, ${l.itemId}::uuid, ${l.qty})`);
        return todo.length;
      }
      const bulk = await lockBulk(tx, lines.map((l) => l.itemId));
      const have = new Map(current.filter((r) => !r.unitId).map((r) => [r.itemId, r.qty]));
      if (current.some((r) => r.unitId && lines.some((l) => l.itemId === r.itemId))) throw new UserError("על הרכב יש ציוד של פלוגה — מעדכנים אותו מהפלוגה");
      const log: (typeof events.$inferInsert)[] = [];
      const errors: string[] = [];
      for (const l of lines) {
        const it = bulk.get(l.itemId)!;
        const before = have.get(l.itemId) ?? 0;
        if (l.qty - before > it.available) errors.push(`${it.name}: במחסן ${Math.max(0, it.available)} תקינים, ביקשת להוסיף ${l.qty - before}`);
      }
      if (errors.length) throw new UserError(errors.join("\n"));
      for (const l of lines) {
        const it = bulk.get(l.itemId)!;
        const before = have.get(l.itemId) ?? 0;
        if (before === l.qty) continue;
        const where = and(eq(vehicleStock.vehicleId, vehicleId), eq(vehicleStock.itemId, l.itemId));
        if (!l.qty) await tx.delete(vehicleStock).where(where);
        else if (before) await tx.update(vehicleStock).set({ qty: l.qty }).where(where);
        else await tx.insert(vehicleStock).values({ vehicleId, itemId: l.itemId, qty: l.qty });
        log.push({ kind: "vehicle_stock", item: it.name, qty: l.qty, details: `רכב ${vehicle.number}: ${before} ← ${l.qty}` });
      }
      if (log.length) await tx.insert(events).values(log);
      return log.length;
    });
    revalidateKesher();
    return { ok: true, data: { changed } };
  } catch (e) {
    return { error: actionError(e) };
  }
}
