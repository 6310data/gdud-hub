/**
 * Compare the battalion's soldier list with the base round, for the round being planned.
 * planRoster() only reads; applyRoster() (apply.ts) writes the admin's decisions. Everything runs in
 * the caller's RLS transaction (battalion doch1 admin).
 * Spec: docs/superpowers/specs/2026-10-27-doch1-round-planning-design.md, "The battalion list".
 */
import { canonicalName, diffRoster, normalizePersonalNumber, placement, type Day, type RosterDiff, type RosterMember, type RosterRow, type UnitKind } from "@gdud/core";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { baseRound } from "../doch1-rounds/index";
import type { Tx } from "../index";
import * as schema from "../schema/index";
import { RosterImportError, type RosterFile, type RosterFileRow } from "./parse";

const { units, people, doch1Rounds: rounds, doch1Members: members, doch1FieldOptions: options, doch1ImportMappings: mappings } = schema;

export interface RosterAnswers {
  /** company text (canonical) → company unit id, or "ignore" (its rows are left out) */
  companies?: Record<string, string>;
  /** `${companyId}|${canonical platoon text}` → unit id under the company, "create" or "company" */
  platoons?: Record<string, string>;
  /** צפי הגעה text (canonical) → value id of the planning round's list, or `create:<effect>` */
  arrival?: Record<string, string>;
}

export interface RosterQuestion {
  kind: "company" | "platoon" | "arrival";
  key: string;
  label: string;
  suggestion: string | null;
  options: Array<{ id: string; label: string }>;
}

export interface RosterPlan {
  planningRoundId: string;
  /** the round the list is compared with when the planning round has no soldiers yet */
  baseRoundId: string | null;
  /** "planning" once the planning round has soldiers: a re-run shows only what is still different */
  comparedWith: "base" | "planning";
  diff: RosterDiff;
  questions: RosterQuestion[];
  warnings: string[];
  /** rows left out until a company / platoon question is answered */
  waiting: number;
  /** soldiers of the active round: a company move for them waits for the activation */
  inActiveRound: Set<string>;
  /** personal number → צפי הגעה value id, or newArrivalId(key) for a value apply creates */
  arrival: Map<string, string>;
  /** personal number → תאריך גיוס from the file */
  callUpOn: Map<string, Day>;
  /** platoon key → the platoon text as written, for the platoons to create */
  newPlatoons: Map<string, { companyId: string; name: string }>;
  /** values answered `create:<effect>`: canonical text → the name as written and the effect */
  newArrival: Map<string, { name: string; effect: schema.FieldOptionEffect }>;
}

/** Stand in for the id of a platoon / a צפי הגעה value apply will create. */
export const newPlatoonId = (key: string) => `new:${key}`;
export const newArrivalId = (key: string) => `new:${key}`;

type UnitRow = { id: string; parentId: string | null; kind: UnitKind; name: string; active: boolean };

function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);
}

/** The battalion doch1 admin only (RLS limits the writes anyway; this gives a clear message). */
export async function requireDoch1Admin(tx: Tx): Promise<void> {
  const [check] = rowsOf<{ ok: boolean }>(await tx.execute(sql`select app.has_role('doch1', array['admin']) as ok`));
  if (!check?.ok) throw new RosterImportError("רק מנהל גדודי מייבא את רשימת הגדוד.");
}

/** The planning round, checked. */
export async function planningRound(tx: Tx, id: string) {
  const [r] = await tx.select().from(rounds).where(eq(rounds.id, id));
  if (!r || r.state !== "planning") throw new RosterImportError("הסבב לא בתכנון.");
  return r;
}

async function rosterMembers(tx: Tx, roundId: string): Promise<RosterMember[]> {
  return tx
    .select({
      personId: people.id,
      personalNumber: people.personalNumber,
      fullName: people.fullName,
      unitId: people.unitId,
      phone: people.phone,
      role: people.roleTitle,
    })
    .from(members)
    .innerJoin(people, eq(people.id, members.personId))
    .where(eq(members.roundId, roundId));
}

