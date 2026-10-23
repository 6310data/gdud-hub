"use server";
/** Every copy / share of the brigade report text is logged with the sender (battalion admin). */
import { z } from "zod";
import { schema, withUser } from "@gdud/db";
import { actionError, type ActionResult } from "@/lib/action-result";
import { dayParam, doch1Ctx, firstIssue, NO_PERMISSION, NO_ROUND } from "./common";

const logInput = z.object({
  day: dayParam,
  content: z.string().min(1).max(20000, "הדוח ארוך מדי"),
  partial: z.boolean(),
});

export async function logBrigadeCopy(input: { day: string; content: string; partial: boolean }): Promise<ActionResult> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  if (!ctx.access.isAdmin) return NO_PERMISSION;
  const parsed = logInput.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  try {
    await withUser(ctx.s.claims, (tx) => tx.insert(schema.doch1BrigadeLog).values({ roundId: ctx.round.id, ...parsed.data }));
  } catch (err) {
    return { error: actionError(err) };
  }
  return { ok: true };
}
