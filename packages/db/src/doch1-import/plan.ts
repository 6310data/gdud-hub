/**
 * Resolve a parsed round sheet against the database: which tab is which company, which
 * platoon text is which unit, which day value is which status, which שבצ״ק מיקום is which
 * location (standby.ts) — and what an import would
 * change. planSheetImport() only reads; applySheetImport() (apply.ts) runs the same
 * resolution and then writes. Everything runs in the caller's RLS transaction.
 */
import { canonicalName, placement, type Day, type UnitKind } from "@gdud/core";
import { eq, inArray } from "drizzle-orm";
import type { Tx } from "../index";
import * as schema from "../schema/index";
import type { ParsedRow, ParsedSheet, ParsedTab, StatusGroup } from "./parse";
import { resolveStandby, standbyChanges, type LocationAnswer, type StandbyResolution } from "./standby";

const { units, people, doch1Rounds, doch1RoundCompanies, doch1Statuses, doch1Members, doch1Days, doch1ImportMappings } = schema;

export interface ImportMappings {
  /** tab key → company unit id ("create" = a new company named after the tab) */
  tabs: Record<string, string | "ignore" | "create">;
  /** `${companyId}|${canonical platoon text}` → unit id ("company" = the soldier stays at company level) */
  platoons: Record<string, string | "create" | "company">;
  /** sheet value → status id */
  statuses: Record<string, string | "create">;
  /** שבצ״ק מיקום (canonical) → location id, `create:<kind>` or "ignore" */
  locations?: Record<string, LocationAnswer>;
}

export interface MappingQuestion {
  kind: "tab" | "platoon" | "status" | "location";
  key: string;
  label: string;
  suggestion: string | null;
  options: Array<{ id: string; label: string }>;
}

export interface ImportCounts {
  newPeople: number;
  updatedPeople: number;
  members: number;
  daysWritten: number;
  daysCleared: number;
  daysSkippedPilot: number;
  statusesCreated: number;
  platoonsCreated: number;
  companiesCreated: number;
  /** שבצ״ק */
  locationsCreated: number;
  /** soldiers whose location changes */
  locationsSet: number;
  teamsCreated: number;
  /** soldiers added to, removed from or with a new role on a team */
  teamMembersChanged: number;
  vehiclesCreated: number;
}

export interface SheetImportPlan {
  roundId: string;
  questions: MappingQuestion[];
  counts: ImportCounts;
  /** duplicates, invalid rows, days outside the round */
  warnings: string[];
  /** in the round, not in the file — kept */
  notInSheet: Array<{ personId: string; name: string; company: string }>;
}

export const DOCH1_NEW_STATUS_COLOR = "#7a8699";

/** A problem the admin can fix (message in Hebrew, safe to show as is). */
export class SheetImportError extends Error {}
const READ_CHUNK = 500;

/* ── resolution ─────────────────────────────────────────────────────────── */

type UnitRow = { id: string; parentId: string | null; kind: UnitKind; name: string; active: boolean };
type StatusRow = typeof doch1Statuses.$inferSelect;
type PersonRow = typeof people.$inferSelect;
type MemberRow = typeof doch1Members.$inferSelect;

/** A soldier row that will be imported: from a mapped tab, deduplicated. */
export interface ChosenRow {
  tab: ParsedTab;
  row: ParsedRow;
  companyId: string;
  /** null = no platoon text (company level) */
  platoonKey: string | null;
}

export interface NewStatus {
  value: string;
  sortOrder: number;
  groups: StatusGroup[];
}

export interface Resolution {
  round: { id: string; startsOn: Day; endsOn: Day };
  questions: MappingQuestion[];
  warnings: string[];
  chosen: ChosenRow[];
  /** tab key → company id (newCompanyId() for a company to create) or null (ignore); only answered tabs */
  tabMap: Map<string, string | null>;
  /** tab key → tab name, for the tabs answered "create" */
  newCompanies: Map<string, string>;
  /** platoon key → unit id or "create"; only answered keys */
  platoonMap: Map<string, string | "create">;
  /** platoon key → the sheet text as written (for creating it) */
  platoonText: Map<string, string>;
  /** value → status id or "create"; only answered values */
  statusMap: Map<string, string | "create">;
  newStatuses: NewStatus[];
  roundCompanies: Map<string, { active: boolean; appFrom: Day | null }>;
  existingPeople: Map<string, PersonRow>;
  existingMembers: Map<string, MemberRow>;
  /** `${personId}|${day}` → statusId */
  existingDays: Map<string, string>;
  /** the current (active) version of a status of this round, following replacements */
  currentStatus: (statusId: string) => string | undefined;
  units: UnitRow[];
  standby: StandbyResolution;
}

