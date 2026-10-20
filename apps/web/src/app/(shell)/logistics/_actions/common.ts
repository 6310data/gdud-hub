import "server-only";
/**
 * Shared plumbing for logistics Server Actions. Every action:
 *   1. loads the session and checks the permission with can() (clear message),
 *   2. validates input with zod,
 *   3. writes through withUser() — RLS enforces the same rules again,
 *   4. appends a human-readable row to logistics_events.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@gdud/auth";
import type { EventKind } from "@gdud/core";
import { schema, type Tx } from "@gdud/db";
import { logisticsAccess } from "@/lib/logistics/access";
import { getSession, type Session } from "@/lib/session";

export const NO_PERMISSION = { error: "אין לך הרשאה לפעולה הזו." } as const;

export interface LogisticsCtx {
  s: Session;
  access: ReturnType<typeof logisticsAccess>;
  actorName: string;
}

/** The session of a logistics member, or null (not signed in / no membership). */
export async function logisticsCtx(): Promise<LogisticsCtx | null> {
  const s = await getSession();
  if (!s || !can(s.user, "logistics", "any")) return null;
  // from the invite list, not the Google profile (users can rename themselves there)
  return { s, access: logisticsAccess(s), actorName: s.user.displayName ?? s.user.email };
}

export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "קלט לא תקין";
}

export interface EventInput {
  kind: EventKind;
  personId?: string | null;
  personName?: string | null;
  item?: string | null;
  serial?: string | null;
  details?: string | null;
  formId?: string | null;
}

export async function logEvents(tx: Tx, actorName: string, rows: EventInput[]): Promise<void> {
  if (!rows.length) return;
  // actor_name is also enforced by the logistics_events_actor trigger
  await tx.insert(schema.logisticsEvents).values(rows.map((r) => ({ ...r, actorName })));
}

export function revalidateLogistics(): void {
  revalidatePath("/logistics", "layout");
}

/* ── zod pieces ── */

export const uuid = z.uuid("מזהה לא תקין");
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `עד ${max} תווים`)
    .optional()
    .transform((s) => s || null);
export const kitLine = z.object({
  name: z.string().trim().min(1).max(60, "שם פריט משלים ארוך מדי"),
  qty: z.coerce.number().int().min(1).max(99),
});
export const kitList = z.array(kitLine).max(30, "יותר מדי פריטים משלימים");
