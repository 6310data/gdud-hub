"use server";
/**
 * ציוד משלים: quantities per place and the item's מלאי כללי (brigade_qty), and the תקן lines. A
 * battalion kesher admin only (kesher_stock, kesher_items and kesher_kit_items writes are admin-only
 * in 0018_kesher_security.sql; kesher_stock_guard and kesher_kit_guard check kinds, the warehouse
 * floor and cycles). Every change is a `stock_edit` / `kit_edit` event.
 */
import { z } from "zod";
import { and, eq, inArray, isNull, schema, withUser } from "@gdud/db";
import { actionError, UserError, type ActionOutcome } from "@/lib/action-result";
import { firstIssue, kesherCtx, NO_PERMISSION, revalidateKesher, uuid } from "./common";

const { kesherStock: stock, kesherItems: items, kesherKitItems: kits, kesherEvents: events } = schema;

const ADMIN_ONLY = { error: "רק מנהל קשר גדודי מעדכן ציוד משלים ותקן." } as const;
const qty = z.number({ error: "כמות לא תקינה" }).int("כמות שלמה בלבד").min(-9999).max(99999, "כמות גדולה מדי");

const stockSchema = z.object({
  rows: z
    .array(
      z.object({
        itemId: uuid,
        /** undefined = unchanged; null = clear */
        brigadeQty: z.number().int("כמות שלמה בלבד").min(0, "מלאי כללי לא יכול להיות שלילי").max(99999).nullish(),
        /** unitId null = the warehouse */
        cells: z.array(z.object({ unitId: uuid.nullable(), qty })).max(50).default([]),
      }),
    )
    .min(1, "אין מה לשמור")
    .max(500, "יותר מדי פריטים בבת אחת"),
});

/** "עדכון כמויות": the changed cells and מלאי כללי of one or more ציוד משלים items. */
export async function saveStock(input: z.input<typeof stockSchema>): Promise<ActionOutcome<{ changed: number }>> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  if (!ctx.access.isAdmin) return ADMIN_ONLY;
  const parsed = stockSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { rows } = parsed.data;
  const { s } = ctx;
  const companyName = new Map(s.units.filter((u) => u.kind === "company").map((u) => [u.id, u.name]));
  for (const c of rows.flatMap((r) => r.cells)) {
    if (c.unitId && !companyName.has(c.unitId)) return { error: "פלוגה לא מוכרת — רעננו את הדף" };
    if (c.unitId && c.qty < 0) return { error: "כמות בפלוגה לא יכולה להיות שלילית" };
  }

  try {
    const changed = await withUser(s.claims, async (tx) => {
      const ids = [...new Set(rows.map((r) => r.itemId))];
      const itemRows = await tx.select({ id: items.id, name: items.name, kind: items.kind, brigadeQty: items.brigadeQty }).from(items).where(inArray(items.id, ids));
      const byId = new Map(itemRows.map((i) => [i.id, i]));
      const have = new Map(
        (await tx.select({ itemId: stock.itemId, unitId: stock.unitId, qty: stock.qty }).from(stock).where(inArray(stock.itemId, ids))).map((r) => [
          `${r.itemId}|${r.unitId ?? ""}`,
          r.qty,
        ]),
      );
      const log: (typeof events.$inferInsert)[] = [];
      for (const r of rows) {
        const item = byId.get(r.itemId);
        if (!item) throw new UserError("אחד הפריטים לא נמצא — רעננו את הדף");
        if (item.kind !== "bulk") throw new UserError(`"${item.name}" אינו ציוד משלים`);
        if (r.brigadeQty !== undefined && r.brigadeQty !== item.brigadeQty) {
          await tx.update(items).set({ brigadeQty: r.brigadeQty }).where(eq(items.id, item.id));
          log.push({ kind: "stock_edit", item: item.name, qty: r.brigadeQty, details: `מלאי כללי: ${item.brigadeQty ?? "—"} ← ${r.brigadeQty ?? "—"}` });
        }
        for (const c of r.cells) {
          const before = have.get(`${item.id}|${c.unitId ?? ""}`) ?? 0;
          if (before === c.qty) continue;
          const where = and(eq(stock.itemId, item.id), c.unitId ? eq(stock.unitId, c.unitId) : isNull(stock.unitId));
          const updated = await tx.update(stock).set({ qty: c.qty }).where(where).returning({ id: stock.id });
          if (!updated.length) await tx.insert(stock).values({ itemId: item.id, unitId: c.unitId, qty: c.qty });
          const place = c.unitId ? companyName.get(c.unitId)! : "מחסן";
          log.push({
            kind: "stock_edit",
            unitId: c.unitId,
            company: c.unitId ? place : null,
            item: item.name,
            qty: c.qty,
            details: `${place}: ${before} ← ${c.qty}`,
          });
        }
      }
      if (log.length) await tx.insert(events).values(log);
      return log.length;
    });
    revalidateKesher();
    return { ok: true, data: { changed } };
  } catch (e) {
    return { error: stockError(e) };
  }
}

