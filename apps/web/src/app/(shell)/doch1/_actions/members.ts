"use server";
/**
 * Round member fields from the today screen. For now: in / out of the daily report
 * (released or deferred soldiers are not expected to report). Company user or admin
 * covering the soldier; RLS checks the same (doch1_members_update).
 */
import { z } from "zod";
import { can } from "@gdud/auth";
import { and, eq, schema, withUser } from "@gdud/db";
import { actionError, UserError, type ActionResult } from "@/lib/action-result";
import { doch1Ctx, firstIssue, NO_PERMISSION, NO_ROUND, revalidateDoch1, uuid } from "./common";

const { people, doch1Members: members } = schema;

const input = z.object({ personId: uuid, inReport: z.boolean() });

export async function setInReport(raw: { personId: string; inReport: boolean }): Promise<ActionResult> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { personId, inReport } = parsed.data;
  try {
    await withUser(ctx.s.claims, async (tx) => {
      const [person] = await tx.select({ unitId: people.unitId }).from(people).where(eq(people.id, personId));
      if (!person || !can(ctx.s.user, "doch1", ["admin", "company_user"], person.unitId, ctx.s.parents)) throw new UserError(NO_PERMISSION.error);
      const r = await tx
        .update(members)
        .set({ inReport })
        .where(and(eq(members.roundId, ctx.round.id), eq(members.personId, personId)))
        .returning({ personId: members.personId });
      if (!r.length) throw new UserError("החייל לא נמצא בסבב");
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}
