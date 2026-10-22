"use server";
/**
 * דוח 1 settings: the round (dates and daily times), companies in the round (+ the pilot
 * switch "reported in the app from"), statuses. Battalion-wide doch1 admins only.
 */
import { z } from "zod";
import { israelToday, STATUS_FLAG_KEYS, statusFlagsChanged } from "@gdud/core";
import { and, eq, gte, lt, ne, schema, withUser } from "@gdud/db";
import { actionError, UserError, type ActionResult } from "@/lib/action-result";
import { toStatusDef } from "@/lib/doch1/data";
import { dayParam, doch1AdminSession, firstIssue, NO_PERMISSION, revalidateDoch1, uuid } from "./common";

const { doch1Rounds: rounds, doch1RoundCompanies: roundCompanies, doch1Statuses: statuses, doch1Days: days } = schema;

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "שעה בפורמט HH:MM");
const optionalDay = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(dayParam.nullable());
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");
const optionalId = z
  .string()
  .optional()
  .transform((v) => v || undefined)
  .pipe(uuid.optional());

const roundInput = z
  .object({
    id: optionalId,
    name: z.string().trim().min(1, "שם הסבב חסר").max(40, "עד 40 תווים"),
    startsOn: dayParam,
    endsOn: dayParam,
    callUpOn: optionalDay,
    reminderAt: clock,
    lockAt: clock,
    sendAt: clock,
    active: checkbox,
  })
  .refine((r) => r.endsOn >= r.startsOn, { message: "סיום הסבב לפני תחילתו" });

export async function saveRound(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await doch1AdminSession();
  if (!s) return NO_PERMISSION;
  const parsed = roundInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { id, ...values } = parsed.data;
  try {
    await withUser(s.claims, async (tx) => {
      // one active round: deactivate the others first (partial unique index)
      if (values.active) {
        await tx
          .update(rounds)
          .set({ active: false })
          .where(id ? and(eq(rounds.active, true), ne(rounds.id, id)) : eq(rounds.active, true));
      }
      if (id) {
        const r = await tx.update(rounds).set(values).where(eq(rounds.id, id)).returning({ id: rounds.id });
        if (!r.length) throw new UserError("הסבב לא נמצא");
      } else {
        await tx.insert(rounds).values(values);
      }
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}

const roundCompanyInput = z.object({
  roundId: uuid,
  unitId: uuid,
  active: checkbox,
  appFrom: optionalDay,
});

export async function saveRoundCompany(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await doch1AdminSession();
  if (!s) return NO_PERMISSION;
  const parsed = roundCompanyInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { roundId, unitId, active, appFrom } = parsed.data;
  if (!s.units.some((u) => u.id === unitId && u.kind === "company")) return { error: "הפלוגה לא נמצאה" };
  try {
    await withUser(s.claims, (tx) =>
      tx
        .insert(roundCompanies)
        .values({ roundId, unitId, active, appFrom })
        .onConflictDoUpdate({ target: [roundCompanies.roundId, roundCompanies.unitId], set: { active, appFrom } }),
    );
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}

const flagFields = Object.fromEntries(STATUS_FLAG_KEYS.map((k) => [k, checkbox])) as Record<(typeof STATUS_FLAG_KEYS)[number], typeof checkbox>;

const statusInput = z
  .object({
    id: optionalId,
    roundId: uuid,
    name: z.string().trim().min(1, "שם הסטטוס חסר").max(30, "עד 30 תווים"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "צבע לא תקין"),
    displayGroup: z.string().trim().min(1, "קבוצה חסרה").max(30, "עד 30 תווים"),
    sheetValue: z.string().trim().min(1, "ערך בגיליון חסר").max(30, "עד 30 תווים"),
    sortOrder: z.coerce.number().int().min(0).max(999),
    active: checkbox,
    ...flagFields,
  })
  .refine((v) => !(v.countsInSadak && v.offDuty), { message: "סטטוס לא יכול להיות גם בסד״כ וגם מחוץ לשמ״פ" });

/**
 * Create or edit a status. Changing the flags of a status that past days already use creates a
 * new version (the old one stays, inactive, for those days); days from today on move to the new one.
 */
export async function saveStatus(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await doch1AdminSession();
  if (!s) return NO_PERMISSION;
  const parsed = statusInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { id, ...values } = parsed.data;
  const today = israelToday(new Date());
  try {
    await withUser(s.claims, async (tx) => {
      if (!id) {
        await tx.insert(statuses).values(values);
        return;
      }
      const [old] = await tx.select().from(statuses).where(and(eq(statuses.id, id), eq(statuses.roundId, values.roundId)));
      if (!old) throw new UserError("הסטטוס לא נמצא");
      const usedBefore = statusFlagsChanged(toStatusDef(old), values)
        ? await tx
            .select({ day: days.day })
            .from(days)
            .where(and(eq(days.statusId, id), lt(days.day, today)))
            .limit(1)
        : [];
      if (!usedBefore.length) {
        await tx.update(statuses).set(values).where(eq(statuses.id, id));
        return;
      }
      // new version: the old row keeps the flags past days were counted with
      await tx.update(statuses).set({ active: false }).where(eq(statuses.id, id));
      const [next] = await tx.insert(statuses).values({ ...values, replacesId: id }).returning({ id: statuses.id });
      await tx
        .update(days)
        .set({ statusId: next!.id })
        .where(and(eq(days.statusId, id), gte(days.day, today)));
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}

