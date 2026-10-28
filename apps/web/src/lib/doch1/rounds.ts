import "server-only";
import { cache } from "react";
import { withUser } from "@gdud/db";
import type { Session } from "@/lib/session";
import { loadActiveRound, loadPlanningRound, type RoundVM } from "./data";

/**
 * The active round and the one being planned, loaded once per request: the דוח 1 layout and
 * the page render at the same time and both need them, so they share one transaction
 * (React's cache keys on the session object, which getSession also caches per request).
 */
export const doch1Rounds = cache(async (s: Session): Promise<{ active: RoundVM | null; planning: RoundVM | null }> => {
  const [active, planning] = await withUser(s.claims, (tx) => Promise.all([loadActiveRound(tx), loadPlanningRound(tx)]));
  return { active, planning };
});