export async function planRoster(
  tx: Tx,
  input: { planningRoundId: string; baseRoundId?: string; file: RosterFile; answers: RosterAnswers },
): Promise<RosterPlan> {
  await requireDoch1Admin(tx);
  const planning = await planningRound(tx, input.planningRoundId);
  let baseRoundId: string | null;
  if (input.baseRoundId) {
    const [b] = await tx.select().from(rounds).where(eq(rounds.id, input.baseRoundId));
    if (!b || b.state === "planning") throw new RosterImportError("אפשר להשוות רק לסבב פעיל או סגור.");
    baseRoundId = b.id;
  } else {
    baseRoundId = await baseRound(tx, planning.id);
  }

  const allUnits: UnitRow[] = await tx
    .select({ id: units.id, parentId: units.parentId, kind: units.kind, name: units.name, active: units.active })
    .from(units);
  const byId = new Map(allUnits.map((u) => [u.id, u]));
  const companies = allUnits.filter((u) => u.kind === "company" && u.active);
  const saved = new Map<string, Map<string, string | null>>();
  for (const m of await tx.select().from(mappings).where(eq(mappings.roundId, planning.id))) {
    if (!saved.has(m.kind)) saved.set(m.kind, new Map());
    saved.get(m.kind)!.set(m.sourceKey, m.targetId);
  }
  const savedOf = (kind: string, key: string) => saved.get(kind)?.get(key);

  const questions: RosterQuestion[] = [];
  const asked = new Set<string>();
  const ask = (q: RosterQuestion) => {
    if (asked.has(`${q.kind}|${q.key}`)) return;
    asked.add(`${q.kind}|${q.key}`);
    questions.push(q);
  };
  const warnings = [...input.file.warnings];

  /* companies and platoons → units; a row with an open question waits */
  const companyOf = new Map<string, string | null | undefined>();
  const resolveCompany = (text: string): string | null | undefined => {
    const key = canonicalName(text);
    if (companyOf.has(key)) return companyOf.get(key);
    const valid = (id: string | null | undefined) => (id && companies.some((c) => c.id === id) ? id : undefined);
    const given = input.answers.companies?.[key];
    const s = savedOf("company", key);
    const answer =
      given === "ignore" ? null : valid(given) ?? (s === null ? null : valid(s)) ?? companies.find((c) => canonicalName(c.name) === key)?.id;
    if (answer === undefined) {
      ask({ kind: "company", key, label: text, suggestion: "ignore", options: companies.map((c) => ({ id: c.id, label: c.name })) });
    }
    companyOf.set(key, answer);
    return answer;
  };
  const newPlatoons = new Map<string, { companyId: string; name: string }>();
  const resolvePlatoon = (companyId: string, text: string): string | undefined => {
    const key = `${companyId}|${canonicalName(text)}`;
    const under = allUnits.filter((u) => u.id !== companyId && placement(u.id, byId).company?.id === companyId);
    const valid = (id: string | null | undefined) => (id && (id === companyId || under.some((u) => u.id === id)) ? id : undefined);
    const given = input.answers.platoons?.[key];
    const canon = canonicalName(text);
    const answer =
      given === "create" ? "create" : given === "company" ? companyId
      : valid(given) ?? valid(savedOf("platoon", key))
      ?? (under.find((u) => u.kind === "platoon" && canonicalName(u.name) === canon) ?? under.find((u) => canonicalName(u.name) === canon))?.id;
    if (answer === undefined) {
      ask({
        kind: "platoon",
        key,
        label: `${byId.get(companyId)?.name ?? ""} · ${text}`,
        suggestion: "create",
        options: under.filter((u) => u.active).map((u) => ({ id: u.id, label: u.name })),
      });
      return undefined;
    }
    if (answer !== "create") return answer;
    newPlatoons.set(key, { companyId, name: text });
    return newPlatoonId(key);
  };

  const resolved = new Map<RosterRow, string>();
  const ready: RosterFileRow[] = [];
  const ignored = new Map<string, number>();
  let waiting = 0;
  for (const row of input.file.rows) {
    if (!row.company) {
      ready.push(row); // no company: diffRoster lists it as a problem
      continue;
    }
    const companyId = resolveCompany(row.company);
    if (companyId === null) {
      ignored.set(row.company, (ignored.get(row.company) ?? 0) + 1);
      continue;
    }
    const unitId = companyId === undefined ? undefined : row.platoon ? resolvePlatoon(companyId, row.platoon) : companyId;
    if (unitId === undefined) {
      waiting++;
      continue;
    }
    resolved.set(row, unitId);
    ready.push(row);
  }
  for (const [company, n] of ignored) warnings.push(`${n} חיילים של ״${company}״ לא נקראו (סומן להתעלם).`);

  /* compare: with the planning round's soldiers once it has any, else with the base round */
  const ours = await rosterMembers(tx, planning.id);
  const comparedWith = ours.length ? "planning" : "base";
  const base = ours.length ? ours : baseRoundId ? await rosterMembers(tx, baseRoundId) : [];
  const known = new Map(
    (
      await tx
        .select({ personId: people.id, personalNumber: people.personalNumber, fullName: people.fullName, unitId: people.unitId, phone: people.phone, role: people.roleTitle })
        .from(people)
        .where(isNotNull(people.personalNumber))
    ).map((m) => [m.personalNumber!, m]),
  );
  const diff = diffRoster({ rows: ready, base, known, unitOf: (row) => resolved.get(row) ?? null });

  /* צפי הגעה → the planning round's list */
  const arrival = new Map<string, string>();
  const newArrival = new Map<string, { name: string; effect: schema.FieldOptionEffect }>();
  const list = (await tx.select().from(options).where(and(eq(options.roundId, planning.id), eq(options.field, "arrival")))).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const effects: readonly string[] = schema.FIELD_OPTION_EFFECTS.arrival;
  for (const row of ready) {
    const pn = normalizePersonalNumber(row.personalNumber);
    if (!pn || !row.arrival) continue;
    const key = canonicalName(row.arrival);
    const given = input.answers.arrival?.[key];
    const valid = (id: string | null | undefined) => (id && list.some((o) => o.id === id) ? id : undefined);
    const answer =
      (given?.startsWith("create:") && effects.includes(given.slice(7)) ? given : undefined)
      ?? valid(given) ?? valid(savedOf("arrival", key)) ?? list.find((o) => canonicalName(o.name) === key)?.id
      ?? (list.length === 0 ? "create:arriving" : undefined);
    if (answer === undefined) {
      ask({ kind: "arrival", key, label: row.arrival, suggestion: "create:arriving", options: list.map((o) => ({ id: o.id, label: o.name })) });
      continue;
    }
    if (answer.startsWith("create:")) {
      newArrival.set(key, { name: row.arrival.slice(0, 30), effect: answer.slice(7) as schema.FieldOptionEffect });
      arrival.set(pn, newArrivalId(key));
    } else {
      arrival.set(pn, answer);
    }
  }
  const callUpOn = new Map<string, Day>();
  for (const row of ready) {
    const pn = normalizePersonalNumber(row.personalNumber);
    if (pn && row.callUpOn) callUpOn.set(pn, row.callUpOn);
  }

  /* who is in the running round */
  const [active] = await tx.select({ id: rounds.id }).from(rounds).where(eq(rounds.active, true));
  const inActiveRound = new Set(
    active ? (await tx.select({ personId: members.personId }).from(members).where(eq(members.roundId, active.id))).map((m) => m.personId) : [],
  );

  return {
    planningRoundId: planning.id,
    baseRoundId,
    comparedWith,
    diff,
    questions,
    warnings,
    waiting,
    inActiveRound,
    arrival,
    callUpOn,
    newPlatoons,
    newArrival,
  };
}
