"use server";
/**
 * פעילויות: the company admin and the platoon commanders create and edit a company's activities; a
 * participant is added only if present and not home that day in דוח 1 (the guard of
 * 0037_company_activities_security.sql), and a platoon commander adds only their platoon's soldiers.
 * Nothing here writes דוח 1.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { isDay } from "@gdud/core";
import { and, eq, schema, withUser } from "@gdud/db";
import type { ActionResult } from "@/lib/action-result";
import { companyError } from "@/lib/company/errors";
import { companyCtx, firstIssue, NO_PERMISSION, revalidateCompany, uuid, type CompanyCtx } from "./common";

const { companyActivities: acts, companyActivityParticipants: parts, companyActivityVehicles: actVehicles } = schema;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `עד ${max} תווים`)
    .transform((v) => v || null);
const clock = z
  .string()
  .trim()
  .refine((v) => v === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "שעה בפורמט 08:30")
  .transform((v) => v || null);

const activitySchema = z
  .object({
    unitId: uuid,
    name: z.string().trim().min(1, "כתבו שם לפעילות").max(80, "עד 80 תווים"),
    day: z.string().refine(isDay, "בחרו תאריך"),
    startsAt: clock,
    endsAt: clock,
    place: text(80),
    commanderPersonId: z
      .string()
      .transform((v) => v || null)
      .pipe(uuid.nullable()),
    notes: text(1000),
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, { message: "שעת הסיום צריכה להיות אחרי שעת ההתחלה" });

/** A commander of the company (admin or one of its platoon commanders), or null. */
function commander(ctx: CompanyCtx | null, unitId: string) {
  const scope = ctx?.access.scope(unitId);
  return scope && (scope.isAdmin || scope.platoons.length) ? scope : null;
}

const fields = (form: FormData) => ({
  unitId: form.get("unitId"),
  name: form.get("name") ?? "",
  day: form.get("day") ?? "",
  startsAt: form.get("startsAt") ?? "",
  endsAt: form.get("endsAt") ?? "",
  place: form.get("place") ?? "",
  commanderPersonId: form.get("commanderPersonId") ?? "",
  notes: form.get("notes") ?? "",
});

export async function createActivity(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await companyCtx();
  const parsed = activitySchema.safeParse(fields(form));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  if (!commander(ctx, parsed.data.unitId)) return NO_PERMISSION;
  let id: string;
  try {
    const [row] = await withUser(ctx!.s.claims, (tx) => tx.insert(acts).values(parsed.data).returning({ id: acts.id }));
    id = row!.id;
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  redirect(`/company/${parsed.data.unitId}/activities/${id}`);
}

export async function updateActivity(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await companyCtx();
  const id = uuid.safeParse(form.get("id"));
  const parsed = activitySchema.safeParse(fields(form));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  if (!id.success || !commander(ctx, parsed.data.unitId)) return NO_PERMISSION;
  const { unitId, ...set } = parsed.data;
  try {
    const done = await withUser(ctx!.s.claims, (tx) => tx.update(acts).set(set).where(and(eq(acts.id, id.data), eq(acts.unitId, unitId))).returning({ id: acts.id }));
    if (!done.length) return NO_PERMISSION;
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}

export async function deleteActivity(unitId: string, id: string): Promise<ActionResult> {
  const ctx = await companyCtx();
  const ids = z.object({ unitId: uuid, id: uuid }).safeParse({ unitId, id });
  if (!ids.success || !commander(ctx, ids.data.unitId)) return NO_PERMISSION;
  try {
    const done = await withUser(ctx!.s.claims, (tx) => tx.delete(acts).where(and(eq(acts.id, ids.data.id), eq(acts.unitId, ids.data.unitId))).returning({ id: acts.id }));
    if (!done.length) return NO_PERMISSION;
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  redirect(`/company/${ids.data.unitId}/activities`);
}

const participantSchema = z.object({ unitId: uuid, activityId: uuid, personId: uuid, role: z.string().trim().max(40, "תפקיד: עד 40 תווים").optional() });

export async function addParticipant(input: z.input<typeof participantSchema>): Promise<ActionResult> {
  const ctx = await companyCtx();
  const parsed = participantSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  if (!commander(ctx, parsed.data.unitId)) return NO_PERMISSION;
  try {
    await withUser(ctx!.s.claims, (tx) => tx.insert(parts).values({ activityId: parsed.data.activityId, personId: parsed.data.personId, role: parsed.data.role || null }));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}

export async function removeParticipant(unitId: string, participantId: string): Promise<ActionResult> {
  const ctx = await companyCtx();
  const ids = z.object({ unitId: uuid, participantId: uuid }).safeParse({ unitId, participantId });
  if (!ids.success || !commander(ctx, ids.data.unitId)) return NO_PERMISSION;
  try {
    const done = await withUser(ctx!.s.claims, (tx) => tx.delete(parts).where(eq(parts.id, ids.data.participantId)).returning({ id: parts.id }));
    if (!done.length) return NO_PERMISSION;
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}

export async function setActivityVehicle(input: { unitId: string; activityId: string; vehicleId: string; on: boolean }): Promise<ActionResult> {
  const ctx = await companyCtx();
  const parsed = z.object({ unitId: uuid, activityId: uuid, vehicleId: uuid, on: z.boolean() }).safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { unitId, activityId, vehicleId, on } = parsed.data;
  if (!commander(ctx, unitId)) return NO_PERMISSION;
  try {
    await withUser(ctx!.s.claims, (tx) =>
      on
        ? tx.insert(actVehicles).values({ activityId, vehicleId }).onConflictDoNothing()
        : tx.delete(actVehicles).where(and(eq(actVehicles.activityId, activityId), eq(actVehicles.vehicleId, vehicleId))),
    );
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}