const platoonKeyOf = (companyId: string, text: string) => `${companyId}|${canonicalName(text)}`;
/** Stands in for the id of a company the import will create; apply swaps it for the real id. */
export const newCompanyId = (tabKey: string) => `new:${tabKey}`;

function descendantsOf(companyId: string, all: readonly UnitRow[]): UnitRow[] {
  const byId = new Map(all.map((u) => [u.id, u]));
  return all.filter((u) => u.id !== companyId && placement(u.id, byId).company?.id === companyId);
}

async function loadSaved(tx: Tx, roundId: string): Promise<Record<"company" | "platoon" | "status" | "location", Map<string, string | null>>> {
  const rows = await tx.select().from(doch1ImportMappings).where(eq(doch1ImportMappings.roundId, roundId));
  const out = {
    company: new Map<string, string | null>(),
    platoon: new Map<string, string | null>(),
    status: new Map<string, string | null>(),
    location: new Map<string, string | null>(),
  };
  for (const r of rows) out[r.kind as keyof typeof out]?.set(r.sourceKey, r.targetId);
  return out;
}

async function inChunks<T, R>(items: readonly T[], fn: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += READ_CHUNK) out.push(...(await fn(items.slice(i, i + READ_CHUNK))));
  return out;
}

export async function resolveSheetImport(tx: Tx, roundId: string, parsed: ParsedSheet, mappings: Partial<ImportMappings>): Promise<Resolution> {
  const [round] = await tx.select().from(doch1Rounds).where(eq(doch1Rounds.id, roundId));
  if (!round) throw new SheetImportError("הסבב לא נמצא");
  const allUnits: UnitRow[] = await tx
    .select({ id: units.id, parentId: units.parentId, kind: units.kind, name: units.name, active: units.active })
    .from(units);
  const companies = allUnits.filter((u) => u.kind === "company" && u.active);
  const companyIds = new Set(companies.map((c) => c.id));
  const saved = await loadSaved(tx, roundId);
  const rcRows = await tx.select().from(doch1RoundCompanies).where(eq(doch1RoundCompanies.roundId, roundId));
  const roundCompanies = new Map(rcRows.map((r) => [r.unitId, { active: r.active, appFrom: r.appFrom }]));
  const statuses: StatusRow[] = await tx.select().from(doch1Statuses).where(eq(doch1Statuses.roundId, roundId));

  const questions: MappingQuestion[] = [];
  const warnings = [...parsed.warnings];

  /* tabs → companies */
  const tabMap = new Map<string, string | null>();
  const newCompanies = new Map<string, string>();
  for (const tab of parsed.tabs) {
    if (tabMap.has(tab.key) || questions.some((q) => q.kind === "tab" && q.key === tab.key)) continue;
    const given = mappings.tabs?.[tab.key];
    const savedTarget = saved.company.get(tab.key);
    const auto = companies.find((c) => canonicalName(c.name) === tab.key)?.id;
    if (given === "create") {
      tabMap.set(tab.key, newCompanyId(tab.key));
      newCompanies.set(tab.key, tab.tabName);
      continue;
    }
    const answer =
      given === "ignore" ? null : given && companyIds.has(given) ? given
      : savedTarget === null ? null : savedTarget && companyIds.has(savedTarget) ? savedTarget
      : auto;
    if (answer === undefined) {
      questions.push({
        kind: "tab",
        key: tab.key,
        label: tab.tabName,
        suggestion: "ignore",
        options: companies.map((c) => ({ id: c.id, label: c.name })),
      });
    } else {
      tabMap.set(tab.key, answer);
    }
  }

  /* rows of mapped tabs, one per personal number: prefer a company active in this round, then a
     visible tab (a hidden tab is an old company's, e.g. פלתצ), then the first tab */
  const isActive = (companyId: string) => roundCompanies.get(companyId)?.active ?? true;
  const rank = (c: ChosenRow) => (isActive(c.companyId) ? 2 : 0) + (c.tab.hidden ? 0 : 1);
  const byNumber = new Map<string, ChosenRow>();
  for (const tab of parsed.tabs) {
    const companyId = tabMap.get(tab.key);
    if (!companyId) continue;
    for (const row of tab.rows) {
      const candidate: ChosenRow = {
        tab,
        row,
        companyId,
        platoonKey: row.platoonText ? platoonKeyOf(companyId, row.platoonText) : null,
      };
      const prev = byNumber.get(row.personalNumber);
      if (!prev) {
        byNumber.set(row.personalNumber, candidate);
        continue;
      }
      warnings.push(`${row.personalNumber} מופיע בשתי לשוניות: ${prev.tab.tabName}, ${tab.tabName}`);
      if (rank(candidate) > rank(prev)) byNumber.set(row.personalNumber, candidate);
    }
  }
  const chosen = [...byNumber.values()];

  /* platoons */
  const platoonMap = new Map<string, string | "create">();
  const platoonText = new Map<string, string>();
  for (const c of chosen) {
    const key = c.platoonKey;
    if (!key || platoonMap.has(key) || platoonText.has(key)) continue;
    platoonText.set(key, c.row.platoonText);
    const under = descendantsOf(c.companyId, allUnits);
    const valid = (id: string | null | undefined) => !!id && (id === c.companyId || under.some((u) => u.id === id));
    const given = mappings.platoons?.[key];
    const savedTarget = saved.platoon.get(key);
    const canon = canonicalName(c.row.platoonText);
    const auto =
      under.find((u) => u.kind === "platoon" && canonicalName(u.name) === canon) ?? under.find((u) => canonicalName(u.name) === canon);
    const answer =
      given === "create" ? "create" : given === "company" ? c.companyId : valid(given) ? given!
      : valid(savedTarget) ? savedTarget!
      : auto?.id;
    if (answer === undefined) {
      const company = companies.find((x) => x.id === c.companyId);
      questions.push({
        kind: "platoon",
        key,
        label: `${company?.name ?? c.tab.tabName} · ${c.row.platoonText}`,
        suggestion: "create",
        options: under.filter((u) => u.active).map((u) => ({ id: u.id, label: u.name })),
      });
    } else {
      platoonMap.set(key, answer);
    }
  }

  /* statuses: every distinct non-empty value on a day inside the round */
  const inRound = (day: Day) => day >= round.startsOn && day <= round.endsOn;
  const values: string[] = [];
  const outside = new Map<string, number>();
  for (const c of chosen) {
    for (const [day, value] of c.row.days) {
      if (!value) continue;
      if (!inRound(day)) {
        outside.set(c.tab.tabName, (outside.get(c.tab.tabName) ?? 0) + 1);
        continue;
      }
      if (!values.includes(value)) values.push(value);
    }
  }
  for (const [tab, n] of outside) warnings.push(`${tab}: ${n} תאים בתאריכים מחוץ לסבב לא יובאו`);

  const active = statuses.filter((s) => s.active);
  const replacedBy = new Map(statuses.filter((s) => s.replacesId).map((s) => [s.replacesId!, s.id]));
  /** the current version of a (possibly replaced) status of this round */
  const current = (id: string | null | undefined): string | undefined => {
    const seen = new Set<string>();
    let cur = id ?? undefined;
    while (cur && !seen.has(cur)) {
      if (active.some((s) => s.id === cur)) return cur;
      seen.add(cur);
      cur = replacedBy.get(cur);
    }
    return undefined;
  };
  const statusMap = new Map<string, string | "create">();
  const newStatuses: NewStatus[] = [];
  const hints = new Map(parsed.statusHints.map((h) => [h.value, h.groups]));
  let nextSort = Math.max(0, ...statuses.map((s) => s.sortOrder)) + 1;
  for (const value of values) {
    const given = mappings.statuses?.[value];
    const auto = active.find((s) => s.sheetValue === value) ?? active.find((s) => s.name === value);
    const answer =
      given === "create" ? "create" : current(given)
      ?? current(saved.status.get(value))
      ?? auto?.id
      ?? (statuses.length === 0 ? "create" : undefined);
    if (answer === undefined) {
      questions.push({
        kind: "status",
        key: value,
        label: value,
        suggestion: "create",
        options: active.sort((a, b) => a.sortOrder - b.sortOrder).map((s) => ({ id: s.id, label: s.name })),
      });
      continue;
    }
    statusMap.set(value, answer);
    if (answer === "create") newStatuses.push({ value, sortOrder: nextSort++, groups: hints.get(value) ?? [] });
  }

  /* what exists now */
  const numbers = chosen.map((c) => c.row.personalNumber);
  const existingPeople = new Map(
    (await inChunks(numbers, (chunk) => tx.select().from(people).where(inArray(people.personalNumber, chunk)))).map((p) => [p.personalNumber!, p]),
  );
  const existingMembers = new Map(
    (await tx.select().from(doch1Members).where(eq(doch1Members.roundId, roundId))).map((m) => [m.personId, m]),
  );
  const existingDays = new Map(
    (
      await tx
        .select({ personId: doch1Days.personId, day: doch1Days.day, statusId: doch1Days.statusId })
        .from(doch1Days)
        .where(eq(doch1Days.roundId, roundId))
    ).map((d) => [`${d.personId}|${d.day}`, d.statusId]),
  );

  /* שבצ״ק tabs */
  const standby = await resolveStandby(tx, roundId, parsed, {
    tabMap,
    chosen: chosenCompanies(chosen),
    companyByKey: new Map(companies.map((c) => [canonicalName(c.name), c.id])),
    isActive,
    given: mappings.locations,
    saved: saved.location,
    ask: (q) => questions.push(q),
    warnings,
  });

  return {
    round: { id: round.id, startsOn: round.startsOn, endsOn: round.endsOn },
    questions,
    warnings,
    chosen,
    tabMap,
    newCompanies,
    platoonMap,
    platoonText,
    statusMap,
    newStatuses,
    roundCompanies,
    existingPeople,
    existingMembers,
    existingDays,
    currentStatus: current,
    units: allUnits,
    standby,
  };
}

