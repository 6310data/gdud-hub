/**
 * דוח 1 rounds: creating the next round in the planning state, with the settings of the
 * current one, and activating it. Runs in the caller's withUser transaction (battalion doch1
 * admin; RLS checks).
 * Spec: docs/superpowers/specs/2026-10-27-doch1-round-planning-design.md, "Round states".
 */
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { Tx } from "../index";
import * as schema from "../schema/index";

const { doch1Rounds: rounds, doch1RoundCompanies: roundCompanies, doch1Statuses: statuses, doch1FieldOptions: options } = schema;
const { doch1Locations: locations, doch1StandbyTypes: standbyTypes, doch1Members: members, people } = schema;
const { doch1DmhCategories: dmhCategories, doch1ReportGroups: reportGroups } = schema;

/** A refusal meant for the admin (Hebrew, safe to show as is). */
export class RoundError extends Error {}

/** Rows of a raw `execute()` — postgres-js returns an array, PGlite `{ rows }`. */
function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);
}

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
 * Copy a round's settings into another: companies taking part (not the pilot date), שבצ״ק
 * locations, the current status versions (a status's camp → the new round's location of the
 * same name), both value lists, standby types, and the reports' דמ״ח categories and 10א groups.
 * Teams, vehicles' teams and members are not settings and are not copied.
 */
export async function copyRoundSettings(tx: Tx, from: string, to: string): Promise<void> {
  const rc = await tx.select().from(roundCompanies).where(eq(roundCompanies.roundId, from));
  if (rc.length) await tx.insert(roundCompanies).values(rc.map((c) => ({ roundId: to, unitId: c.unitId, active: c.active })));

  const ls = await tx.select().from(locations).where(eq(locations.roundId, from));
  const locationIds = new Map<string, string>();
  if (ls.length) {
    const created = await tx
      .insert(locations)
      .values(ls.map((l) => ({ roundId: to, name: l.name, kind: l.kind, sortOrder: l.sortOrder, active: l.active })))
      .returning({ id: locations.id, name: locations.name });
    for (const l of ls) locationIds.set(l.id, created.find((c) => c.name === l.name)!.id);
  }

  const st = await tx
    .select()
    .from(statuses)
    .where(and(eq(statuses.roundId, from), eq(statuses.active, true)));
  if (st.length) {
    await tx.insert(statuses).values(
      st.map(({ id: _id, roundId: _r, replacesId: _p, createdAt: _c, updatedAt: _u, locationId, ...s }) => ({
        ...s,
        roundId: to,
        locationId: locationId ? (locationIds.get(locationId) ?? null) : null,
      })),
    );
  }

  const os = await tx.select().from(options).where(eq(options.roundId, from));
  if (os.length) {
    await tx.insert(options).values(os.map((o) => ({ roundId: to, field: o.field, name: o.name, effect: o.effect, sortOrder: o.sortOrder })));
  }

  const ts = await tx.select().from(standbyTypes).where(eq(standbyTypes.roundId, from));
  if (ts.length) {
    await tx.insert(standbyTypes).values(
      ts.map((t) => ({ roundId: to, name: t.name, level: t.level, size: t.size, requiredRoles: t.requiredRoles, sortOrder: t.sortOrder, active: t.active })),
    );
  }

  const cs = await tx.select().from(dmhCategories).where(eq(dmhCategories.roundId, from));
  if (cs.length) await tx.insert(dmhCategories).values(cs.map((c) => ({ roundId: to, name: c.name, listed: c.listed, sortOrder: c.sortOrder })));

  const gs = await tx.select().from(reportGroups).where(eq(reportGroups.roundId, from));
  if (gs.length) {
    await tx.insert(reportGroups).values(gs.map((g) => ({ roundId: to, name: g.name, commander: g.commander, unitIds: g.unitIds, sortOrder: g.sortOrder })));
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

/**
 * "הפעלת סבב": close the active round, make the planning round active, and move every soldier
 * with a pending company move (planned_unit_id) to that unit — all in the caller's transaction,
 * so a failure anywhere leaves both rounds and every soldier as they were.
 */
export async function activateRound(tx: Tx, planningRoundId: string): Promise<{ closedRoundId: string | null; moved: number }> {
  const [check] = rowsOf<{ ok: boolean }>(await tx.execute(sql`select app.has_role('doch1', array['admin']) as ok`));
  if (!check?.ok) throw new RoundError("רק מנהל גדודי מפעיל סבב.");
  const [round] = await tx.select({ state: rounds.state }).from(rounds).where(eq(rounds.id, planningRoundId));
  if (round?.state !== "planning") throw new RoundError("הסבב לא בתכנון.");

  // one active round at a time (doch1_rounds_one_active): close the current one first
  const closed = await tx.update(rounds).set({ state: "closed" }).where(eq(rounds.active, true)).returning({ id: rounds.id });
  await tx.update(rounds).set({ state: "active" }).where(eq(rounds.id, planningRoundId));

  const moves = await tx
    .select({ personId: members.personId, unitId: members.plannedUnitId })
    .from(members)
    .where(and(eq(members.roundId, planningRoundId), isNotNull(members.plannedUnitId)));
  for (const m of moves) await tx.update(people).set({ unitId: m.unitId! }).where(eq(people.id, m.personId));
  if (moves.length) {
    await tx
      .update(members)
      .set({ plannedUnitId: null })
      .where(and(eq(members.roundId, planningRoundId), isNotNull(members.plannedUnitId)));
  }
  return { closedRoundId: closed[0]?.id ?? null, moved: moves.length };
}
