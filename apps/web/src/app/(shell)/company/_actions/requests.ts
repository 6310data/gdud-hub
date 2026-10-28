"use server";
/**
 * Deciding requests: a join request (company admin of the soldier's unit, app.approve_join) and a
 * name / תפקיד change (company admin, or the platoon commander of the soldier's platoon,
 * app.decide_profile_change); and linking a soldier to an email by hand (company admin,
 * app.company_link_account). The functions check the role again; the UI check here only gives a
 * clear message.
 */
import { z } from "zod";
import { sql, withUser } from "@gdud/db";
import type { ActionResult } from "@/lib/action-result";
import { companyError } from "@/lib/company/errors";
import { companyCtx, firstIssue, NO_PERMISSION, revalidateCompany, uuid } from "./common";

const decision = z.object({ id: uuid, approve: z.boolean() });

export async function decideJoin(id: string, approve: boolean): Promise<ActionResult> {
  const ctx = await companyCtx();
  if (!ctx?.access.companies.some((c) => c.isAdmin)) return NO_PERMISSION;
  const parsed = decision.safeParse({ id, approve });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  try {
    await withUser(ctx.s.claims, (tx) => tx.execute(sql`select app.approve_join(${parsed.data.id}::uuid, ${parsed.data.approve})`));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}

export async function decideChange(id: string, approve: boolean): Promise<ActionResult> {
  const ctx = await companyCtx();
  if (!ctx?.access.companies.length) return NO_PERMISSION;
  const parsed = decision.safeParse({ id, approve });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  try {
    await withUser(ctx.s.claims, (tx) => tx.execute(sql`select app.decide_profile_change(${parsed.data.id}::uuid, ${parsed.data.approve})`));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}

const linkSchema = z.object({ personId: uuid, email: z.email("כתובת מייל לא תקינה").max(320) });

/** A company admin links a soldier to their Google email by hand (app.company_link_account). */
export async function linkAccount(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await companyCtx();
  if (!ctx?.access.companies.some((c) => c.isAdmin)) return NO_PERMISSION;
  const parsed = linkSchema.safeParse({ personId: form.get("personId"), email: String(form.get("email") ?? "").trim().toLowerCase() });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  try {
    await withUser(ctx.s.claims, (tx) => tx.execute(sql`select app.company_link_account(${parsed.data.personId}::uuid, ${parsed.data.email})`));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}
