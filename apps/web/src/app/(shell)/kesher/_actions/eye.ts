"use server";
/**
 * צהוב בעיניים: someone of מחלקת הקשר (a battalion kesher admin) saw these צ׳ with their own eyes.
 * One kesher_eye_checks row per צ׳ — who and when are set by the database (kesher_eye_checks_fill,
 * 0025_kesher_phase2_security.sql), never taken from the client — and one `eye_check` event.
 */
import { z } from "zod";
import { inArray, ne, and, schema, withUser } from "@gdud/db";
import { actionError, UserError, type ActionOutcome } from "@/lib/action-result";
import { firstIssue, kesherCtx, NO_PERMISSION, revalidateKesher, uuid } from "./common";

const { kesherSerials: serials, kesherEyeChecks: eye, kesherEvents: events } = schema;

const eyeSchema = z.object({ serialIds: z.array(uuid).min(1, "לא סומנו צ׳").max(1000, "יותר מדי צ׳ בבת אחת") });

export async function markSeen(input: z.input<typeof eyeSchema>): Promise<ActionOutcome<{ seen: number }>> {
  const ctx = await kesherCtx();
  if (!ctx) return NO_PERMISSION;
  if (!ctx.access.isAdmin) return { error: "רק מנהל קשר גדודי (מחלקת הקשר) מסמן צהוב בעיניים." };
  const parsed = eyeSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const ids = [...new Set(parsed.data.serialIds)];

  try {
    const seen = await withUser(ctx.s.claims, async (tx) => {
      const found = await tx.select({ id: serials.id }).from(serials).where(and(inArray(serials.id, ids), ne(serials.location, "brigade")));
      if (found.length !== ids.length) throw new UserError("אחד הצ׳ לא נמצא — רעננו את הדף");
      await tx.insert(eye).values(ids.map((serialId) => ({ serialId })));
      await tx.insert(events).values({ kind: "eye_check", qty: ids.length, details: `${ids.length} צ׳ נראו בעין` });
      return ids.length;
    });
    revalidateKesher();
    return { ok: true, data: { seen } };
  } catch (e) {
    return { error: actionError(e) };
  }
}
