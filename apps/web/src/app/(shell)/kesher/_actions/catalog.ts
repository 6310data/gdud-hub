"use server";
/**
 * The catalogue's categories (battalion kesher admin; kesher_items writes are admin-only in
 * 0018_kesher_security.sql). A device type's category orders the brigade report; a ציוד משלים
 * item's groups the ציוד משלים table. An import never blanks a category.
 */
import { z } from "zod";
import { eq, inArray, schema, withUser } from "@gdud/db";
import { actionError, UserError, type ActionOutcome } from "@/lib/action-result";
import { firstIssue, kesherCtx, NO_PERMISSION, optionalText, revalidateKesher, uuid } from "./common";

const { kesherItems: items, kesherEvents: events } = schema;

const categorySchema = z.object({
  rows: z
    .array(z.object({ itemId: uuid, category: optionalText(40) }))
    .min(1, "אין מה לשמור")
    .max(500),
});

export async function saveCategories(input: z.input<typeof categorySchema>): Promise<ActionOutcome<{ changed: number }>> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  if (!ctx.access.isAdmin) return { error: "רק מנהל קשר גדודי משנה קטגוריות." };
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { rows } = parsed.data;

  try {
    const changed = await withUser(ctx.s.claims, async (tx) => {
      const found = await tx.select({ id: items.id, name: items.name, category: items.category }).from(items).where(inArray(items.id, rows.map((r) => r.itemId)));
      const byId = new Map(found.map((i) => [i.id, i]));
      const log: (typeof events.$inferInsert)[] = [];
      for (const r of rows) {
        const it = byId.get(r.itemId);
        if (!it) throw new UserError("אחד הפריטים לא נמצא — רעננו את הדף");
        if (it.category === r.category) continue;
        await tx.update(items).set({ category: r.category }).where(eq(items.id, it.id));
        log.push({ kind: "kit_edit", item: it.name, details: `קטגוריה: ${it.category ?? "ללא"} ← ${r.category ?? "ללא"}` });
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
