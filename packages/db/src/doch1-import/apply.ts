/**
 * Apply a round-sheet import: the same resolution as planSheetImport(), then the writes,
 * all inside the caller's single RLS transaction (withUser). Order: new companies (then the
 * resolution again, with their ids) → statuses → platoons → round companies → people →
 * members → days → remembered mappings.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Tx } from "../index";
import * as schema from "../schema/index";
import type { ParsedSheet } from "./parse";
import {
  dayChanges,
  newCompanyId,
  DOCH1_NEW_STATUS_COLOR,
  peopleChanges,
  resolveSheetImport,
  SheetImportError,
  type ImportCounts,
  type ImportMappings,
  type NewStatus,
} from "./plan";

const { units, people, doch1RoundCompanies, doch1Statuses, doch1Members, doch1Days, doch1ImportMappings } = schema;

const WRITE_CHUNK = 500;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += WRITE_CHUNK) out.push(items.slice(i, i + WRITE_CHUNK));
  return out;
}

/** Rows of a raw `execute()` — postgres-js returns an array, PGlite `{ rows }`. */
function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);
}

/** Creating units (companies, platoons) needs the battalion core admin role on top of doch1 admin. */
async function requireCoreAdmin(tx: Tx, message: string) {
  const [check] = rowsOf<{ ok: boolean }>(await tx.execute(sql`select app.has_role('core', array['admin']) as ok`));
  if (!check?.ok) throw new SheetImportError(message);
}

function statusValues(roundId: string, s: NewStatus) {
  const has = (g: NewStatus["groups"][number]) => s.groups.includes(g);
  const offDuty = has("notCounted");
  return {
    roundId,
    name: s.value,
    sheetValue: s.value,
    displayGroup: s.value,
    color: DOCH1_NEW_STATUS_COLOR,
    sortOrder: s.sortOrder,
    countsAsPresent: has("present"),
    generalDay: has("general"),
    homeDay: has("home"),
    orgDay: has("org"),
    offDuty,
    countsInSadak: !offDuty,
  };
}

