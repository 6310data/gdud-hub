"use server";
/**
 * Writing day statuses: one soldier, "fill the missing from yesterday", group update and its undo.
 * can() decides the clear message; RLS and the doch1_days_guard trigger (lock time, round dates)
 * enforce the same rules again — a page opened before the lock gets GD001 on submit.
 */
import { z } from "zod";
import { addDays, dayRange, dayKey, fillFromYesterdayPlan, planBulkWrite, type DayWrite } from "@gdud/core";
import { and, eq, inArray, schema, sql, withUser, type Tx } from "@gdud/db";
import { actionError, UserError, type ActionOutcome, type ActionResult } from "@/lib/action-result";
import { loadDays, loadMembers, loadStatuses, membersUnder } from "@/lib/doch1/data";
import { dayParam, doch1Ctx, firstIssue, NO_PERMISSION, NO_ROUND, revalidateDoch1, uuid, type Doch1Ctx } from "./common";

const { people, doch1Days: days } = schema;

const MAX_BULK_PEOPLE = 200;
const MAX_BULK_DAYS = 31;
const MAX_RESTORE = MAX_BULK_PEOPLE * MAX_BULK_DAYS;
const WRITE_CHUNK = 500;

/** Throws unless the user reports for every one of these soldiers (their current unit). */
async function assertCanReport(tx: Tx, ctx: Doch1Ctx, personIds: readonly string[]): Promise<void> {
  const unique = [...new Set(personIds)];
  const rows = await tx.select({ id: people.id, unitId: people.unitId }).from(people).where(inArray(people.id, unique));
  if (rows.length !== unique.length || rows.some((r) => !ctx.access.canReport(r.unitId))) {
    throw new UserError(NO_PERMISSION.error);
  }
}

function assertInRound(ctx: Doch1Ctx, ...list: string[]): void {
  if (list.some((d) => d < ctx.round.startsOn || d > ctx.round.endsOn)) throw new UserError("התאריך מחוץ לסבב.");
}

async function upsertDays(tx: Tx, roundId: string, rows: ReadonlyArray<{ personId: string; day: string; statusId: string }>): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    await tx
      .insert(days)
      .values(rows.slice(i, i + WRITE_CHUNK).map((r) => ({ ...r, roundId })))
      .onConflictDoUpdate({ target: [days.personId, days.day], set: { statusId: sql`excluded.status_id` } });
  }
}

async function deleteDays(tx: Tx, rows: ReadonlyArray<{ personId: string; day: string }>): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const keys = sql.join(
      rows.slice(i, i + WRITE_CHUNK).map((r) => sql`(${r.personId}::uuid, ${r.day}::date)`),
      sql`, `,
    );
    await tx.delete(days).where(sql`(${days.personId}, ${days.day}) in (${keys})`);
  }
}

const setInput = z.object({ personId: uuid, day: dayParam, statusId: uuid.nullable() });

