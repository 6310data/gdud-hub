import "server-only";
/**
 * Shared plumbing for kesher Server Actions. Every action:
 *   1. loads the session and checks the permission with kesherAccess (clear message),
 *   2. validates input with zod,
 *   3. writes through withUser() — RLS and the triggers of 0018_kesher_security.sql check again,
 *   4. appends readable rows to kesher_events (actor_name is set by trigger).
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@gdud/auth";
import { kesherAccess, type KesherAccess } from "@/lib/kesher/access";
import { getSession, type Session } from "@/lib/session";

export const NO_PERMISSION = { error: "אין לך הרשאה לפעולה הזו." } as const;

export interface KesherCtx {
  s: Session;
  access: KesherAccess;
}

/** The session of a kesher member, or null (not signed in / no membership). */
export async function kesherCtx(): Promise<KesherCtx | null> {
  const s = await getSession();
  if (!s || !can(s.user, "kesher", "any")) return null;
  return { s, access: kesherAccess(s) };
}

export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "קלט לא תקין";
}

export function revalidateKesher(): void {
  revalidatePath("/kesher", "layout");
}

export const uuid = z.uuid("מזהה לא תקין");
/** Trimmed text up to `max`; blank → null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `עד ${max} תווים`)
    .nullish()
    .transform((s) => s || null);