export async function applySheetImport(tx: Tx, roundId: string, parsed: ParsedSheet, mappings: ImportMappings): Promise<ImportCounts> {
  let res = await resolveSheetImport(tx, roundId, parsed, mappings);
  if (res.questions.length) throw new SheetImportError("נשארו שאלות מיפוי פתוחות — עדכנו את התצוגה המקדימה ונסו שוב");

  /* new companies, under the battalion; then resolve again with their real ids */
  const companiesCreated = res.newCompanies.size;
  if (companiesCreated) {
    await requireCoreAdmin(tx, "ליצירת פלוגות צריך הרשאת מנהל ליבה");
    const parentId = res.units.find((u) => u.kind === "battalion" && u.active)?.id ?? null;
    const tabs = { ...mappings.tabs };
    let platoons = { ...mappings.platoons };
    for (const [tabKey, name] of res.newCompanies) {
      const [u] = await tx.insert(units).values({ parentId, kind: "company", name }).returning({ id: units.id });
      tabs[tabKey] = u!.id;
      const prefix = `${newCompanyId(tabKey)}|`;
      platoons = Object.fromEntries(Object.entries(platoons).map(([k, v]) => [k.startsWith(prefix) ? `${u!.id}|${k.slice(prefix.length)}` : k, v]));
    }
    res = await resolveSheetImport(tx, roundId, parsed, { ...mappings, tabs, platoons });
    if (res.questions.length) throw new SheetImportError("נשארו שאלות מיפוי פתוחות — עדכנו את התצוגה המקדימה ונסו שוב");
  }

  /* statuses */
  const statusIds = new Map<string, string>();
  for (const [value, target] of res.statusMap) if (target !== "create") statusIds.set(value, target);
  if (res.newStatuses.length) {
    const created = await tx.insert(doch1Statuses).values(res.newStatuses.map((s) => statusValues(roundId, s))).returning();
    for (const s of created) statusIds.set(s.sheetValue, s.id);
  }

  /* platoons */
  const unitIds = new Map<string, string>();
  const toCreate: string[] = [];
  for (const [key, target] of res.platoonMap) {
    if (target === "create") toCreate.push(key);
    else unitIds.set(key, target);
  }
  if (toCreate.length) {
    await requireCoreAdmin(tx, "ליצירת מחלקות צריך הרשאת מנהל ליבה");
    for (const key of toCreate) {
      const companyId = key.slice(0, key.indexOf("|"));
      const [u] = await tx
        .insert(units)
        .values({ parentId: companyId, kind: "platoon", name: res.platoonText.get(key)! })
        .returning({ id: units.id });
      unitIds.set(key, u!.id);
    }
  }

  /* companies taking part in the round (existing rows keep their active / app_from) */
  const companyIds = [...new Set([...res.tabMap.values()].filter((v): v is string => !!v))];
  if (companyIds.length) {
    await tx
      .insert(doch1RoundCompanies)
      .values(companyIds.map((unitId) => ({ roundId, unitId })))
      .onConflictDoNothing();
  }

  /* people */
  const ppl = peopleChanges(res, (key) => unitIds.get(key));
  const personIds = new Map([...res.existingPeople].map(([pn, p]) => [pn, p.id]));
  for (const chunk of chunks(ppl.inserts)) {
    const rows = await tx.insert(people).values(chunk).returning({ id: people.id, personalNumber: people.personalNumber });
    for (const r of rows) personIds.set(r.personalNumber!, r.id);
  }
  for (const chunk of chunks(ppl.updates)) {
    const values = sql.join(
      chunk.map((p) => sql`(${p.id}::uuid, ${p.fullName}, ${p.unitId}::uuid, ${p.phone}::text, ${p.roleTitle}::text)`),
      sql`, `,
    );
    await tx.execute(sql`
      update public.people as p
         set full_name = v.full_name, unit_id = v.unit_id, phone = v.phone, role_title = v.role_title
        from (values ${values}) as v(id, full_name, unit_id, phone, role_title)
       where p.id = v.id`);
  }

  /* members and days */
  const changes = dayChanges(
    res,
    (pn) => personIds.get(pn)!,
    (value) => statusIds.get(value),
  );
  for (const chunk of chunks(changes.members)) {
    await tx
      .insert(doch1Members)
      .values(chunk.map((m) => ({ ...m, roundId })))
      .onConflictDoUpdate({
        target: [doch1Members.roundId, doch1Members.personId],
        set: {
          dmhCategory: sql`excluded.dmh_category`,
          arrivalForecast: sql`excluded.arrival_forecast`,
          callUpOn: sql`excluded.call_up_on`,
          enlistmentStatus: sql`excluded.enlistment_status`,
          hasDisc: sql`excluded.has_disc`,
          notes: sql`excluded.notes`,
          sheetTab: sql`excluded.sheet_tab`,
          sheetRow: sql`excluded.sheet_row`,
        },
      });
  }
  for (const chunk of chunks(changes.writes)) {
    await tx
      .insert(doch1Days)
      .values(chunk.map((w) => ({ ...w, roundId })))
      .onConflictDoUpdate({ target: [doch1Days.personId, doch1Days.day], set: { statusId: sql`excluded.status_id` } });
  }
  for (const chunk of chunks(changes.clears)) {
    const keys: SQL = sql.join(
      chunk.map((c) => sql`(${c.personId}::uuid, ${c.day}::date)`),
      sql`, `,
    );
    await tx.delete(doch1Days).where(and(eq(doch1Days.roundId, roundId), sql`(${doch1Days.personId}, ${doch1Days.day}) in (${keys})`));
  }

  /* remember every answer for the next import */
  const saved = [
    ...[...res.tabMap].map(([sourceKey, targetId]) => ({ kind: "company", sourceKey, targetId })),
    ...[...res.platoonMap.keys()].map((sourceKey) => ({ kind: "platoon", sourceKey, targetId: unitIds.get(sourceKey) ?? null })),
    ...[...res.statusMap.keys()].map((sourceKey) => ({ kind: "status", sourceKey, targetId: statusIds.get(sourceKey) ?? null })),
  ];
  for (const chunk of chunks(saved)) {
    await tx
      .insert(doch1ImportMappings)
      .values(chunk.map((m) => ({ ...m, roundId })))
      .onConflictDoUpdate({
        target: [doch1ImportMappings.roundId, doch1ImportMappings.kind, doch1ImportMappings.sourceKey],
        set: { targetId: sql`excluded.target_id` },
      });
  }

  return {
    newPeople: ppl.inserts.length,
    updatedPeople: ppl.updates.length,
    members: changes.members.length,
    daysWritten: changes.writes.length,
    daysCleared: changes.clears.length,
    daysSkippedPilot: changes.skippedPilot,
    statusesCreated: res.newStatuses.length,
    platoonsCreated: toCreate.length,
    companiesCreated,
  };
}
