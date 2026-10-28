"use server";
/**
 * /join: a signed-in Google account asks to be linked to its soldier (app.request_join). The
 * function answers the same whether or not anything matched, and so does this action: it never
 * says whether the personal number exists.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { sql, withUser } from "@gdud/db";
import type { ActionResult } from "@/lib/action-result";
import { companyError } from "@/lib/company/errors";
import { getClaims } from "@/lib/session";

const joinSchema = z.object({
  personalNumber: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length >= 5 && v.length <= 12, "מספר אישי: 5–12 ספרות"),
  phoneLast4: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 4, "4 הספרות האחרונות של הטלפון"),
});

export async function requestJoin(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const claims = await getClaims();
  if (!claims) redirect("/login");
  const parsed = joinSchema.safeParse({ personalNumber: form.get("personalNumber") ?? "", phoneLast4: form.get("phoneLast4") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  try {
    await withUser(claims, (tx) => tx.execute(sql`select app.request_join(${parsed.data.personalNumber}, ${parsed.data.phoneLast4})`));
  } catch (err) {
    return { error: companyError(err) };
  }
  redirect("/join?sent=1");
}
