"use server";
/**
 * A department's own role management, for its master admin (settings → הרשאות).
 * Checked here with can(), and again by the memberships policies (0015_department_roles.sql):
 * a master admin writes only memberships of their module, on units they cover.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@gdud/auth";
import { getModule, hasMasterRole, isModuleId, isRoleOf, type ModuleId } from "@gdud/core";
import { and, eq, ne, schema, withUser } from "@gdud/db";
import { dbErrorMessage, type ActionResult } from "@/lib/action-result";
import { getSession } from "@/lib/session";

const NO_PERMISSION: ActionResult = { error: "אין לך הרשאה לפעולה הזו." };
const uuid = z.uuid();

const grantSchema = z
  .object({
    module: z.string().refine(isModuleId, "מחלקה לא קיימת"),
    userId: z.uuid("יש לבחור משתמש"),
    role: z.string().min(1, "יש לבחור תפקיד"),
    unitId: z.string().transform((s) => (s === "battalion" || s === "" ? null : s)),
  })
  .refine((v) => isRoleOf(v.module as ModuleId, v.role), { message: "תפקיד לא קיים במחלקה" })
  .refine((v) => v.unitId === null || uuid.safeParse(v.unitId).success, { message: "מסגרת לא תקינה" });

function revalidate(module: ModuleId) {
  const href = getModule(module)?.href;
  if (href) revalidatePath(href, "layout");
}

/** Give a user a role in the department (or change the role they hold on that scope). */
export async function grantDepartmentRole(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = grantSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  const v = { ...parsed.data, module: parsed.data.module as ModuleId };
  const s = await getSession();
  if (!s || !hasMasterRole(v.module) || !can(s.user, v.module, ["master_admin"], v.unitId, s.parents)) return NO_PERMISSION;
  if (v.userId === s.user.id) return { error: "אי אפשר לשנות את ההרשאות של עצמך." };
  try {
    await withUser(s.claims, (tx) =>
      tx
        .insert(schema.memberships)
        .values({ userId: v.userId, module: v.module, role: v.role, unitId: v.unitId })
        .onConflictDoUpdate({
          target: [schema.memberships.userId, schema.memberships.module, schema.memberships.unitId],
          set: { role: v.role },
        }),
    );
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidate(v.module);
  return { ok: true };
}

/** Remove one role from the department. Your own roles stay (ask another master admin). */
export async function removeDepartmentRole(module: ModuleId, membershipId: string): Promise<ActionResult> {
  const s = await getSession();
  if (!s || !isModuleId(module) || !hasMasterRole(module) || !uuid.safeParse(membershipId).success) return NO_PERMISSION;
  if (!can(s.user, module, ["master_admin"])) return NO_PERMISSION;
  try {
    const removed = await withUser(s.claims, (tx) =>
      tx
        .delete(schema.memberships)
        .where(
          and(
            eq(schema.memberships.id, membershipId),
            eq(schema.memberships.module, module),
            ne(schema.memberships.userId, s.user.id),
          ),
        )
        .returning({ id: schema.memberships.id }),
    );
    if (!removed.length) return { error: "אי אפשר להסיר את ההרשאה הזו." };
  } catch (e) {
    return { error: dbErrorMessage(e) };
  }
  revalidate(module);
  return { ok: true };
}