/** personal number → company, for the soldiers the import keeps */
export function chosenCompanies(chosen: readonly ChosenRow[]): Map<string, string> {
  return new Map(chosen.map((c) => [c.row.personalNumber, c.companyId]));
}

/* ── the changes an import makes ────────────────────────────────────────── */

export interface PersonFields {
  fullName: string;
  unitId: string;
  phone: string | null;
  roleTitle: string | null;
  personalNumber: string;
}

export interface MemberFields {
  personId: string;
  dmhCategory: string | null;
  arrivalForecast: string | null;
  callUpOn: Day | null;
  enlistmentStatus: string | null;
  hasDisc: boolean | null;
  notes: string | null;
  sheetTab: string;
  sheetRow: number;
}

/** People to add / change. `unitOf` gives the unit for a platoon key (undefined → company level). */
export function peopleChanges(res: Resolution, unitOf: (platoonKey: string) => string | undefined) {
  const inserts: PersonFields[] = [];
  const updates: Array<PersonFields & { id: string }> = [];
  for (const c of res.chosen) {
    const r = c.row;
    const want: PersonFields = {
      fullName: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.personalNumber,
      unitId: (c.platoonKey && unitOf(c.platoonKey)) || c.companyId,
      phone: r.phone || null,
      roleTitle: r.roleTitle || null,
      personalNumber: r.personalNumber,
    };
    const have = res.existingPeople.get(r.personalNumber);
    if (!have) inserts.push(want);
    else if (have.fullName !== want.fullName || have.unitId !== want.unitId || have.phone !== want.phone || have.roleTitle !== want.roleTitle) {
      updates.push({ ...want, id: have.id });
    }
  }
  return { inserts, updates };
}