/** The warehouse floor (kesher_stock_guard) is the likely 23514 here. */
function stockError(e: unknown): string {
  const msg = actionError(e);
  return msg === "אחד השדות לא בפורמט הנכון." ? "כמות לא תקינה (במחסן מנוהל הכמות לא יורדת מתחת לאפס)." : msg;
}

const kitQty = z.number({ error: "כמות לא תקינה" }).int("כמות שלמה בלבד").min(1, "כמות ליחידה: 1 עד 99").max(99, "כמות ליחידה: 1 עד 99");
const kitSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), parentItemId: uuid, itemId: uuid, qty: kitQty }),
  z.object({ op: z.literal("qty"), kitId: uuid, qty: kitQty }),
  z.object({ op: z.literal("remove"), kitId: uuid }),
]);
export type KitChange = z.input<typeof kitSchema>;

/** תקן ציוד משלים: add a line (parent → ציוד משלים × qty), change its qty, or remove it. */
export async function saveKit(input: KitChange): Promise<ActionOutcome<null>> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  if (!ctx.access.isAdmin) return ADMIN_ONLY;
  const parsed = kitSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const v = parsed.data;

  try {
    await withUser(ctx.s.claims, async (tx) => {
      const itemRows = await tx.select({ id: items.id, name: items.name, kind: items.kind }).from(items);
      const byId = new Map(itemRows.map((i) => [i.id, i]));
      const lines = await tx.select({ id: kits.id, parentItemId: kits.parentItemId, itemId: kits.itemId, qty: kits.qty, sortOrder: kits.sortOrder }).from(kits);
      const name = (id: string) => byId.get(id)?.name ?? "—";

      if (v.op === "add") {
        const parent = byId.get(v.parentItemId);
        const child = byId.get(v.itemId);
        if (!parent || !child) throw new UserError("הפריט לא נמצא — רעננו את הדף");
        if (child.kind !== "bulk") throw new UserError(`"${child.name}" אינו ציוד משלים`);
        if (parent.id === child.id) throw new UserError("פריט לא יכול להיות בתקן של עצמו");
        if (lines.some((l) => l.parentItemId === parent.id && l.itemId === child.id)) throw new UserError(`"${child.name}" כבר בתקן של ${parent.name}`);
        // the cascade must end: the parent may not be reachable from the child
        const below = new Set<string>();
        const walk = (id: string) => {
          for (const l of lines) {
            if (l.parentItemId !== id || below.has(l.itemId)) continue;
            below.add(l.itemId);
            walk(l.itemId);
          }
        };
        walk(child.id);
        if (below.has(parent.id)) throw new UserError(`"${child.name}" כבר כולל את ${parent.name} בתקן שלו — זה היה יוצר תקן מעגלי`);
        const sortOrder = Math.max(-1, ...lines.filter((l) => l.parentItemId === parent.id).map((l) => l.sortOrder)) + 1;
        await tx.insert(kits).values({ parentItemId: parent.id, itemId: child.id, qty: v.qty, sortOrder });
        await tx.insert(events).values({ kind: "kit_edit", item: parent.name, qty: v.qty, details: `נוסף לתקן: ${child.name} ×${v.qty}` });
        return;
      }

      const line = lines.find((l) => l.id === v.kitId);
      if (!line) throw new UserError("השורה לא נמצאה — רעננו את הדף");
      if (v.op === "qty") {
        if (line.qty === v.qty) return;
        await tx.update(kits).set({ qty: v.qty }).where(eq(kits.id, line.id));
        await tx.insert(events).values({ kind: "kit_edit", item: name(line.parentItemId), qty: v.qty, details: `${name(line.itemId)}: ×${line.qty} ← ×${v.qty}` });
      } else {
        await tx.delete(kits).where(eq(kits.id, line.id));
        await tx.insert(events).values({ kind: "kit_edit", item: name(line.parentItemId), qty: null, details: `הוסר מהתקן: ${name(line.itemId)} ×${line.qty}` });
      }
    });
    revalidateKesher();
    return { ok: true, data: null };
  } catch (e) {
    return { error: actionError(e) };
  }
}
