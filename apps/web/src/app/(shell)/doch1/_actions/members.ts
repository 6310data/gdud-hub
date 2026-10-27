"use server";
/**
 * Round member fields: in / out of the daily report (today screen), the call-up / release
 * dates (חיילים screen), the soldier card's details and סטטוס גיוס (יום גיוס). Company user or admin covering the soldier; RLS checks the same
 * (doch1_members_update), the doch1_members_service_dates check the date order.
 */
import { z } from "zod";
import { can } from "@gdud/auth";
import { and, count, eq, inArray, schema, withUser } from "@gdud/db";
import { actionError, UserError, type ActionResult } from "@/lib/action-result";
import { dayParam, doch1Ctx, firstIssue, NO_PERMISSION, NO_ROUND, revalidateDoch1, uuid } from "./common";

const { people, doch1Members: members, doch1Days: days, doch1FieldOptions: fieldOptions } = schema;

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

const datesInput = z
  .object({
    personIds: z.array(uuid).min(1, "לא נבחרו חיילים").max(1000),
    /** undefined = unchanged, null = clear */
    callUpOn: dayParam.nullable().optional(),
    releasedOn: dayParam.nullable().optional(),
  })
  .refine((v) => v.callUpOn !== undefined || v.releasedOn !== undefined, "לא נבחר תאריך");