/** Set (or clear, with statusId null) one soldier's status for one day. Last save wins. */
export async function setDayStatus(input: { personId: string; day: string; statusId: string | null }): Promise<ActionResult> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  const parsed = setInput.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { personId, day, statusId } = parsed.data;
  try {
    assertInRound(ctx, day);
    await withUser(ctx.s.claims, async (tx) => {
      await assertCanReport(tx, ctx, [personId]);
      if (statusId) await upsertDays(tx, ctx.round.id, [{ personId, day, statusId }]);
      else await tx.delete(days).where(and(eq(days.personId, personId), eq(days.day, day)));
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}

const fillInput = z.object({ unitId: uuid, day: dayParam });

/** "השלמת חסרים לפי אתמול": the unit's missing soldiers get yesterday's status (its current version). */
export async function fillFromYesterday(input: { unitId: string; day: string }): Promise<ActionOutcome<{ filled: number }>> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  const parsed = fillInput.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { unitId, day } = parsed.data;
  if (!ctx.access.canReport(unitId)) return NO_PERMISSION;
  try {
    assertInRound(ctx, day);
    const filled = await withUser(ctx.s.claims, async (tx) => {
      const members = membersUnder(await loadMembers(tx, ctx.round.id, ctx.s.units), unitId, ctx.s.units);
      const yesterday = addDays(day, -1);
      const [loaded, statuses] = await Promise.all([loadDays(tx, ctx.round.id, [day, yesterday]), loadStatuses(tx, ctx.round.id, { includeInactive: true })]);
      // a status replaced since yesterday (new flags version) is written as its current version
      const replacedBy = new Map(
        (await tx.select({ id: schema.doch1Statuses.id, replacesId: schema.doch1Statuses.replacesId }).from(schema.doch1Statuses).where(eq(schema.doch1Statuses.roundId, ctx.round.id)))
          .filter((s) => s.replacesId)
          .map((s) => [s.replacesId!, s.id]),
      );
      const active = new Set(statuses.filter((s) => s.active).map((s) => s.id));
      const current = (id: string) => {
        let cur: string | undefined = id;
        for (let i = 0; cur && !active.has(cur) && i < 16; i++) cur = replacedBy.get(cur);
        return cur && active.has(cur) ? cur : undefined;
      };
      const plan = fillFromYesterdayPlan(members, loaded.get(day)!, loaded.get(yesterday)!)
        .map((p) => ({ personId: p.personId, day, statusId: current(p.statusId) }))
        .filter((p): p is { personId: string; day: string; statusId: string } => !!p.statusId);
      if (!plan.length) return 0;
      // someone may have filled a soldier in the meantime: never overwrite
      for (let i = 0; i < plan.length; i += WRITE_CHUNK) {
        await tx
          .insert(days)
          .values(plan.slice(i, i + WRITE_CHUNK).map((r) => ({ ...r, roundId: ctx.round.id })))
          .onConflictDoNothing();
      }
      return plan.length;
    });
    revalidateDoch1();
    return { ok: true, data: { filled } };
  } catch (err) {
    return { error: actionError(err) };
  }
}

const bulkInput = z
  .object({
    personIds: z.array(uuid).min(1, "לא נבחרו חיילים").max(MAX_BULK_PEOPLE, `עד ${MAX_BULK_PEOPLE} חיילים בפעם אחת`),
    from: dayParam,
    to: dayParam,
    statusId: uuid,
  })
  .refine((v) => v.from <= v.to, { message: "טווח התאריכים הפוך" })
  .refine((v) => dayRange(v.from, v.to).length <= MAX_BULK_DAYS, { message: `עד ${MAX_BULK_DAYS} ימים בפעם אחת` });

/** Group update (mockup screen 08): people × days → one status. Returns an exact undo. */
export async function bulkSetStatus(input: {
  personIds: string[];
  from: string;
  to: string;
  statusId: string;
}): Promise<ActionOutcome<{ written: number; overwritten: number; undo: DayWrite[] }>> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  const parsed = bulkInput.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { personIds, from, to, statusId } = parsed.data;
  try {
    assertInRound(ctx, from, to);
    const list = dayRange(from, to);
    const result = await withUser(ctx.s.claims, async (tx) => {
      await assertCanReport(tx, ctx, personIds);
      const rows = await tx
        .select({ personId: days.personId, day: days.day, statusId: days.statusId })
        .from(days)
        .where(and(inArray(days.personId, personIds), inArray(days.day, list)));
      const existing = new Map(rows.map((r) => [dayKey(r.personId, r.day), r.statusId]));
      const plan = planBulkWrite(existing, personIds, list, statusId);
      await upsertDays(
        tx,
        ctx.round.id,
        plan.writes.map((w) => ({ personId: w.personId, day: w.day, statusId })),
      );
      return { written: plan.writes.length, overwritten: plan.overwritten, undo: plan.undo };
    });
    revalidateDoch1();
    return { ok: true, data: result };
  } catch (err) {
    return { error: actionError(err) };
  }
}

const restoreInput = z
  .array(z.object({ personId: uuid, day: dayParam, statusId: uuid.nullable() }))
  .min(1)
  .max(MAX_RESTORE, "יותר מדי ימים לשחזור");

/** Undo of a group update: puts back each cell's previous status; cells that were empty are cleared. */
export async function restoreDays(undo: DayWrite[]): Promise<ActionResult> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  const parsed = restoreInput.safeParse(undo);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  try {
    assertInRound(ctx, ...parsed.data.map((u) => u.day));
    await withUser(ctx.s.claims, async (tx) => {
      await assertCanReport(
        tx,
        ctx,
        parsed.data.map((u) => u.personId),
      );
      const puts = parsed.data.filter((u): u is DayWrite & { statusId: string } => u.statusId !== null);
      await upsertDays(tx, ctx.round.id, puts);
      await deleteDays(
        tx,
        parsed.data.filter((u) => u.statusId === null),
      );
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}
