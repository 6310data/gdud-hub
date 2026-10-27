import "server-only";
/**
 * Shared plumbing for דוח 1 Server Actions. Every action:
 *   1. loads the session + active round and checks the permission with can() (clear message),
 *   2. validates input with zod,
 *   3. writes through withUser() — RLS and the day guard trigger enforce the same rules again.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@gdud/auth";
import { isDay, type Day } from "@gdud/core";
import { withUser } from "@gdud/db";
import { doch1Access, type Doch1Access } from "@/lib/doch1/access";
import { loadActiveRound, loadPlanningRound, loadRoundCompanies, type RoundVM } from "@/lib/doch1/data";
import { getSession, type Session } from "@/lib/session";

export const NO_PERMISSION = { error: "אין לך הרשאה לפעולה הזו." } as const;
export const NO_ROUND = { error: "אין סבב פעיל. יש להגדיר סבב בהגדרות." } as const;

export interface Doch1Ctx {
  s: Session;
  access: Doch1Access;
  round: RoundVM;
}

/** Session of a doch1 member with the active round, or null (no session / membership / round). */
export async function doch1Ctx(): Promise<Doch1Ctx | null> {
  const s = await getSession();
  if (!s || !can(s.user, "doch1", "any")) return null;
  const loaded = await withUser(s.claims, async (tx) => {
    const round = await loadActiveRound(tx);
    const companies = round ? await loadRoundCompanies(tx, round.id) : [];
    return { round, companyIds: companies.filter((c) => c.active).map((c) => c.unitId) };
  });
  if (!loaded.round) return null;
  return { s, access: doch1Access(s, loaded.companyIds), round: loaded.round };
}

export const NO_PLANNING_ROUND = { error: "אין סבב בתכנון. יוצרים אותו בהגדרות." } as const;

/** Session of a doch1 member with the round being planned (בתכנון), active round or not. */
export async function doch1PlanningCtx(): Promise<{ s: Session; access: Doch1Access; round: RoundVM } | null> {
  const s = await getSession();
  if (!s || !can(s.user, "doch1", "any")) return null;
  const round = await withUser(s.claims, (tx) => loadPlanningRound(tx));
  return round ? { s, access: doch1Access(s), round } : null;
}

/** Session of a battalion-wide doch1 master admin, active round or not (settings must work before the first round). */
export async function doch1MasterSession(): Promise<Session | null> {
  const s = await getSession();
  return s && doch1Access(s).isMaster ? s : null;
}

export function revalidateDoch1(): void {
  revalidatePath("/doch1", "layout");
}

export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "קלט לא תקין";
}

/* ── zod pieces ── */

export const uuid = z.uuid("מזהה לא תקין");
export const dayParam = z.string().refine((v): v is Day => isDay(v), "תאריך לא תקין");
