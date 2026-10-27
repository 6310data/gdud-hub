/**
 * Write the admin's decisions on the battalion list into the round being planned, and the
 * "copy last round" fallback. Like the sheet import, apply runs the comparison again inside the
 * same transaction, so the browser only sends decisions (personal numbers / person ids), never data.
 * A company move of a soldier in the running round waits on the planning membership
 * (planned_unit_id) until the round is activated.
 */
import type { ResolvedRow, RosterField, RosterMatch } from "@gdud/core";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { baseRound } from "../doch1-rounds/index";
import type { Tx } from "../index";
import * as schema from "../schema/index";
import { RosterImportError } from "./parse";
import { newPlatoonId, planningRound, planRoster, requireDoch1Admin, type RosterAnswers } from "./plan";
import type { RosterFile } from "./parse";

const { units, people, doch1Members: members, doch1Locations: locations, doch1FieldOptions: options, doch1ImportMappings: mappings } = schema;

export interface RosterDecisions {
  /** personal numbers of new and returning soldiers to add to the round (others are left out) */
  add: string[];
  /** personal number → the fields taken from the battalion's list (changed and returning soldiers) */
  take: Record<string, RosterField[]>;
  /** person ids of soldiers not on the battalion's list who stay in the round */
  keepMissing: string[];
}

export interface RosterApplyCounts {
  /** people rows created / updated */
  created: number;
  updated: number;
  /** soldiers in the planning round after the apply */
  members: number;
  /** soldiers taken out of the planning round (a re-run that drops someone) */
  removed: number;
  /** company moves waiting for the activation */
  pendingMoves: number;
  platoonsCreated: number;
  optionsCreated: number;
}

function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);
}

/**
 * What a new planning membership carries over from the soldier's membership in `fromRound`:
 * תפקיד לדמ״ח, דיסקית, notes, and the שבצ״ק location (the planning round's location of the same name).
 */
async function carryOver(tx: Tx, fromRound: string | null, toRound: string, personIds: string[]) {
  const out = new Map<string, { dmhCategory: string | null; hasDisc: boolean | null; notes: string | null; locationId: string | null }>();
  if (!fromRound || !personIds.length) return out;
  const rows = await tx
    .select({ personId: members.personId, dmhCategory: members.dmhCategory, hasDisc: members.hasDisc, notes: members.notes, location: locations.name })
    .from(members)
    .leftJoin(locations, eq(locations.id, members.locationId))
    .where(and(eq(members.roundId, fromRound), inArray(members.personId, personIds)));
  const target = new Map(
    (await tx.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.roundId, toRound))).map((l) => [l.name, l.id]),
  );
  for (const r of rows) {
    out.set(r.personId, { dmhCategory: r.dmhCategory, hasDisc: r.hasDisc, notes: r.notes, locationId: r.location ? (target.get(r.location) ?? null) : null });
  }
  return out;
}