export interface DayChanges {
  writes: Array<{ personId: string; day: Day; statusId: string }>;
  clears: Array<{ personId: string; day: Day }>;
  skippedPilot: number;
  members: MemberFields[];
}

/** Members to upsert and day cells to write / clear. `personOf` maps a personal number to the person id. */
export function dayChanges(
  res: Resolution,
  personOf: (personalNumber: string) => string,
  statusOf: (value: string) => string | undefined,
): DayChanges {
  const writes: DayChanges["writes"] = [];
  const clears: DayChanges["clears"] = [];
  const members: MemberFields[] = [];
  let skippedPilot = 0;
  for (const c of res.chosen) {
    const r = c.row;
    const personId = personOf(r.personalNumber);
    const member: MemberFields = {
      personId,
      dmhCategory: r.dmhCategory || null,
      arrivalForecast: r.arrivalForecast || null,
      callUpOn: r.callUpOn,
      enlistmentStatus: r.enlistmentStatus || null,
      hasDisc: r.hasDisc,
      notes: r.notes || null,
      sheetTab: c.tab.tabName,
      sheetRow: r.sheetRow,
    };
    const had = res.existingMembers.get(personId);
    if (!had || (Object.keys(member) as Array<keyof MemberFields>).some((k) => had[k] !== member[k])) members.push(member);

    const appFrom = res.roundCompanies.get(c.companyId)?.appFrom ?? null;
    for (const [day, value] of r.days) {
      if (day < res.round.startsOn || day > res.round.endsOn) continue;
      const existing = res.existingDays.get(`${personId}|${day}`);
      const statusId = value ? statusOf(value) : undefined;
      if (value && !statusId) continue; // unanswered status question
      // a past day on an older version of the same status keeps it: its flags are that day's history
      const same = value ? existing !== undefined && (existing === statusId || res.currentStatus(existing) === statusId) : existing === undefined;
      const changes = !same;
      if (!changes) continue;
      // the pilot company reports in the app from app_from: the sheet never overwrites those days
      if (appFrom && day >= appFrom) {
        skippedPilot++;
        continue;
      }
      if (value) writes.push({ personId, day, statusId: statusId! });
      else clears.push({ personId, day });
    }
  }
  return { writes, clears, skippedPilot, members };
}

