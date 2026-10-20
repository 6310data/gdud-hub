"use server";
/** מחסן: item types, kit standards, adding/removing serials, condition changes. */
import { redirect } from "next/navigation";
import { z } from "zod";
import { cleanKit, CONDITION_LABEL, kitToString, LOGISTICS_CONDITIONS, parseSerialList, type Condition } from "@gdud/core";
import { eq, inArray, schema, withUser, type Tx } from "@gdud/db";
import { actionError, UserError, type ActionResult } from "@/lib/action-result";
import { loadHeldSerialIds } from "@/lib/logistics/data";
import { firstIssue, kitList, logEvents, logisticsCtx, NO_PERMISSION, optionalText, revalidateLogistics, uuid } from "./common";

const { logisticsItems: items, logisticsKitItems: kitItems, logisticsSerials: serials } = schema;

/** Stock changes are battalion-level: only a battalion-wide logistics admin. */
async function stockCtx() {
  const ctx = await logisticsCtx();
  return ctx?.access.isStockAdmin ? ctx : null;
}

/* ── item types ──────────────────────────────────────────────────────────── */

const itemSchema = z.object({
  name: z.string().trim().min(1, "חסר שם פריט").max(80, "שם ארוך מדי"),
  category: optionalText(60),
  subcategory: optionalText(60),
  sku: optionalText(40),
});

export async function addItem(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await stockCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = itemSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  let id: string;
  try {
    id = await withUser(ctx.s.claims, async (tx) => {
      const [dup] = await tx.select({ id: items.id }).from(items).where(eq(items.name, v.name));
      if (dup) throw new UserError("הפריט כבר קיים ברשימה");
      const [row] = await tx.insert(items).values(v).returning({ id: items.id });
      await logEvents(tx, ctx.actorName, [
        { kind: "item_add", item: v.name, details: [v.category, v.subcategory].filter(Boolean).join(" / ") || null },
      ]);
      return row!.id;
    });
  } catch (e) {
    return { error: actionError(e) };
  }
  revalidateLogistics();
  redirect(`/logistics/stock?item=${id}`);
}

const kitSchema = z.object({ itemId: uuid, kit: kitList });

/** Replace the accessory standard of one item type. */
export async function saveKit(input: z.input<typeof kitSchema>): Promise<ActionResult> {
  const ctx = await stockCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = kitSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const kit = cleanKit(parsed.data.kit);
  try {
    await withUser(ctx.s.claims, async (tx) => {
      const [item] = await tx.select({ name: items.name }).from(items).where(eq(items.id, parsed.data.itemId));
      if (!item) throw new UserError("הפריט לא נמצא");
      await tx.delete(kitItems).where(eq(kitItems.itemId, parsed.data.itemId));
      if (kit.length) {
        await tx.insert(kitItems).values(kit.map((k, i) => ({ itemId: parsed.data.itemId, name: k.name, qty: k.qty, sortOrder: i })));
      }
      await logEvents(tx, ctx.actorName, [{ kind: "kit", item: item.name, details: kitToString(kit) || "ללא ציוד משלים" }]);
    });
  } catch (e) {
    return { error: actionError(e) };
  }
  revalidateLogistics();
  return { ok: true };
}

/* ── serials ─────────────────────────────────────────────────────────────── */

const addSerialsSchema = z.object({
  itemId: uuid,
  category: optionalText(60),
  condition: z.enum(LOGISTICS_CONDITIONS).default("ok"),
  serials: z.string().max(20_000, "יותר מדי צ׳ים בבת אחת"),
});

