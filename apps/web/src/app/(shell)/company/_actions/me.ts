"use server";
/**
 * אני → הפרטים שלי: the soldier's own phone (written at once, app.update_my_phone) and requests to
 * change their name or תפקיד (app.request_profile_change; a commander approves).
 */
import { z } from "zod";
import { PROFILE_FIELDS, normalizePhone } from "@gdud/core";
import { sql, withUser } from "@gdud/db";
import type { ActionResult } from "@/lib/action-result";
import { companyError } from "@/lib/company/errors";
import { companyCtx, firstIssue, NO_PERMISSION, revalidateCompany } from "./common";

const phoneSchema = z.string().refine((v) => normalizePhone(v) !== null, "מספר טלפון לא תקין. כתבו מספר ישראלי, למשל 050-1234567.");
const changeSchema = z.object({
  field: z.enum(PROFILE_FIELDS),
  value: z.string().trim().max(60, "עד 60 תווים"),
});

export async function updateMyPhone(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await companyCtx();
  if (!ctx?.s.personId) return NO_PERMISSION;
  const parsed = phoneSchema.safeParse(form.get("phone") ?? "");
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  try {
    await withUser(ctx.s.claims, (tx) => tx.execute(sql`select app.update_my_phone(${parsed.data})`));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}

export async function requestProfileChange(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await companyCtx();
  if (!ctx?.s.personId) return NO_PERMISSION;
  const parsed = changeSchema.safeParse({ field: form.get("field"), value: form.get("value") ?? "" });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { field, value } = parsed.data;
  if (field === "full_name" && value.length < 2) return { error: "כתבו שם מלא (לפחות 2 תווים)." };
  try {
    await withUser(ctx.s.claims, (tx) => tx.execute(sql`select app.request_profile_change(${field}, ${value})`));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}
