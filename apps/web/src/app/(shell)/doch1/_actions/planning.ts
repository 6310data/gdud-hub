"use server";
/**
 * תכנון סבב: צפי הגעה and call-up dates of the round being planned (company user covering the
 * soldier, or admin — doch1_members_update checks the same), the "fill צפי הגעה" reminder,
 * "copy last round" (battalion admin) and "הפעלת סבב" (master admin).
 */
import { z } from "zod";
import { can } from "@gdud/auth";
import { and, eq, inArray, schema, withUser, type Tx } from "@gdud/db";
import { copyFromRound, RosterImportError } from "@gdud/db/doch1-roster-import";
import { activateRound, RoundError } from "@gdud/db/doch1-rounds";
import { actionError, UserError, type ActionResult } from "@/lib/action-result";
import { dayParam, doch1PlanningCtx, firstIssue, NO_PERMISSION, NO_PLANNING_ROUND, revalidateDoch1, uuid } from "./common";

const { people, doch1Members: members, doch1ReminderRequests: requests } = schema;

type PlanningCtx = NonNullable<Awaited<ReturnType<typeof doch1PlanningCtx>>>;

/** Every soldier must be one the user covers as admin / company user. */
async function requireCovering(ctx: PlanningCtx, tx: Tx, ids: string[]) {
  const rows = await tx.select({ id: people.id, unitId: people.unitId }).from(people).where(inArray(people.id, ids));
  if (rows.length !== new Set(ids).size || rows.some((p) => !can(ctx.s.user, "doch1", ["admin", "company_user"], p.unitId, ctx.s.parents))) {
    throw new UserError(NO_PERMISSION.error);
  }
}

const arrivalInput = z
  .array(z.object({ personId: uuid, optionId: uuid.nullable() }))
  .min(1)
  .max(1000, "יותר מדי חיילים בבת אחת");

/** Set צפי הגעה for one or more soldiers (each with its own value, so undo can restore a mix). */
export async function setArrival(raw: Array<{ personId: string; optionId: string | null }>): Promise<ActionResult> {
  const ctx = await doch1PlanningCtx();
  if (!ctx) return NO_PLANNING_ROUND;
  const parsed = arrivalInput.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const byOption = new Map<string | null, string[]>();
  for (const x of parsed.data) byOption.set(x.optionId, [...(byOption.get(x.optionId) ?? []), x.personId]);
  try {
    await withUser(ctx.s.claims, async (tx) => {
      await requireCovering(ctx, tx, parsed.data.map((x) => x.personId));
      for (const [optionId, ids] of byOption) {
        await tx
          .update(members)
          .set({ arrivalOptionId: optionId })
          .where(and(eq(members.roundId, ctx.round.id), inArray(members.personId, ids)));
      }
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}

const callUpInput = z.object({ personId: uuid, callUpOn: dayParam.nullable() });

/** A soldier's call-up date in the round being planned (blank = the soldier is listed nowhere). */
export async function setPlanningCallUp(raw: { personId: string; callUpOn: string | null }): Promise<ActionResult> {
  const ctx = await doch1PlanningCtx();
  if (!ctx) return NO_PLANNING_ROUND;
  const parsed = callUpInput.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { personId, callUpOn } = parsed.data;
  if (callUpOn && (callUpOn < ctx.round.startsOn || callUpOn > ctx.round.endsOn)) return { error: "תאריך הגיוס מחוץ לסבב" };
  try {
    await withUser(ctx.s.claims, async (tx) => {
      await requireCovering(ctx, tx, [personId]);
      await tx
        .update(members)
        .set({ callUpOn })
        .where(and(eq(members.roundId, ctx.round.id), eq(members.personId, personId)));
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}

/** "Fill צפי הגעה" push to one company's users; the cron job sends it within minutes. */
export async function requestArrivalReminder(unitId: string): Promise<ActionResult> {
  const ctx = await doch1PlanningCtx();
  if (!ctx) return NO_PLANNING_ROUND;
  if (!ctx.access.isAdmin) return NO_PERMISSION;
  const parsed = uuid.safeParse(unitId);
  if (!parsed.success || !ctx.s.units.some((u) => u.id === parsed.data && u.kind === "company")) return { error: "הפלוגה לא נמצאה" };
  try {
    await withUser(ctx.s.claims, (tx) => tx.insert(requests).values({ roundId: ctx.round.id, unitId: parsed.data, kind: "arrival" }));
  } catch (err) {
    return { error: actionError(err) };
  }
  return { ok: true };
}

/** Without the battalion's list: every soldier of the last round joins the planning round. */
export async function copyLastRound(): Promise<ActionResult> {
  const ctx = await doch1PlanningCtx();
  if (!ctx) return NO_PLANNING_ROUND;
  if (!ctx.access.isAdmin) return NO_PERMISSION;
  try {
    await withUser(ctx.s.claims, (tx) => copyFromRound(tx, { planningRoundId: ctx.round.id }));
  } catch (err) {
    return { error: err instanceof RosterImportError ? err.message : actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}

/**
 * "הפעלת סבב": close the active round, open the planning one, apply the pending company moves.
 * A change of round state, like the rest of the rounds' settings: master admin.
 */
export async function activatePlanningRound(): Promise<ActionResult> {
  const ctx = await doch1PlanningCtx();
  if (!ctx) return NO_PLANNING_ROUND;
  if (!ctx.access.isMaster) return NO_PERMISSION;
  try {
    await withUser(ctx.s.claims, (tx) => activateRound(tx, ctx.round.id));
  } catch (err) {
    return { error: err instanceof RoundError ? err.message : actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}
