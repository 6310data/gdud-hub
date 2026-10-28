"use server";
/**
 * החתמה פנימית: record who has a piece of gear now (app.company_sign) and mark it returned
 * (app.company_return); the company's own items (company_items, company admin). The functions fill
 * "from", close the previous open entry and check the role; nothing here writes kesher or logistics.
 */
import { z } from "zod";
import { normalizeSerial } from "@gdud/core";
import { and, eq, schema, sql, withUser } from "@gdud/db";
import type { ActionResult } from "@/lib/action-result";
import { companyError } from "@/lib/company/errors";
import { companyCtx, firstIssue, NO_PERMISSION, revalidateCompany, uuid } from "./common";

const { companyItems: items } = schema;

const signSchema = z.object({
  unitId: uuid,
  gear: z.string().regex(/^(kesher|company):[0-9a-f-]{36}$/, "בחרו ציוד"),
  to: z.string().min(1, "בחרו מי מקבל").pipe(uuid),
  quantity: z.coerce.number().int("כמות בשלמים").min(1, "כמות: לפחות 1").max(9999, "כמות גדולה מדי"),
});

export async function signInternal(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await companyCtx();
  const parsed = signSchema.safeParse({ unitId: form.get("unitId"), gear: form.get("gear"), to: form.get("to") ?? "", quantity: form.get("quantity") || 1 });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { unitId, gear, to, quantity } = parsed.data;
  if (!ctx?.access.scope(unitId)) return NO_PERMISSION;
  const [kind, id] = gear.split(":") as ["kesher" | "company", string];
  try {
    await withUser(ctx.s.claims, (tx) => tx.execute(sql`select app.company_sign(${kind}, ${id}::uuid, ${to}::uuid, ${quantity})`));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}

export async function returnInternal(id: string): Promise<ActionResult> {
  const ctx = await companyCtx();
  if (!ctx?.access.companies.length) return NO_PERMISSION;
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  try {
    await withUser(ctx.s.claims, (tx) => tx.execute(sql`select app.company_return(${parsed.data}::uuid)`));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `עד ${max} תווים`)
    .transform((v) => v || null);

const itemSchema = z.object({
  unitId: uuid,
  name: z.string().trim().min(1, "כתבו שם פריט").max(80, "עד 80 תווים"),
  category: text(40),
  serial: z
    .string()
    .transform((v) => normalizeSerial(v) || null)
    .refine((v) => v === null || v.length <= 40, "צ׳ עד 40 תווים"),
  quantity: z.coerce.number().int("כמות בשלמים").min(1, "כמות: לפחות 1").max(9999, "כמות גדולה מדי"),
  notes: text(500),
});

export async function addCompanyItem(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await companyCtx();
  const parsed = itemSchema.safeParse({
    unitId: form.get("unitId"),
    name: form.get("name") ?? "",
    category: form.get("category") ?? "",
    serial: form.get("serial") ?? "",
    quantity: form.get("quantity") || 1,
    notes: form.get("notes") ?? "",
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { unitId, serial, quantity, ...rest } = parsed.data;
  if (!ctx?.access.scope(unitId)?.isAdmin) return NO_PERMISSION;
  try {
    await withUser(ctx.s.claims, (tx) => tx.insert(items).values({ unitId, serial, quantity: serial ? 1 : quantity, ...rest }));
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}

const updateSchema = z.object({
  id: uuid,
  unitId: uuid,
  quantity: z.coerce.number().int().min(1).max(9999).optional(),
  active: z.boolean().optional(),
});

export async function updateCompanyItem(input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const ctx = await companyCtx();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { id, unitId, quantity, active } = parsed.data;
  if (!ctx?.access.scope(unitId)?.isAdmin) return NO_PERMISSION;
  try {
    const done = await withUser(ctx.s.claims, (tx) =>
      tx
        .update(items)
        .set({ ...(quantity !== undefined ? { quantity } : {}), ...(active !== undefined ? { active } : {}) })
        .where(and(eq(items.id, id), eq(items.unitId, unitId)))
        .returning({ id: items.id }),
    );
    if (!done.length) return NO_PERMISSION;
  } catch (err) {
    return { error: companyError(err) };
  }
  revalidateCompany();
  return { ok: true };
}
