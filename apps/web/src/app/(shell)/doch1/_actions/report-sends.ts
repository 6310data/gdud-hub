"use server";
/**
 * "שליחת הדוח": a unit's report for a day is sent. It closes the day for the soldiers under the unit (a
 * company's send closes its platoons) for everyone but a doch1 admin covering them, who may also reopen
 * it. The cron job pushes the send to the battalion's דוח 1 admins (lib/doch1/report-sent-job.ts) — never
 * from here. can() decides the clear message; RLS and the day guard (GD007, 0043) enforce the same rules.
 */
import { z } from "zod";
import { israelToday } from "@gdud/core";
import { eq, schema, withUser } from "@gdud/db";
import { actionError, UserError, type ActionResult } from "@/lib/action-result";
import { dayParam, doch1Ctx, firstIssue, NO_PERMISSION, NO_ROUND, revalidateDoch1, uuid } from "./common";

const { doch1ReportSends: sends } = schema;

const sendInput = z.object({ unitId: uuid, day: dayParam });

/** Send the unit's report for the day. Sending twice is a no-op (the first send stays). */
export async function sendReport(input: { unitId: string; day: string }): Promise<ActionResult> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  const parsed = sendInput.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { unitId, day } = parsed.data;
  if (!ctx.access.canReport(unitId)) return NO_PERMISSION;
  if (day < ctx.round.startsOn || day > ctx.round.endsOn) return { error: "התאריך מחוץ לסבב." };
  if (day > israelToday(new Date())) return { error: "שולחים את הדוח של היום או של יום שעבר, לא של יום שעוד לא הגיע." };
  try {
    await withUser(ctx.s.claims, (tx) => tx.insert(sends).values({ roundId: ctx.round.id, unitId, day }).onConflictDoNothing());
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}

const reopenInput = z.object({ sendId: uuid });

/** "פתיחת הדוח מחדש" (doch1 admin covering the unit): the day is open again; the delete is audited. */
export async function reopenReport(input: { sendId: string }): Promise<ActionResult> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  const parsed = reopenInput.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  try {
    await withUser(ctx.s.claims, async (tx) => {
      const [row] = await tx.select({ unitId: sends.unitId }).from(sends).where(eq(sends.id, parsed.data.sendId));
      if (!row) throw new UserError("הדוח כבר נפתח מחדש. רעננו את הדף.");
      if (!ctx.access.canReopen(row.unitId)) throw new UserError(NO_PERMISSION.error);
      const deleted = await tx.delete(sends).where(eq(sends.id, parsed.data.sendId)).returning({ id: sends.id });
      if (!deleted.length) throw new UserError(NO_PERMISSION.error);
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}
