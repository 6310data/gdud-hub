"use server";
/**
 * דוח 1 settings: the round (dates and daily times), companies in the round (+ the pilot
 * switch "reported in the app from"), statuses, and the שבצ״ק settings — locations,
 * standby types, the vehicle registry — and the reports' דמ״ח categories and 10א groups.
 * Battalion-wide doch1 master admins only.
 */
import { z } from "zod";
import { canonicalName, categoriesFromData, israelToday, LOCATION_KINDS, STANDBY_LEVELS, STATUS_FLAG_KEYS, statusFlagsChanged, VEHICLE_STATES } from "@gdud/core";
import { and, eq, gte, lt, ne, schema, withUser, type Tx } from "@gdud/db";
import { actionError, UserError, type ActionResult } from "@/lib/action-result";
import { toStatusDef } from "@/lib/doch1/data";
import { dayParam, doch1MasterSession, firstIssue, NO_PERMISSION, revalidateDoch1, uuid } from "./common";

const { doch1Rounds: rounds, doch1RoundCompanies: roundCompanies, doch1Statuses: statuses, doch1Days: days } = schema;
const { doch1Locations: locations, doch1StandbyTypes: standbyTypes, doch1Vehicles: vehicles } = schema;
const { doch1Members: members, doch1DmhCategories: dmhCategories, doch1ReportGroups: reportGroups } = schema;

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
  const s = await doch1MasterSession();
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
  const s = await doch1MasterSession();
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
    standbyAvailable: checkbox,
    /** the camp a soldier in this status is at (reports) */
    locationId: z
      .string()
      .optional()
      .transform((v) => v || null)
      .pipe(uuid.nullable()),
    ...flagFields,
  })
  .refine((v) => !(v.countsInSadak && v.offDuty), { message: "סטטוס לא יכול להיות גם בסד״כ וגם מחוץ לשמ״פ" });

/**
 * Create or edit a status. Changing the flags of a status that past days already use creates a
 * new version (the old one stays, inactive, for those days); days from today on move to the new one.
 */
