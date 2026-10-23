"use server";
/** "Send a reminder to this company now" from the overview; the cron job sends it within minutes. */
import { schema, withUser } from "@gdud/db";
import { actionError, type ActionResult } from "@/lib/action-result";
import { doch1Ctx, NO_PERMISSION, NO_ROUND, uuid } from "./common";

export async function requestReminder(unitId: string): Promise<ActionResult> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  if (!ctx.access.isAdmin) return NO_PERMISSION;
  const parsed = uuid.safeParse(unitId);
  if (!parsed.success || !ctx.s.units.some((u) => u.id === parsed.data && u.kind === "company")) return { error: "הפלוגה לא נמצאה" };
  try {
    await withUser(ctx.s.claims, (tx) => tx.insert(schema.doch1ReminderRequests).values({ roundId: ctx.round.id, unitId: parsed.data }));
  } catch (err) {
    return { error: actionError(err) };
  }
  return { ok: true };
}