export async function addSerials(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await stockCtx();
  if (!ctx) return NO_PERMISSION;
  const parsed = addSerialsSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;
  const list = parseSerialList(v.serials);
  if (!list.length) return { error: "לא הוזנו צ׳ים" };
  if (list.length > 500) return { error: "עד 500 צ׳ים בכל פעם" };
  if (list.some((k) => k.length > 40)) return { error: "צ׳ ארוך מדי (עד 40 תווים)" };
  try {
    await withUser(ctx.s.claims, async (tx) => {
      const [item] = await tx.select({ name: items.name }).from(items).where(eq(items.id, v.itemId));
      if (!item) throw new UserError("הפריט לא נמצא");
      const dup = await tx.select({ serial: serials.serial }).from(serials).where(inArray(serials.serial, list));
      if (dup.length) throw new UserError(`צ׳ים שכבר קיימים: ${dup.map((d) => d.serial).join(", ")}`);
      await tx.insert(serials).values(list.map((serial) => ({ itemId: v.itemId, serial, category: v.category, condition: v.condition })));
      const shown = list.slice(0, 20).join(", ") + (list.length > 20 ? " …" : "");
      await logEvents(tx, ctx.actorName, [
        { kind: "serials_add", item: item.name, details: `${list.length} × ${item.name} · ${CONDITION_LABEL[v.condition]} · ${shown}` },
      ]);
    });
  } catch (e) {
    return { error: actionError(e) };
  }
  revalidateLogistics();
  redirect(`/logistics/stock?item=${v.itemId}`);
}

async function serialRow(tx: Tx, serialId: string) {
  const [row] = await tx
    .select({ id: serials.id, serial: serials.serial, condition: serials.condition, item: items.name })
    .from(serials)
    .innerJoin(items, eq(items.id, serials.itemId))
    .where(eq(serials.id, serialId))
    .for("update", { of: serials });
  if (!row) throw new UserError("הצ׳ לא נמצא");
  return row;
}

/** Change the armory condition of a serial that is NOT signed out (e.g. תקול → תקין). */
export async function setCondition(serialId: string, condition: Condition): Promise<ActionResult> {
  const ctx = await stockCtx();
  if (!ctx) return NO_PERMISSION;
  if (!uuid.safeParse(serialId).success || !(LOGISTICS_CONDITIONS as readonly string[]).includes(condition)) {
    return { error: "קלט לא תקין" };
  }
  try {
    await withUser(ctx.s.claims, async (tx) => {
      const row = await serialRow(tx, serialId);
      if ((await loadHeldSerialIds(tx)).has(serialId)) throw new UserError("הצ׳ מוחתם על חייל – יש לזכות קודם");
      if (row.condition === condition) return;
      await tx.update(serials).set({ condition }).where(eq(serials.id, serialId));
      await logEvents(tx, ctx.actorName, [
        { kind: "condition", item: row.item, serial: row.serial, details: `${CONDITION_LABEL[row.condition]} → ${CONDITION_LABEL[condition]}` },
      ]);
    });
  } catch (e) {
    return { error: actionError(e) };
  }
  revalidateLogistics();
  return { ok: true };
}

/** Delete a serial from the stock (only when not signed out). Its history goes with it; the log keeps text. */
export async function removeSerial(serialId: string): Promise<ActionResult> {
  const ctx = await stockCtx();
  if (!ctx) return NO_PERMISSION;
  if (!uuid.safeParse(serialId).success) return { error: "קלט לא תקין" };
  let itemId: string | undefined;
  try {
    itemId = await withUser(ctx.s.claims, async (tx) => {
      const row = await serialRow(tx, serialId);
      if ((await loadHeldSerialIds(tx)).has(serialId)) throw new UserError("הצ׳ מוחתם על חייל – יש לזכות קודם");
      const [deleted] = await tx.delete(serials).where(eq(serials.id, serialId)).returning({ itemId: serials.itemId });
      await logEvents(tx, ctx.actorName, [{ kind: "serial_remove", item: row.item, serial: row.serial }]);
      return deleted?.itemId;
    });
  } catch (e) {
    return { error: actionError(e) };
  }
  revalidateLogistics();
  redirect(itemId ? `/logistics/stock?item=${itemId}` : "/logistics/stock");
}
