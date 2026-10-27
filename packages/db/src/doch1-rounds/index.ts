/**
 * דוח 1 rounds: creating the next round in the planning state, with the settings of the
 * current one. Runs in the caller's withUser transaction (battalion doch1 admin; RLS checks).
 * Spec: docs/superpowers/specs/2026-10-27-doch1-round-planning-design.md, "Round states".
 */
import { and, desc, eq, ne } from "drizzle-orm";
import type { Tx } from "../index";
import * as schema from "../schema/index";

const { doch1Rounds: rounds, doch1RoundCompanies: roundCompanies, doch1Statuses: statuses, doch1FieldOptions: options } = schema;
const { doch1Locations: locations, doch1StandbyTypes: standbyTypes } = schema;

export interface NewRound {
  name: string;
  startsOn: string;
  endsOn: string;
  callUpOn: string | null;
  reminderAt: string;
  lockAt: string;
  sendAt: string;
}

/** The round a new one copies from and is compared with: the active round, else the latest by start date. */
export async function baseRound(tx: Tx, except?: string): Promise<string | null> {
  const [r] = await tx
    .select({ id: rounds.id })
    .from(rounds)
    .where(except ? ne(rounds.id, except) : undefined)
    .orderBy(desc(rounds.active), desc(rounds.startsOn))
    .limit(1);
  return r?.id ?? null;
}

/**
 * Copy a round's settings into another: companies taking part (not the pilot date), the current
 * status versions, both value lists, שבצ״ק locations and standby types. Teams, vehicles' teams and
 * members are not settings and are not copied.
 */
export async function copyRoundSettings(tx: Tx, from: string, to: string): Promise<void> {
  const rc = await tx.select().from(roundCompanies).where(eq(roundCompanies.roundId, from));
  if (rc.length) await tx.insert(roundCompanies).values(rc.map((c) => ({ roundId: to, unitId: c.unitId, active: c.active })));

  const st = await tx
    .select()
    .from(statuses)
    .where(and(eq(statuses.roundId, from), eq(statuses.active, true)));
  if (st.length) {
    await tx.insert(statuses).values(
      st.map(({ id: _id, roundId: _r, replacesId: _p, createdAt: _c, updatedAt: _u, ...s }) => ({ ...s, roundId: to })),
    );
  }

  const os = await tx.select().from(options).where(eq(options.roundId, from));
  if (os.length) {
    await tx.insert(options).values(os.map((o) => ({ roundId: to, field: o.field, name: o.name, effect: o.effect, sortOrder: o.sortOrder })));
  }

  const ls = await tx.select().from(locations).where(eq(locations.roundId, from));
  if (ls.length) {
    await tx.insert(locations).values(ls.map((l) => ({ roundId: to, name: l.name, kind: l.kind, sortOrder: l.sortOrder, active: l.active })));
  }

  const ts = await tx.select().from(standbyTypes).where(eq(standbyTypes.roundId, from));
  if (ts.length) {
    await tx.insert(standbyTypes).values(
      ts.map((t) => ({ roundId: to, name: t.name, level: t.level, size: t.size, requiredRoles: t.requiredRoles, sortOrder: t.sortOrder, active: t.active })),
    );
  }
}

/**
 * Create the next round in the planning state and copy the settings of the base round into it.
 * A second planning round fails on doch1_rounds_one_planning.
 */
export async function createPlanningRound(tx: Tx, values: NewRound): Promise<{ id: string; copiedFrom: string | null }> {
  const from = await baseRound(tx);
  const [r] = await tx
    .insert(rounds)
    .values({ ...values, state: "planning" })
    .returning({ id: rounds.id });
  if (from) await copyRoundSettings(tx, from, r!.id);
  return { id: r!.id, copiedFrom: from };
}