/** Sets the call-up and/or release date of one or more soldiers of the active round. */
export async function setServiceDates(raw: {
  personIds: string[];
  callUpOn?: string | null;
  releasedOn?: string | null;
}): Promise<ActionResult> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  const parsed = datesInput.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { personIds, callUpOn, releasedOn } = parsed.data;
  try {
    await withUser(ctx.s.claims, async (tx) => {
      const rows = await tx
        .select({ personId: members.personId, name: people.fullName, unitId: people.unitId, callUpOn: members.callUpOn, releasedOn: members.releasedOn })
        .from(members)
        .innerJoin(people, eq(people.id, members.personId))
        .where(and(eq(members.roundId, ctx.round.id), inArray(members.personId, personIds)));
      if (rows.length !== new Set(personIds).size) throw new UserError("חלק מהחיילים לא נמצאו בסבב");
      for (const r of rows) {
        if (!can(ctx.s.user, "doch1", ["admin", "company_user"], r.unitId, ctx.s.parents)) throw new UserError(NO_PERMISSION.error);
        const from = callUpOn === undefined ? r.callUpOn : callUpOn;
        const to = releasedOn === undefined ? r.releasedOn : releasedOn;
        if (from && to && to < from) throw new UserError(`תאריך השחרור של ${r.name} לפני תאריך הגיוס`);
      }
      const set = { ...(callUpOn !== undefined ? { callUpOn } : {}), ...(releasedOn !== undefined ? { releasedOn } : {}) };
      await tx
        .update(members)
        .set(set)
        .where(and(eq(members.roundId, ctx.round.id), inArray(members.personId, personIds)));
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `עד ${max} תווים`)
    .transform((v) => v || null)
    .nullable();

const detailsInput = z.object({
  personId: uuid,
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{0,20}$/, "מספר טלפון לא תקין")
    .transform((v) => v.replace(/\s+/g, "") || null)
    .nullable(),
  roleTitle: optText(60),
  dmhCategory: optText(30),
  /** צפי הגעה / סטטוס גיוס values of the round; null = blank */
  arrivalOptionId: uuid.nullable(),
  enlistmentOptionId: uuid.nullable(),
  hasDisc: z.boolean().nullable(),
  notes: optText(500),
  /** mark "not arriving" although the soldier already has reported days */
  force: z.boolean().optional(),
});

export type SoldierDetailsInput = z.input<typeof detailsInput>;

/** Marking "not arriving" would hide this many reported days of the soldier: ask first. */
export type SoldierDetailsResult = ActionResult | { confirmDays: number };

/**
 * The soldier card's "עריכה": phone and תפקיד בפועל (people) and the round fields (doch1_members).
 * Company user or admin covering the soldier — people_update and doch1_members_update check the same.
 * A "not arriving" צפי הגעה hides the soldier on every day of the round, past ones too: when they
 * already have reported days, nothing is saved and `confirmDays` comes back (the card offers a
 * release date instead) unless `force` is set.
 */
export async function updateSoldierDetails(raw: SoldierDetailsInput): Promise<SoldierDetailsResult> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  const parsed = detailsInput.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { personId, phone, roleTitle, force, ...round } = parsed.data;
  let confirmDays = 0;
  try {
    await withUser(ctx.s.claims, async (tx) => {
      const [person] = await tx.select({ unitId: people.unitId }).from(people).where(eq(people.id, personId));
      if (!person || !can(ctx.s.user, "doch1", ["admin", "company_user"], person.unitId, ctx.s.parents)) throw new UserError(NO_PERMISSION.error);
      if (round.arrivalOptionId && !force) {
        const [[next], [cur]] = await Promise.all([
          tx.select({ effect: fieldOptions.effect }).from(fieldOptions).where(eq(fieldOptions.id, round.arrivalOptionId)),
          tx
            .select({ effect: fieldOptions.effect })
            .from(members)
            .leftJoin(fieldOptions, eq(fieldOptions.id, members.arrivalOptionId))
            .where(and(eq(members.roundId, ctx.round.id), eq(members.personId, personId))),
        ]);
        if (next?.effect === "not_arriving" && cur?.effect !== "not_arriving") {
          const [reported] = await tx
            .select({ n: count() })
            .from(days)
            .where(and(eq(days.roundId, ctx.round.id), eq(days.personId, personId)));
          if (reported && reported.n > 0) {
            confirmDays = reported.n;
            return;
          }
        }
      }
      const r = await tx
        .update(members)
        .set(round)
        .where(and(eq(members.roundId, ctx.round.id), eq(members.personId, personId)))
        .returning({ personId: members.personId });
      if (!r.length) throw new UserError("החייל לא נמצא בסבב");
      await tx.update(people).set({ phone, roleTitle }).where(eq(people.id, personId));
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  if (confirmDays) return { confirmDays };
  revalidateDoch1();
  return { ok: true };
}

const enlistmentInput = z.object({
  personId: uuid,
  optionId: uuid.nullable(),
  /** set only when given: a postponed value moves the call-up date, undo puts it back */
  callUpOn: dayParam.nullable().optional(),
  /** set only when given: a released value sets the release date, undo / another value clears it */
  releasedOn: dayParam.nullable().optional(),
});

/**
 * יום גיוס: a soldier's סטטוס גיוס, and with it the call-up date (נדחה) or the release date
 * (שוחרר), in one update. The value's effect decides which date it needs; the database checks the
 * value belongs to this round's list (GD003) and the date order (doch1_members_service_dates).
 */
export async function setEnlistment(raw: z.input<typeof enlistmentInput>): Promise<ActionResult> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  const parsed = enlistmentInput.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { personId, optionId, callUpOn, releasedOn } = parsed.data;
  try {
    await withUser(ctx.s.claims, async (tx) => {
      const [person] = await tx.select({ unitId: people.unitId }).from(people).where(eq(people.id, personId));
      if (!person || !can(ctx.s.user, "doch1", ["admin", "company_user"], person.unitId, ctx.s.parents)) throw new UserError(NO_PERMISSION.error);
      const [option] = optionId ? await tx.select({ effect: fieldOptions.effect }).from(fieldOptions).where(eq(fieldOptions.id, optionId)) : [];
      if (optionId && !option) throw new UserError("הערך לא נמצא");
      if (option?.effect === "postponed" && !callUpOn) throw new UserError("נדחה: צריך תאריך גיוס חדש");
      if (option?.effect === "released" && !releasedOn) throw new UserError("שוחרר: צריך תאריך שחרור");
      const set: Partial<typeof members.$inferInsert> = { enlistmentOptionId: optionId };
      if (callUpOn !== undefined) set.callUpOn = callUpOn;
      if (releasedOn !== undefined) set.releasedOn = releasedOn;
      const r = await tx
        .update(members)
        .set(set)
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
