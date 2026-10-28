import "server-only";
/**
 * Shared plumbing for ניהול פלוגה Server Actions. Every action:
 *   1. loads the session and checks the permission with companyAccess (clear message),
 *   2. validates input with zod,
 *   3. calls the module's SECURITY DEFINER function through withUser() — it checks the role again
 *      (0027_company_security.sql) and every write is audited.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@gdud/auth";
import { companyAccess, type CompanyAccess } from "@/lib/company/access";
import { getSession, type Session } from "@/lib/session";

export const NO_PERMISSION = { error: "אין לך הרשאה לפעולה הזו." } as const;

export interface CompanyCtx {
  s: Session;
  access: CompanyAccess;
}

/** A company member or a linked soldier, or null. */
export async function companyCtx(): Promise<CompanyCtx | null> {
  const s = await getSession();
  if (!s || (!s.personId && !can(s.user, "company", "any"))) return null;
  return { s, access: companyAccess(s) };
}

export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "קלט לא תקין";
}

export function revalidateCompany(): void {
  revalidatePath("/company", "layout");
}

export const uuid = z.uuid("מזהה לא תקין");
