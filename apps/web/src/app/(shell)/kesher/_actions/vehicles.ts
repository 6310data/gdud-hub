"use server";
/**
 * ציוד על רכבים: which vehicle (the sheet's האמר column) a צ׳ is mounted on. A battalion kesher
 * admin only (kesher_serials updates are admin-only in 0018_kesher_security.sql). Mounting never
 * moves the צ׳ between the warehouse and the companies; each change is a `serial_edit` event.
 */
import { z } from "zod";
import { inArray, schema, withUser } from "@gdud/db";
import { actionError, UserError, type ActionOutcome } from "@/lib/action-result";
import { firstIssue, kesherCtx, NO_PERMISSION, revalidateKesher, uuid } from "./common";

const { kesherSerials: serials, kesherItems: items, kesherEvents: events } = schema;

const vehicleSchema = z
  .object({
    vehicle: z
      .string()
      .trim()
      .max(40, "מספר רכב עד 40 תווים")
      .nullish()
      .transform((s) => s?.replace(/\s+/g, " ") || null),
    /** put on `vehicle` */
    serialIds: z.array(uuid).max(200, "יותר מדי צ׳ בבת אחת").default([]),
    /** take off their vehicle */
    removeIds: z.array(uuid).max(200, "יותר מדי צ׳ בבת אחת").default([]),
  })
  .refine((v) => v.serialIds.length + v.removeIds.length > 0, "לא נבחרו צ׳")
  .refine((v) => !v.serialIds.length || v.vehicle, "חסר מספר רכב")
  .refine((v) => !v.serialIds.some((id) => v.removeIds.includes(id)), "צ׳ גם מתווסף וגם מוסר");

export async function setVehicle(input: z.input<typeof vehicleSchema>): Promise<ActionOutcome<{ changed: number }>> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  if (!ctx.access.isAdmin) return { error: "רק מנהל קשר גדודי משייך צ׳ לרכב." };
  const parsed = vehicleSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { vehicle, serialIds, removeIds } = parsed.data;
  const target = new Map<string, string | null>([...serialIds.map((id) => [id, vehicle] as const), ...removeIds.map((id) => [id, null] as const)]);
  const { s } = ctx;
  const companyName = new Map(s.units.map((u) => [u.id, u.name]));

  try {
    const changed = await withUser(s.claims, async (tx) => {
      const rows = await tx
        .select({ id: serials.id, serial: serials.serial, vehicle: serials.vehicle, unitId: serials.unitId, itemId: serials.itemId })
        .from(serials)
        .where(inArray(serials.id, [...target.keys()]));
      if (rows.length !== target.size) throw new UserError("אחד הצ׳ לא נמצא — רעננו את הדף");
      const todo = rows.filter((r) => r.vehicle !== target.get(r.id));
      if (!todo.length) return 0;
      for (const v of new Set(todo.map((r) => target.get(r.id) ?? null))) {
        const ids = todo.filter((r) => (target.get(r.id) ?? null) === v).map((r) => r.id);
        await tx.update(serials).set({ vehicle: v }).where(inArray(serials.id, ids));
      }
      const itemName = new Map((await tx.select({ id: items.id, name: items.name }).from(items)).map((i) => [i.id, i.name]));
      await tx.insert(events).values(
        todo.map((r) => ({
          kind: "serial_edit" as const,
          unitId: r.unitId,
          company: r.unitId ? (companyName.get(r.unitId) ?? null) : null,
          item: itemName.get(r.itemId) ?? null,
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
