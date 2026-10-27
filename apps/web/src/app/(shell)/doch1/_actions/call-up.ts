"use server";
/**
 * יום גיוס: compare the brigade's list of who showed up with the round's סטטוס גיוס. Battalion
 * doch1 admin; the file (xlsx or csv) is read in memory and never stored, nothing is written.
 */
import { compareBrigadeList, type EnlistmentEffect } from "@gdud/core";
import { eq, schema, withUser } from "@gdud/db";
import { parseBrigadeList, readRosterFile, RosterImportError } from "@gdud/db/doch1-roster-import";
import { actionError, UserError } from "@/lib/action-result";
import { loadFieldOptions, loadMembers } from "@/lib/doch1/data";
import { doch1Ctx, NO_PERMISSION, NO_ROUND } from "./common";

const { people, doch1Members: members } = schema;

/** Vercel rejects request bodies over 4.5 MB. */
const MAX_FILE_BYTES = 3.9 * 1024 * 1024;

export interface BrigadeSoldier {
  personId: string;
  name: string;
  /** company · platoon */
  unit: string;
  /** our סטטוס גיוס value's name; null = not marked */
  ours: string | null;
  /** the brigade file's row: line, and its status text when it has one */
  line: number | null;
  theirs: string | null;
}

export type BrigadeCompareResult =
  | { error: string }
  | {
      fileName: string;
      rows: number;
      hasStatus: boolean;
      warnings: string[];
      agree: number;
      notMarked: BrigadeSoldier[];
      notInBrigade: BrigadeSoldier[];
      unknown: Array<{ line: number; personalNumber: string; name: string; status: string }>;
    };

export async function compareBrigadeFile(fd: FormData): Promise<BrigadeCompareResult> {
  const ctx = await doch1Ctx();
  if (!ctx) return NO_ROUND;
  if (!ctx.access.isAdmin) return NO_PERMISSION;
  try {
    const f = fd.get("file");
    if (!(f instanceof File) || !f.size || !/\.(xlsx|csv)$/i.test(f.name)) throw new UserError("צריך קובץ xlsx או csv");
    if (f.size > MAX_FILE_BYTES) throw new UserError("הקובץ גדול מדי (עד 3.9MB)");
    let grids;
    try {
      grids = await readRosterFile(new Uint8Array(await f.arrayBuffer()), f.name);
    } catch {
      throw new UserError("לא הצלחנו לקרוא את הקובץ. ודאו שזה xlsx או csv.");
    }
    const file = parseBrigadeList(grids);

    const { roster, numbers, options } = await withUser(ctx.s.claims, async (tx) => {
      const [roster, numbers, options] = await Promise.all([
        loadMembers(tx, ctx.round.id, ctx.s.units),
        tx.select({ personId: members.personId, personalNumber: people.personalNumber }).from(members).innerJoin(people, eq(people.id, members.personId)).where(eq(members.roundId, ctx.round.id)),
        loadFieldOptions(tx, ctx.round.id),
      ]);
      return { roster, numbers, options };
    });
    const numberOf = new Map(numbers.map((n) => [n.personId, n.personalNumber]));
    const option = new Map(options.map((o) => [o.id, o]));
    const effectOf = (id: string | null) => (id ? (option.get(id)?.effect as EnlistmentEffect | undefined) : undefined);
    const cmp = compareBrigadeList(
      roster.map((m) => ({ personId: m.personId, personalNumber: numberOf.get(m.personId) ?? null, arrived: effectOf(m.enlistmentOptionId) === "arrived" })),
      file.rows,
    );

    const unitName = new Map(ctx.s.units.map((u) => [u.id, u.name]));
    const byId = new Map(roster.map((m) => [m.personId, m]));
    const soldier = (personId: string, row: { line: number; status: string } | null): BrigadeSoldier => {
      const m = byId.get(personId)!;
      return {
        personId,
        name: m.name,
        unit: [unitName.get(m.companyId), m.platoonName].filter(Boolean).join(" · "),
        ours: m.enlistmentOptionId ? (option.get(m.enlistmentOptionId)?.name ?? null) : null,
        line: row?.line ?? null,
        theirs: row?.status || null,
      };
    };
    return {
      fileName: f.name,
      rows: file.rows.length,
      hasStatus: file.hasStatus,
      warnings: file.warnings,
      agree: cmp.agree,
      notMarked: cmp.notMarked.map((x) => soldier(x.personId, x.row)),
      notInBrigade: cmp.notInBrigade.map((x) => soldier(x.personId, x.row)),
      unknown: cmp.unknown,
    };
  } catch (err) {
    return { error: err instanceof RosterImportError ? err.message : actionError(err) };
  }
}
