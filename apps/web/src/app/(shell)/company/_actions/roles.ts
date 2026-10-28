"use server";
/**
 * הגדרות → הרשאות: a company admin gives and takes back the whitelisted company-level roles
 * (COMPANY_GRANTABLE) through app.company_grant_role / company_revoke_role, which check the
 * whitelist, the unit and the account again; the memberships policies are not widened.
 */
import { z } from "zod";
import { isCompanyGrantable, MODULE_IDS } from "@gdud/core";
import { sql, withUser } from "@gdud/db";
import type { ActionResult } from "@/lib/action-result";
import { companyError } from "@/lib/company/errors";
import { companyCtx, firstIssue, NO_PERMISSION, revalidateCompany, uuid } from "./common";

const grantSchema = z.object({
  companyId: uuid,
  userId: z.string().min(1, "בחרו חשבון").pipe(uuid),
  /** "module:role:unitId" */
  grant: z.string().regex(/^[a-z0-9]+:[a-z_]+:[0-9a-f-]{36}$/, "בחרו הרשאה"),
});

export async function grantRole(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await companyCtx();
  const parsed = grantSchema.safeParse({ companyId: form.get("companyId"), userId: form.get("userId") ?? "", grant: form.get("grant") ?? "" });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { companyId, userId, grant } = parsed.data;
  if (!ctx?.access.scope(companyId)?.isAdmin) return NO_PERMISSION;
  const [module, role, unitId] = grant.split(":") as [string, string, string];
  const unit = ctx.s.units.find((u) => u.id === unitId);
  if (!(MODULE_IDS as readonly string[]).includes(module) || !unit || !isCompanyGrantable(module, role, unit.kind)) {
    return { error: "את ההרשאה הזו מנהל פלוגה לא נותן." };
  }
  try {
    await withUser(ctx.s.claims, (tx) => tx.execute(sql`select app.company_grant_role(${userId}::uuid, ${module}::module_id, ${role}, ${unitId}::uuid)`));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}

export async function revokeRole(membershipId: string): Promise<ActionResult> {
  const ctx = await companyCtx();
  if (!ctx?.access.companies.some((c) => c.isAdmin)) return NO_PERMISSION;
  const parsed = uuid.safeParse(membershipId);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  try {
    await withUser(ctx.s.claims, (tx) => tx.execute(sql`select app.company_revoke_role(${parsed.data}::uuid)`));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}
