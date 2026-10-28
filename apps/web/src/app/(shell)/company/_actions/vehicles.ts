"use server";
/**
 * רכבים: the company admin edits the kesher gear on the company's vehicles (call 34) through
 * app.company_vehicle_mount / company_vehicle_stock, which check that the vehicle and the צ׳ are the
 * company's, keep the kesher warehouse rule and write kesher's own events — kesher sees each change.
 */
import { z } from "zod";
import { sql, withUser } from "@gdud/db";
import type { ActionResult } from "@/lib/action-result";
import { companyError } from "@/lib/company/errors";
import { companyCtx, firstIssue, NO_PERMISSION, revalidateCompany, uuid } from "./common";

const mountSchema = z.object({ unitId: uuid, vehicleId: uuid, serialId: uuid, on: z.boolean() });

export async function mountSerial(input: z.input<typeof mountSchema>): Promise<ActionResult> {
  const ctx = await companyCtx();
  const parsed = mountSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { unitId, vehicleId, serialId, on } = parsed.data;
  if (!ctx?.access.scope(unitId)?.isAdmin) return NO_PERMISSION;
  try {
    await withUser(ctx.s.claims, (tx) => tx.execute(sql`select app.company_vehicle_mount(${vehicleId}::uuid, ${serialId}::uuid, ${on})`));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}

const qtySchema = z.object({
  unitId: uuid,
  vehicleId: uuid,
  itemId: uuid,
  qty: z.number({ error: "כמות לא תקינה" }).int("כמות שלמה בלבד").min(0, "כמות לא יכולה להיות שלילית").max(9999, "כמות גדולה מדי"),
});

export async function setVehicleQty(input: z.input<typeof qtySchema>): Promise<ActionResult> {
  const ctx = await companyCtx();
  const parsed = qtySchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { unitId, vehicleId, itemId, qty } = parsed.data;
  if (!ctx?.access.scope(unitId)?.isAdmin) return NO_PERMISSION;
  try {
    await withUser(ctx.s.claims, (tx) => tx.execute(sql`select app.company_vehicle_stock(${vehicleId}::uuid, ${itemId}::uuid, ${qty})`));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}