export async function applyRoster(
  tx: Tx,
  input: { planningRoundId: string; baseRoundId?: string; file: RosterFile; answers: RosterAnswers; decisions: RosterDecisions },
): Promise<RosterApplyCounts> {
  const plan = await planRoster(tx, input);
  if (plan.questions.length) throw new RosterImportError("נשארו שאלות פתוחות. עדכנו את התצוגה המקדימה ונסו שוב.");
  const round = await planningRound(tx, plan.planningRoundId);
  const { diff } = plan;
  const add = new Set(input.decisions.add);
  const keepMissing = new Set(input.decisions.keepMissing);
  const take = (pn: string, f: RosterField) => input.decisions.take[pn]?.includes(f) ?? false;

  const added = diff.added.filter((r) => add.has(r.personalNumber));
  const returning = diff.returning.filter((m) => add.has(m.row.personalNumber));
  const matched: RosterMatch[] = [...diff.changed, ...returning];
  const unitTaken = (m: RosterMatch) => m.fields.includes("unit") && take(m.row.personalNumber, "unit");

  /* platoons the decisions use (creating units needs the core admin role) */
  const platoonIds = new Map<string, string>();
  const usedPlatoons = [...plan.newPlatoons].filter(([key]) =>
    [...added, ...matched.filter(unitTaken).map((m) => m.row)].some((r) => r.unitId === newPlatoonId(key)),
  );
  if (usedPlatoons.length) {
    const [check] = rowsOf<{ ok: boolean }>(await tx.execute(sql`select app.has_role('core', array['admin']) as ok`));
    if (!check?.ok) throw new RosterImportError("ליצירת מחלקות צריך הרשאת מנהל ליבה");
    for (const [key, p] of usedPlatoons) {
      const [u] = await tx.insert(units).values({ parentId: p.companyId, kind: "platoon", name: p.name }).returning({ id: units.id });
      platoonIds.set(key, u!.id);
    }
  }
  const unitOf = (row: ResolvedRow) => (row.unitId.startsWith("new:") ? platoonIds.get(row.unitId.slice(4))! : row.unitId);

  /* צפי הגעה values answered "create" */
  const optionIds = new Map<string, string>();
  if (plan.newArrival.size) {
    const [max] = rowsOf<{ n: number | null }>(
      await tx.execute(sql`select max(sort_order) as n from public.doch1_field_options where round_id = ${round.id}::uuid and field = 'arrival'`),
    );
    let sortOrder = (max?.n ?? -1) + 1;
    for (const [key, o] of plan.newArrival) {
      const [row] = await tx
        .insert(options)
        .values({ roundId: round.id, field: "arrival", name: o.name, effect: o.effect, sortOrder: sortOrder++ })
        .returning({ id: options.id });
      optionIds.set(key, row!.id);
    }
  }
  const arrivalOf = (pn: string): string | null => {
    const a = plan.arrival.get(pn);
    return a?.startsWith("new:") ? (optionIds.get(a.slice(4)) ?? null) : (a ?? null);
  };

  /* people */
  let created = 0;
  let updated = 0;
  const personOf = new Map<string, string>();
  if (added.length) {
    const rows = await tx
      .insert(people)
      .values(added.map((r) => ({ unitId: unitOf(r), fullName: r.fullName || r.personalNumber, personalNumber: r.personalNumber, phone: r.phone, roleTitle: r.role })))
      .returning({ id: people.id, personalNumber: people.personalNumber });
    for (const r of rows) personOf.set(r.personalNumber!, r.id);
    created = rows.length;
  }
  const planned = new Map<string, string>();
  for (const m of matched) {
    const pn = m.row.personalNumber;
    personOf.set(pn, m.member.personId);
    const set: Partial<typeof people.$inferInsert> = {};
    if (m.fields.includes("name") && take(pn, "name")) set.fullName = m.row.fullName;
    if (m.fields.includes("phone") && take(pn, "phone")) set.phone = m.row.phone;
    if (m.fields.includes("role") && take(pn, "role")) set.roleTitle = m.row.role;
    if (unitTaken(m)) {
      // a soldier of the running round moves only when this round is activated
      if (plan.inActiveRound.has(m.member.personId)) planned.set(m.member.personId, unitOf(m.row));
      else set.unitId = unitOf(m.row);
    }
    if (Object.keys(set).length) {
      await tx.update(people).set(set).where(eq(people.id, m.member.personId));
      updated++;
    }
  }
  for (const m of diff.unchanged) personOf.set(m.row.personalNumber, m.member.personId);

  /* the planning round's soldiers */
  const keep = [...personOf.values(), ...diff.missing.filter((m) => keepMissing.has(m.personId)).map((m) => m.personId)];
  const existing = new Set(
    (await tx.select({ personId: members.personId }).from(members).where(eq(members.roundId, round.id))).map((m) => m.personId),
  );
  const fresh = keep.filter((id) => !existing.has(id));
  const carried = await carryOver(tx, plan.comparedWith === "base" ? plan.baseRoundId : null, round.id, fresh);
  const numberOf = new Map([...personOf].map(([pn, id]) => [id, pn]));
  for (const personId of keep) {
    const pn = numberOf.get(personId);
    const callUpOn = (pn && plan.callUpOn.get(pn)) || null;
    const arrival = pn ? arrivalOf(pn) : null;
    if (existing.has(personId)) {
      const set: Partial<typeof members.$inferInsert> = { plannedUnitId: planned.get(personId) ?? null };
      if (callUpOn) set.callUpOn = callUpOn;
      if (arrival) set.arrivalOptionId = arrival;
      await tx
        .update(members)
        .set(set)
        .where(and(eq(members.roundId, round.id), eq(members.personId, personId)));
    } else {
      await tx.insert(members).values({
        roundId: round.id,
        personId,
        callUpOn: callUpOn ?? round.callUpOn,
        arrivalOptionId: arrival,
        plannedUnitId: planned.get(personId) ?? null,
        ...carried.get(personId),
      });
    }
  }
  // a re-run: soldiers dropped this time leave the planning round
  const removed = existing.size
    ? (
        await tx
          .delete(members)
          .where(and(eq(members.roundId, round.id), keep.length ? notInArray(members.personId, keep) : undefined))
          .returning({ personId: members.personId })
      ).length
    : 0;

  /* remember the answers for the next run */
  const save: Array<{ kind: string; sourceKey: string; targetId: string | null }> = [
    ...Object.entries(input.answers.companies ?? {}).map(([sourceKey, t]) => ({ kind: "company", sourceKey, targetId: t === "ignore" ? null : t })),
    ...Object.entries(input.answers.platoons ?? {}).flatMap(([sourceKey, t]) => {
      const targetId = t === "create" ? platoonIds.get(sourceKey) : t === "company" ? sourceKey.slice(0, sourceKey.indexOf("|")) : t;
      return targetId ? [{ kind: "platoon", sourceKey, targetId }] : [];
    }),
    ...Object.entries(input.answers.arrival ?? {}).flatMap(([sourceKey, t]) => {
      const targetId = t.startsWith("create:") ? optionIds.get(sourceKey) : t;
      return targetId ? [{ kind: "arrival", sourceKey, targetId }] : [];
    }),
  ];
  if (save.length) {
    await tx
      .insert(mappings)
      .values(save.map((m) => ({ ...m, roundId: round.id })))
      .onConflictDoUpdate({ target: [mappings.roundId, mappings.kind, mappings.sourceKey], set: { targetId: sql`excluded.target_id` } });
  }

  return {
    created,
    updated,
    members: keep.length,
    removed,
    pendingMoves: planned.size,
    platoonsCreated: platoonIds.size,
    optionsCreated: plan.newArrival.size,
  };
}

/**
 * Without the battalion's list: every soldier of the base round joins the planning round (once),
 * with the round's call-up day and what carryOver() takes.
 */
export async function copyFromRound(tx: Tx, input: { planningRoundId: string; baseRoundId?: string }): Promise<{ members: number }> {
  await requireDoch1Admin(tx);
  const round = await planningRound(tx, input.planningRoundId);
  const from = input.baseRoundId ?? (await baseRound(tx, round.id));
  if (!from || from === round.id) throw new RosterImportError("אין סבב להעתיק ממנו.");
  const have = new Set((await tx.select({ personId: members.personId }).from(members).where(eq(members.roundId, round.id))).map((m) => m.personId));
  const ids = (await tx.select({ personId: members.personId }).from(members).where(eq(members.roundId, from)))
    .map((m) => m.personId)
    .filter((id) => !have.has(id));
  const carried = await carryOver(tx, from, round.id, ids);
  if (ids.length) {
    await tx.insert(members).values(ids.map((personId) => ({ roundId: round.id, personId, callUpOn: round.callUpOn, ...carried.get(personId) })));
  }
  return { members: ids.length };
}