/** Round members whose person isn't in any mapped tab of the file. */
async function notInSheet(tx: Tx, res: Resolution): Promise<SheetImportPlan["notInSheet"]> {
  const inFile = new Set(res.chosen.map((c) => res.existingPeople.get(c.row.personalNumber)?.id).filter(Boolean));
  const missing = [...res.existingMembers.keys()].filter((id) => !inFile.has(id));
  if (!missing.length) return [];
  const rows = await inChunks(missing, (chunk) =>
    tx.select({ id: people.id, fullName: people.fullName, unitId: people.unitId }).from(people).where(inArray(people.id, chunk)),
  );
  const byId = new Map(res.units.map((u) => [u.id, u]));
  return rows
    .map((p) => ({ personId: p.id, name: p.fullName, company: placement(p.unitId, byId).company?.name ?? "" }))
    .sort((a, b) => a.company.localeCompare(b.company, "he") || a.name.localeCompare(b.name, "he"));
}

/** Preview: questions, warnings and the counts an apply would produce. Reads only. */
export async function planSheetImport(tx: Tx, roundId: string, parsed: ParsedSheet, mappings: Partial<ImportMappings>): Promise<SheetImportPlan> {
  const res = await resolveSheetImport(tx, roundId, parsed, mappings);
  const unitOf = (key: string) => {
    const t = res.platoonMap.get(key);
    return t === "create" ? `new:${key}` : t;
  };
  const ppl = peopleChanges(res, unitOf);
  const days = dayChanges(
    res,
    (pn) => res.existingPeople.get(pn)?.id ?? `new:${pn}`,
    (value) => {
      const t = res.statusMap.get(value);
      return t === "create" ? `new:${value}` : t;
    },
  );
  const createdPlatoons = new Set([...res.platoonMap].filter(([, v]) => v === "create").map(([k]) => k));
  const sb = standbyChanges(
    res.standby,
    chosenCompanies(res.chosen),
    (pn) => res.existingPeople.get(pn)?.id ?? `new:${pn}`,
    (personId) => res.existingMembers.get(personId)?.locationId,
  );
  return {
    roundId,
    questions: res.questions,
    warnings: res.warnings,
    notInSheet: await notInSheet(tx, res),
    counts: {
      newPeople: ppl.inserts.length,
      updatedPeople: ppl.updates.length,
      members: days.members.length,
      daysWritten: days.writes.length,
      daysCleared: days.clears.length,
      daysSkippedPilot: days.skippedPilot,
      statusesCreated: res.newStatuses.length,
      platoonsCreated: createdPlatoons.size,
      companiesCreated: res.newCompanies.size,
      locationsCreated: sb.newLocations.length,
      locationsSet: sb.locate.length,
      teamsCreated: sb.newTeams.length,
      teamMembersChanged: sb.addMembers.length + sb.removeMembers.length + sb.roleUpdates.length,
      vehiclesCreated: sb.newVehicles.length,
    },
  };
}
