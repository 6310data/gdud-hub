"use server";
/**
 * Admin mutations. Each one:
 *   1. checks the permission in code (clear error message),
 *   2. validates input with zod,
 *   3. writes through withUser() so RLS enforces the same rule again in the database.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@gdud/auth";
import { isModuleId, isRoleOf, UNIT_KINDS } from "@gdud/core";
import { and, eq, schema, withUser } from "@gdud/db";
import { dbErrorMessage, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/lib/session";

async function adminSession() {
  const s = await requireSession();
  if (!can(s.user, "core", ["admin"], null)) return null;
  return s;
}

const NO_PERMISSION: ActionResult = { error: "אין לך הרשאה לפעולה הזו." };
const uuid = z.uuid();

// ── users ──────────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.email("כתובת מייל לא תקינה").transform((s) => s.trim().toLowerCase()),
  displayName: z.string().trim().max(80).optional().transform((s) => s || null),
});

export async function inviteUser(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await adminSession();
  if (!s) return NO_PERMISSION;
  const parsed = inviteSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  try {
    await withUser(s.claims, (tx) => tx.insert(schema.appUsers).values(parsed.data));
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidatePath("/admin");
  return { ok: true };
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  const s = await adminSession();
  if (!s || !uuid.safeParse(userId).success) return NO_PERMISSION;
  if (userId === s.user.id) return { error: "אי אפשר להשבית את עצמך." };
  try {
    await withUser(s.claims, (tx) =>
      tx.update(schema.appUsers).set({ active }).where(eq(schema.appUsers.id, userId)),
    );
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidatePath("/admin");
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true };
}

// ── memberships ────────────────────────────────────────────────────────────

const membershipSchema = z
  .object({
    userId: uuid,
    module: z.string().refine(isModuleId, "מחלקה לא קיימת"),
    role: z.string().min(1),
    unitId: z.string().transform((s) => (s === "battalion" || s === "" ? null : s)),
  })
  .refine((v) => isModuleId(v.module) && isRoleOf(v.module, v.role), { message: "תפקיד לא קיים במחלקה" })
  .refine((v) => v.unitId === null || uuid.safeParse(v.unitId).success, { message: "מסגרת לא תקינה" });

export async function addMembership(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await adminSession();
  if (!s) return NO_PERMISSION;
  const parsed = membershipSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  const v = parsed.data;
  try {
    await withUser(s.claims, (tx) =>
      tx
        .insert(schema.memberships)
        .values({ userId: v.userId, module: v.module as never, role: v.role, unitId: v.unitId })
        .onConflictDoUpdate({
          target: [schema.memberships.userId, schema.memberships.module, schema.memberships.unitId],
          set: { role: v.role },
        }),
    );
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidatePath(`/admin/users/${v.userId}`);
  revalidatePath("/admin");
  return { ok: true };
}

export async function removeMembership(membershipId: string, userId: string): Promise<ActionResult> {
  const s = await adminSession();
  if (!s || !uuid.safeParse(membershipId).success) return NO_PERMISSION;
  try {
    await withUser(s.claims, (tx) =>
      tx
        .delete(schema.memberships)
        .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.userId, userId))),
    );
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin");
  return { ok: true };
}

// ── units ──────────────────────────────────────────────────────────────────

const unitSchema = z.object({
  name: z.string().trim().min(1, "חסר שם").max(60),
  kind: z.enum(UNIT_KINDS),
  parentId: uuid,
  code: z
    .string()
    .trim()
    .toLowerCase()
    .transform((s) => s || null)
    .refine((s) => s === null || /^[a-z0-9-]{1,32}$/.test(s), "קוד: אותיות לועזיות קטנות, ספרות ומקף"),
  color: z
    .string()
    .trim()
    .transform((s) => s || null)
    .refine((s) => s === null || /^#[0-9a-fA-F]{6}$/.test(s), "צבע בפורמט ‎#1e3a5f"),
});

export async function createUnit(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await adminSession();
  if (!s) return NO_PERMISSION;
  const parsed = unitSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  try {
    await withUser(s.claims, (tx) => tx.insert(schema.units).values(parsed.data));
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidatePath("/admin/units");
  return { ok: true };
}

export async function setUnitActive(unitId: string, active: boolean): Promise<ActionResult> {
  const s = await adminSession();
  if (!s || !uuid.safeParse(unitId).success) return NO_PERMISSION;
  try {
    await withUser(s.claims, (tx) =>
      tx.update(schema.units).set({ active }).where(eq(schema.units.id, unitId)),
    );
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidatePath("/admin/units");
  return { ok: true };
}