export async function saveStatus(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await doch1MasterSession();
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


/* ── שבצ״ק: locations, standby types, vehicles ── */

/** Validates and saves one settings row; `write` returns how many rows it wrote (0 = not found). */
async function saveRow<S extends z.ZodType>(fd: FormData, schemaIn: S, write: (tx: Tx, v: z.output<S>) => Promise<number>): Promise<ActionResult> {
  const s = await doch1MasterSession();
  if (!s) return NO_PERMISSION;
  const parsed = schemaIn.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  try {
    await withUser(s.claims, async (tx) => {
      if (!(await write(tx, parsed.data))) throw new UserError("הפריט לא נמצא");
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}

const locationInput = z.object({
  id: optionalId,
  roundId: uuid,
  name: z.string().trim().min(1, "שם המיקום חסר").max(30, "עד 30 תווים"),
  kind: z.enum(LOCATION_KINDS, "סוג מיקום לא תקין"),
  sortOrder: z.coerce.number().int().min(0).max(999),
  active: checkbox,
});

export async function saveLocation(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return saveRow(fd, locationInput, async (tx, { id, ...v }) => {
    if (!id) return (await tx.insert(locations).values(v).returning({ id: locations.id })).length;
    return (await tx.update(locations).set(v).where(and(eq(locations.id, id), eq(locations.roundId, v.roundId))).returning({ id: locations.id })).length;
  });
}

const standbyTypeInput = z.object({
  id: optionalId,
  roundId: uuid,
  name: z.string().trim().min(1, "שם סוג הכוננות חסר").max(30, "עד 30 תווים"),
  level: z.enum(STANDBY_LEVELS, "רמה לא תקינה"),
  size: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .pipe(z.number().int("גודל: מספר שלם").min(1, "גודל: 1 עד 50").max(50, "גודל: 1 עד 50").nullable()),
  /** one role per line or comma; "מ״פ / סמ״פ" = either */
  requiredRoles: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(/[\n,]/)
        .map((r) => r.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().max(30, "תפקיד: עד 30 תווים")).max(10, "עד 10 תפקידי חובה")),
  sortOrder: z.coerce.number().int().min(0).max(999),
  active: checkbox,
});

export async function saveStandbyType(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return saveRow(fd, standbyTypeInput, async (tx, { id, ...v }) => {
    if (!id) return (await tx.insert(standbyTypes).values(v).returning({ id: standbyTypes.id })).length;
    return (await tx.update(standbyTypes).set(v).where(and(eq(standbyTypes.id, id), eq(standbyTypes.roundId, v.roundId))).returning({ id: standbyTypes.id })).length;
  });
}

const vehicleInput = z.object({
  id: optionalId,
  number: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^[0-9A-Za-z-]{1,20}$/, "צ׳ רכב: ספרות בלבד, עד 20 תווים")),
  kind: z
    .string()
    .trim()
    .max(30, "סוג: עד 30 תווים")
    .optional()
    .transform((v) => v || null),
  state: z.enum(VEHICLE_STATES, "מצב לא תקין"),
  active: checkbox,
});

export async function saveVehicle(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return saveRow(fd, vehicleInput, async (tx, { id, ...v }) => {
    if (!id) return (await tx.insert(vehicles).values(v).returning({ id: vehicles.id })).length;
    return (await tx.update(vehicles).set(v).where(eq(vehicles.id, id)).returning({ id: vehicles.id })).length;
  });
}

/* ── reports: דמ״ח categories and the 10א groups ── */

const dmhCategoryInput = z.object({
  id: optionalId,
  roundId: uuid,
  name: z.string().trim().min(1, "שם הקטגוריה חסר").max(30, "עד 30 תווים"),
  listed: checkbox,
  sortOrder: z.coerce.number().int().min(0).max(999),
});

export async function saveDmhCategory(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return saveRow(fd, dmhCategoryInput, async (tx, { id, ...v }) => {
    if (!id) return (await tx.insert(dmhCategories).values(v).returning({ id: dmhCategories.id })).length;
    return (await tx.update(dmhCategories).set(v).where(and(eq(dmhCategories.id, id), eq(dmhCategories.roundId, v.roundId))).returning({ id: dmhCategories.id })).length;
  });
}

const deleteInput = z.object({ id: uuid, roundId: uuid });

export async function deleteDmhCategory(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return saveRow(fd, deleteInput, async (tx, { id, roundId }) =>
    (await tx.delete(dmhCategories).where(and(eq(dmhCategories.id, id), eq(dmhCategories.roundId, roundId))).returning({ id: dmhCategories.id })).length,
  );
}

/** "יצירה מהנתונים": a category for every תפקיד לדמ״ח text the round's soldiers have (most used first); existing names stay. */
export async function seedDmhCategories(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return saveRow(fd, z.object({ roundId: uuid }), async (tx, { roundId }) => {
    const texts = await tx.select({ t: members.dmhCategory }).from(members).where(eq(members.roundId, roundId));
    const existing = await tx.select({ name: dmhCategories.name, sortOrder: dmhCategories.sortOrder }).from(dmhCategories).where(eq(dmhCategories.roundId, roundId));
    const have = new Set(existing.map((c) => canonicalName(c.name)));
    const found = categoriesFromData(texts.map((r) => r.t)).filter((c) => c.name.length <= 30 && !have.has(canonicalName(c.name)));
    if (!found.length) throw new UserError(existing.length ? "כל הקטגוריות שבנתונים כבר קיימות" : "לחיילים בסבב אין תפקיד לדמ״ח");
    const max = Math.max(0, ...existing.map((c) => c.sortOrder));
    await tx.insert(dmhCategories).values(found.map((c, i) => ({ roundId, name: c.name, sortOrder: max + i + 1 })));
    return 1;
  });
}

const reportGroupInput = z.object({
  id: optionalId,
  roundId: uuid,
  name: z.string().trim().min(1, "שם השורה חסר").max(40, "עד 40 תווים"),
  commander: z
    .string()
    .trim()
    .max(60, "מפקד: עד 60 תווים")
    .optional()
    .transform((v) => v || null),
  unitIds: z.array(uuid).max(30, "עד 30 יחידות"),
  sortOrder: z.coerce.number().int().min(0).max(999),
});

export async function saveReportGroup(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await doch1MasterSession();
  if (!s) return NO_PERMISSION;
  const parsed = reportGroupInput.safeParse({ ...Object.fromEntries(fd), unitIds: fd.getAll("unitIds") });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { id, ...v } = parsed.data;
  if (!v.unitIds.length) return { error: "יש לבחור לפחות יחידה אחת" };
  if (v.unitIds.some((u) => !s.units.some((x) => x.id === u))) return { error: "יחידה לא נמצאה" };
  try {
    await withUser(s.claims, async (tx) => {
      const n = id
        ? (await tx.update(reportGroups).set(v).where(and(eq(reportGroups.id, id), eq(reportGroups.roundId, v.roundId))).returning({ id: reportGroups.id })).length
        : (await tx.insert(reportGroups).values(v).returning({ id: reportGroups.id })).length;
      if (!n) throw new UserError("הפריט לא נמצא");
    });
  } catch (err) {
    return { error: actionError(err) };
  }
  revalidateDoch1();
  return { ok: true };
}

export async function deleteReportGroup(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return saveRow(fd, deleteInput, async (tx, { id, roundId }) =>
    (await tx.delete(reportGroups).where(and(eq(reportGroups.id, id), eq(reportGroups.roundId, roundId))).returning({ id: reportGroups.id })).length,
  );
}
